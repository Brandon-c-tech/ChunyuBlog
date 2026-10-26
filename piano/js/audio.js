// 声音引擎：采样钢琴（Salamander Grand Piano）+ 合成鼓/节拍器 + 提前调度的播放器

const SAMPLE_NAMES = [
  'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4',
  'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7',
];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function sampleMidi(name) {
  const m = /^([A-G])(s?)(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + LETTER_PC[m[1]] + (m[2] ? 1 : 0);
}

export class AudioEngine {
  constructor(basePath = 'samples/') {
    this.basePath = basePath;
    this.ctx = null;
    this.buffers = new Map();
    this.sampleKeys = [];
    this.samplesReady = false;
    this.voices = new Set();
    this.volume = 0.8;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }

  // 必须在用户点击之后调用（浏览器的自动播放限制）
  ensure() {
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (!this.loading) this.loading = this.loadSamples();
    return this.ctx;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.piano = ctx.createGain();
    this.piano.gain.value = 1.0;
    this.piano.connect(this.master);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.6;
    this.drums.connect(this.master);
    this.clicks = ctx.createGain();
    this.clicks.gain.value = 0.55;
    this.clicks.connect(this.master);

    const rev = ctx.createConvolver();
    rev.buffer = this.impulse(2.4, 3.2);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    this.piano.connect(send);
    send.connect(rev);
    rev.connect(this.master);

    this.noise = this.noiseBuffer(1);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  async loadSamples() {
    const ctx = this.ctx;
    const decode = (arr) => new Promise((res, rej) => ctx.decodeAudioData(arr, res, rej));
    await Promise.all(SAMPLE_NAMES.map(async (name) => {
      try {
        const r = await fetch(this.basePath + name + '.mp3');
        if (!r.ok) throw new Error(r.status);
        const buf = await decode(await r.arrayBuffer());
        this.buffers.set(sampleMidi(name), buf);
      } catch (e) {
        console.warn('采样加载失败', name, e);
      }
    }));
    this.sampleKeys = [...this.buffers.keys()].sort((a, b) => a - b);
    this.samplesReady = this.sampleKeys.length > 0;
    this.emit();
  }

  nearestSample(midi) {
    let best = this.sampleKeys[0];
    for (const k of this.sampleKeys) if (Math.abs(k - midi) < Math.abs(best - midi)) best = k;
    return best;
  }

  track(voice, src) {
    this.voices.add(voice);
    src.onended = () => this.voices.delete(voice);
  }

  // 播放一个音；dur 为 null 时一直响，直到调用返回值的 stop()
  playNote(midi, when, dur = null, vel = 0.7) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + vel * vel * 9000;
    lp.connect(out);
    out.connect(this.piano);
    const amp = 0.12 + 0.88 * Math.pow(vel, 1.5);
    let src;
    let stopExtra = 0;
    if (this.samplesReady) {
      const key = this.nearestSample(midi);
      src = ctx.createBufferSource();
      src.buffer = this.buffers.get(key);
      src.playbackRate.value = Math.pow(2, (midi - key) / 12);
      src.connect(lp);
      out.gain.setValueAtTime(amp, t);
      src.start(t);
    } else {
      // 采样没加载好时的备用音色（柔和的电钢琴感）
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      src = ctx.createOscillator();
      src.type = 'triangle';
      src.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.001;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o2.connect(g2);
      g2.connect(lp);
      src.connect(lp);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(amp * 0.6, t + 0.006);
      out.gain.setTargetAtTime(amp * 0.18, t + 0.01, 0.6);
      src.start(t);
      o2.start(t);
      src.extra = o2;
      stopExtra = 1;
    }
    const voice = {
      stop: (at) => {
        const s = Math.max(at ?? ctx.currentTime, t);
        out.gain.cancelScheduledValues(s);
        out.gain.setValueAtTime(out.gain.value || amp, s);
        out.gain.setTargetAtTime(0, s, 0.07);
        try { src.stop(s + 0.6); if (stopExtra) src.extra.stop(s + 0.6); } catch (e) { /* 已停止 */ }
      },
      kill: () => {
        const s = ctx.currentTime;
        out.gain.cancelScheduledValues(s);
        out.gain.setValueAtTime(out.gain.value, s);
        out.gain.setTargetAtTime(0, s, 0.015);
        try { src.stop(s + 0.1); if (stopExtra) src.extra.stop(s + 0.1); } catch (e) { /* 已停止 */ }
      },
    };
    if (dur != null) {
      const end = t + dur;
      out.gain.setTargetAtTime(0, end, 0.09);
      src.stop(end + 0.8);
      if (stopExtra) src.extra.stop(end + 0.8);
    }
    this.track(voice, src);
    return voice;
  }

  // ---------- 鼓与节拍器（全部用合成） ----------
  drum(inst, when, vel = 0.7) {
    const fn = this['d_' + inst];
    if (fn) fn.call(this, Math.max(when, this.ctx.currentTime), vel);
  }

  env(when, peak, decay, attack = 0.001) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return g;
  }

  noiseSrc(when, len) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(when, Math.random() * 0.5);
    src.stop(when + len);
    const voice = { kill: () => { try { src.stop(); } catch (e) { /* 已停止 */ } } };
    this.track(voice, src);
    return src;
  }

  d_kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    const g = this.env(t, 0.95 * vel, 0.38);
    o.connect(g);
    g.connect(this.drums);
    o.start(t);
    o.stop(t + 0.5);
    this.track({ kill: () => { try { o.stop(); } catch (e) { /* 已停止 */ } } }, o);
  }

  d_snare(t, vel) {
    const ctx = this.ctx;
    const n = this.noiseSrc(t, 0.25);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = this.env(t, 0.5 * vel, 0.17);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.drums);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g2 = this.env(t, 0.32 * vel, 0.09);
    o.connect(g2);
    g2.connect(this.drums);
    o.start(t);
    o.stop(t + 0.2);
  }

  d_rim(t, vel) {
    const ctx = this.ctx;
    const n = this.noiseSrc(t, 0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 3;
    const g = this.env(t, 0.55 * vel, 0.035);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.drums);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 820;
    const g2 = this.env(t, 0.12 * vel, 0.025);
    o.connect(g2);
    g2.connect(this.drums);
    o.start(t);
    o.stop(t + 0.06);
  }

  d_hat(t, vel) {
    const ctx = this.ctx;
    const n = this.noiseSrc(t, 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = this.env(t, 0.28 * vel, 0.045);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.drums);
  }

  d_shaker(t, vel) {
    const ctx = this.ctx;
    const n = this.noiseSrc(t, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6000;
    bp.Q.value = 1.1;
    const g = this.env(t, 0.22 * vel, 0.07, 0.012);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.drums);
  }

  click(when, accent) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = accent ? 1760 : 1180;
    const g = this.env(t, accent ? 0.5 : 0.32, 0.04);
    o.connect(g);
    g.connect(this.clicks);
    o.start(t);
    o.stop(t + 0.08);
    this.track({ kill: () => { try { o.stop(); } catch (e) { /* 已停止 */ } } }, o);
  }

  stopAll() {
    for (const v of this.voices) v.kill();
    this.voices.clear();
  }
}

// 后台标签页里 setInterval 会被限速，用 Worker 计时更稳
function makeTicker(fn, ms) {
  try {
    const code = 'let id; onmessage = (e) => { clearInterval(id); if (e.data > 0) id = setInterval(() => postMessage(0), e.data); };';
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    w.onmessage = fn;
    return { start: () => w.postMessage(ms), stop: () => w.postMessage(0) };
  } catch (e) {
    let id;
    return { start: () => { clearInterval(id); id = setInterval(fn, ms); }, stop: () => clearInterval(id) };
  }
}

// ---------- 播放器：按拍提前调度，画面按声音时间同步 ----------
export class Transport {
  constructor(engine) {
    this.engine = engine;
    this.playing = false;
    this.queue = [];
    this.frame = this.frame.bind(this);
    this.ticker = makeTicker(() => this.playing && this.schedule(), 25);
  }

  // seq: { length, loop, events: Array | (iteration) => Array }
  // opts: { bpm, countIn, onVisual(ev, on), onTick(beat), onEnd(), isMuted(ev) }
  start(seq, opts) {
    this.stop();
    const ctx = this.engine.ensure();
    this.seq = seq;
    this.opts = opts;
    this.bpm = opts.bpm;
    this.spb = 60 / this.bpm;
    const countIn = opts.countIn || 0;
    this.startTime = ctx.currentTime + 0.15 + countIn * this.spb;
    this.iter = 0;
    this.idx = 0;
    this.events = this.eventsFor(0);
    this.endTime = null;
    this.queue = [];
    for (let i = 0; i < countIn; i++) {
      const t = this.startTime - (countIn - i) * this.spb;
      this.engine.click(t, i === 0);
      this.queue.push({ t, ev: { type: 'count', n: countIn - i }, on: true });
    }
    this.playing = true;
    this.ticker.start();
    this.schedule();
    this.raf = requestAnimationFrame(this.frame);
  }

  eventsFor(iter) {
    const e = typeof this.seq.events === 'function' ? this.seq.events(iter) : this.seq.events;
    return e || [];
  }

  timeOf(beat) { return this.startTime + beat * this.spb; }
  beatAt(t) { return (t - this.startTime) / this.spb; }

  setBpm(bpm) {
    if (!this.playing) { this.bpm = bpm; return; }
    const now = this.engine.now;
    const pos = this.beatAt(now);
    this.bpm = bpm;
    this.spb = 60 / bpm;
    this.startTime = now - pos * this.spb;
  }

  schedule() {
    const ctx = this.engine.ctx;
    const horizon = ctx.currentTime + 0.14;
    for (let guard = 0; guard < 2000; guard++) {
      if (this.idx >= this.events.length) {
        if (!this.seq.loop) {
          if (this.endTime == null) this.endTime = this.timeOf(this.seq.length);
          return;
        }
        this.iter++;
        this.idx = 0;
        this.events = this.eventsFor(this.iter);
        if (!this.events.length) return;
      }
      const ev = this.events[this.idx];
      const abs = this.iter * this.seq.length + ev.beat;
      const t = this.timeOf(abs);
      if (t > horizon) return;
      this.idx++;
      if (t < ctx.currentTime - 0.06) continue;
      this.fire(ev, t);
    }
  }

  fire(ev, t) {
    const muted = this.opts.isMuted ? this.opts.isMuted(ev) : false;
    if (ev.type === 'note') {
      if (!muted) {
        const d = (ev.sustain ?? ev.dur) * this.spb;
        for (const m of ev.midis) this.engine.playNote(m, t, d, ev.vel);
      }
      this.queue.push({ t, ev, on: true });
      this.queue.push({ t: t + ev.dur * this.spb - 0.02, ev, on: false });
    } else if (ev.type === 'drum') {
      if (!muted) this.engine.drum(ev.inst, t, ev.vel);
    } else if (ev.type === 'click') {
      if (!muted) this.engine.click(t, ev.accent);
      this.queue.push({ t, ev, on: true });
    } else {
      this.queue.push({ t, ev, on: true });
    }
  }

  frame() {
    if (!this.playing) return;
    const ctx = this.engine.ctx;
    const lat = ctx.outputLatency || ctx.baseLatency || 0;
    const now = ctx.currentTime - lat;
    if (this.queue.length) {
      const due = [];
      const rest = [];
      for (const q of this.queue) (q.t <= now ? due : rest).push(q);
      this.queue = rest;
      due.sort((a, b) => a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1));
      for (const q of due) {
        try { this.opts.onVisual && this.opts.onVisual(q.ev, q.on); } catch (e) { console.error(e); }
      }
    }
    try { this.opts.onTick && this.opts.onTick(this.beatAt(now)); } catch (e) { console.error(e); }
    if (this.endTime != null && now >= this.endTime + 0.05) {
      const end = this.opts.onEnd;
      this.stop(true);
      end && end();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(natural = false) {
    this.ticker.stop();
    cancelAnimationFrame(this.raf);
    if (!this.playing) return;
    this.playing = false;
    this.queue = [];
    if (!natural) this.engine.stopAll();
    this.opts && this.opts.onStop && this.opts.onStop();
  }
}
