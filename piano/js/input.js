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

// ---------- 用麦克风听真钢琴（试验功能） ----------
// YIN 音高检测：只在右手音域（约 B3 到 C7）里找基频，左手伴奏的低音会被忽略
export function detectPitch(buf, sr, fMin = 245, fMax = 2100, threshold = 0.15) {
  const tMax = Math.min(Math.floor(sr / fMin) + 2, buf.length >> 1);
  const tMin = Math.max(2, Math.floor(sr / fMax));
  const w = buf.length - tMax;
  const d = new Float32Array(tMax + 1);
  for (let tau = 1; tau <= tMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tMax; tau++) {
    run += d[tau];
    d[tau] = run ? (d[tau] * tau) / run : 1;
  }
  for (let t = tMin; t < tMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 < tMax && d[t + 1] < d[t]) t++;
      const a = d[t - 1];
      const b = d[t];
      const c = d[t + 1];
      const den = a - 2 * b + c;
      const shift = den ? (a - c) / (2 * den) : 0;
      return { f0: sr / (t + shift), clarity: 1 - b };
    }
  }
  return null;
}

export class MicListener {
  constructor({ onNoteOn, onNoteOff }) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.active = false;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start(ctx) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = ctx;
    this.src = ctx.createMediaStreamSource(this.stream);
    // 先滤掉 230Hz 以下的声音：左手伴奏的低音不会干扰右手旋律的检测
    const hp1 = ctx.createBiquadFilter();
    const hp2 = ctx.createBiquadFilter();
    hp1.type = hp2.type = 'highpass';
    hp1.frequency.value = hp2.frequency.value = 230;
    this.an = ctx.createAnalyser();
    this.an.fftSize = 2048;
    this.src.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.floor = 0.004;
    this.prev = 0;
    this.cur = null;
    this.cand = null;
    this.count = 0;
    this.quiet = 0;
    this.attack = false;
    this.active = true;
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    clearInterval(this.timer);
    if (this.cur != null) this.onNoteOff(this.cur);
    this.cur = null;
    if (this.src) this.src.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.active = false;
  }

  tick() {
    const buf = this.buf;
    this.an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    // 慢慢跟踪房间底噪
    if (rms < this.floor * 1.6) this.floor = this.floor * 0.97 + rms * 0.03;
    const gate = Math.max(0.006, this.floor * 4);
    const onset = rms > gate && rms > this.prev * 1.35 + 0.002;
    this.prev = rms;
    if (rms < gate) {
      if (++this.quiet > 5 && this.cur != null) {
        this.onNoteOff(this.cur);
        this.cur = null;
      }
      this.cand = null;
      return;
    }
    this.quiet = 0;
    // 新的一下按键：清掉之前的判断，跳过还混着上一个音尾巴的那一帧
    if (onset) {
      this.attack = true;
      this.since = 0;
      this.cand = null;
      this.count = 0;
      return;
    }
    this.since = (this.since || 0) + 1;
    const p = detectPitch(buf, this.ctx.sampleRate);
    if (!p) return;
    const midi = Math.round(69 + 12 * Math.log2(p.f0 / 440));
    // 同一个音连续出现几帧才算数，避开按键瞬间的杂音
    if (midi === this.cand) this.count++;
    else {
      this.cand = midi;
      this.count = 1;
    }
    const need = this.attack ? 2 : 3;
    if (this.count >= need && (midi !== this.cur || this.attack)) {
      if (this.cur != null) this.onNoteOff(this.cur);
      this.cur = midi;
      this.attack = false;
      this.onNoteOn(midi);
    }
  }
}
