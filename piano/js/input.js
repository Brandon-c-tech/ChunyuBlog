// 输入：电脑键盘、MIDI 电钢琴、麦克风录音

// 和音乐软件一样的键位：A 行是白键，W E T Y U O P 是黑键
const CODE_MAP = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14,
  KeyP: 15, Semicolon: 16, Quote: 17,
};
const CODE_LABEL = {
  KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G',
  KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L',
  KeyP: 'P', Semicolon: ';', Quote: "'",
};

export class Input {
  constructor({ onNoteOn, onNoteOff, onChange }) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.onChange = onChange;
    this.base = 60;
    this.held = new Map();
    this.midi = null;
    this.midiState = 'off';
    this.devices = [];
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => this.releaseKeys());
  }

  ignore(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'range');
  }

  keyDown(e) {
    if (this.ignore(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      if (!e.repeat) this.shiftOctave(e.code === 'KeyZ' ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (!(e.code in CODE_MAP)) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    const midi = this.base + CODE_MAP[e.code];
    this.held.set(e.code, midi);
    this.onNoteOn(midi, 0.72, 'keys');
  }

  keyUp(e) {
    const midi = this.held.get(e.code);
    if (midi == null) return;
    this.held.delete(e.code);
    this.onNoteOff(midi, 'keys');
  }

  releaseKeys() {
    for (const midi of this.held.values()) this.onNoteOff(midi, 'keys');
    this.held.clear();
  }

  shiftOctave(d) {
    this.releaseKeys();
    this.base = Math.max(36, Math.min(72, this.base + 12 * d));
    this.onChange && this.onChange();
  }

  keyHints() {
    const m = new Map();
    for (const code in CODE_MAP) m.set(this.base + CODE_MAP[code], CODE_LABEL[code]);
    return m;
  }

  async connectMidi() {
    if (!navigator.requestMIDIAccess) {
      this.midiState = 'unsupported';
      this.onChange && this.onChange();
      return;
    }
    try {
      this.midi = await navigator.requestMIDIAccess();
    } catch (e) {
      this.midiState = 'denied';
      this.onChange && this.onChange();
      return;
    }
    this.midi.onstatechange = () => this.refreshMidi();
    this.refreshMidi();
  }

  refreshMidi() {
    const inputs = [...this.midi.inputs.values()];
    for (const inp of inputs) inp.onmidimessage = (msg) => this.midiMessage(msg);
    this.devices = inputs.filter((i) => i.state !== 'disconnected').map((i) => i.name || 'MIDI 设备');
    this.midiState = this.devices.length ? 'on' : 'none';
    this.onChange && this.onChange();
  }

  midiMessage(msg) {
    const [st, d1, d2] = msg.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && d2 > 0) this.onNoteOn(d1, d2 / 127, 'midi');
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.onNoteOff(d1, 'midi');
  }
}

// 用麦克风录下整个房间（钢琴 + 伴奏），听回放
export class Recorder {
  constructor() {
    this.rec = null;
    this.stream = null;
    this.url = null;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((res) => { this.rec.onstop = res; });
    this.rec.start();
  }

  async stop() {
    if (!this.rec) return null;
    this.rec.stop();
    await this.done;
    this.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.rec = null;
    return { url: this.url, type: blob.type };
  }

  get recording() {
    return !!this.rec;
  }
}
