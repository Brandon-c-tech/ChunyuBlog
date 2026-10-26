// 屏幕上的钢琴键盘：显示按键位置、左右手高亮、“安全音”标记，也可以用鼠标弹

import { isBlack, midiToJianpu, letterName, MIDDLE_C } from './theory.js';

// 黑键相对位置（单位：白键宽度），C# 偏左、D# 偏右……
const BLACK_OFFSET = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };
const PRIORITY = ['you', 'rh', 'lh', 'flash'];

export class Keyboard {
  constructor(root, opts = {}) {
    this.root = root;
    this.low = opts.low ?? 36;
    this.high = opts.high ?? 84;
    this.onDown = opts.onDown;
    this.onUp = opts.onUp;
    this.labelMode = opts.labelMode || 'jianpu';
    this.keys = new Map();
    this.marks = new Map();
    this.hints = new Map();
    this.pointers = new Map();
    this.build();
    this.bindPointer();
  }

  setRange(low, high) {
    if (low === this.low && high === this.high) return;
    this.low = low;
    this.high = high;
    this.build();
  }

  build() {
    const root = this.root;
    root.innerHTML = '';
    root.classList.add('kb');
    const whites = [];
    for (let m = this.low; m <= this.high; m++) if (!isBlack(m)) whites.push(m);
    const ww = 100 / whites.length;
    const wIndex = new Map(whites.map((m, i) => [m, i]));
    const old = this.keys;
    this.keys = new Map();
    for (let m = this.low; m <= this.high; m++) {
      const black = isBlack(m);
      const el = document.createElement('div');
      el.className = 'key ' + (black ? 'black' : 'white');
      el.dataset.midi = m;
      if (black) {
        const left = wIndex.get(m - 1);
        if (left == null) continue;
        const bw = ww * 0.6;
        const c = (left + 1) * ww + BLACK_OFFSET[m % 12] * ww;
        el.style.left = c - bw / 2 + '%';
        el.style.width = bw + '%';
      } else {
        el.style.left = wIndex.get(m) * ww + '%';
        el.style.width = ww + '%';
      }
      el.innerHTML = '<span class="hint"></span><span class="mark"></span><span class="lbl"></span>';
      if (m === MIDDLE_C) {
        el.classList.add('middle-c');
        el.title = '中央 C';
      }
      root.appendChild(el);
      const prev = old.get(m);
      this.keys.set(m, { el, on: prev ? prev.on : { you: 0, rh: 0, lh: 0, flash: 0 } });
    }
    this.renderLabels();
    this.renderMarks();
    this.renderHints();
    this.setNext(this.next ? [...this.next] : null);
    for (const m of this.keys.keys()) this.paint(m);
  }

  // “下一个要弹的音”：琴键上画一个提示圈
  setNext(midis) {
    this.next = new Set(midis || []);
    for (const [m, k] of this.keys) k.el.classList.toggle('is-next', this.next.has(m));
  }

  // 临时闪一下某种样式（比如弹错时）
  pulse(midi, cls, ms = 450) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.el.classList.remove(cls);
    void k.el.offsetWidth;
    k.el.classList.add(cls);
    setTimeout(() => k.el.classList.remove(cls), ms);
  }

  setLabelMode(mode) {
    this.labelMode = mode;
    this.renderLabels();
  }

  renderLabels() {
    for (const [m, k] of this.keys) {
      const lbl = k.el.querySelector('.lbl');
      if (isBlack(m) || this.labelMode === 'none') {
        lbl.innerHTML = '';
        continue;
      }
      if (this.labelMode === 'letter') {
        const oct = Math.floor(m / 12) - 1;
        lbl.innerHTML = `<span class="lt">${letterName(m)}${m % 12 === 0 ? `<sub>${oct}</sub>` : ''}</span>`;
      } else {
        const jp = midiToJianpu(m);
        const up = '<i></i>'.repeat(Math.max(0, jp.oct));
        const dn = '<i></i>'.repeat(Math.max(0, -jp.oct));
        lbl.innerHTML = `<span class="jpk"><span class="dts">${up}</span><b>${jp.num}</b><span class="dts">${dn}</span></span>`;
      }
    }
  }

  // marks: Map(midi → 'safe' | 'scale' | 'root')
  setMarks(marks) {
    this.marks = marks || new Map();
    this.renderMarks();
  }

  renderMarks() {
    for (const [m, k] of this.keys) {
      const kind = this.marks.get(m);
      k.el.classList.toggle('mk-safe', kind === 'safe' || kind === 'root');
      k.el.classList.toggle('mk-root', kind === 'root');
      k.el.classList.toggle('mk-scale', kind === 'scale');
    }
  }

  setHints(hints) {
    this.hints = hints || new Map();
    this.renderHints();
  }

  renderHints() {
    for (const [m, k] of this.keys) {
      const h = this.hints.get(m);
      k.el.querySelector('.hint').textContent = h || '';
      k.el.classList.toggle('has-hint', !!h);
    }
  }

  press(midi, who) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.on[who]++;
    this.paint(midi);
  }

  release(midi, who) {
    const k = this.keys.get(midi);
    if (!k) return;
    k.on[who] = Math.max(0, k.on[who] - 1);
    this.paint(midi);
  }

  flash(midi, ms = 380) {
    this.press(midi, 'flash');
    setTimeout(() => this.release(midi, 'flash'), ms);
  }

  releaseAll(who) {
    for (const [m, k] of this.keys) {
      if (who) k.on[who] = 0;
      else for (const w of PRIORITY) k.on[w] = 0;
      this.paint(m);
    }
  }

  paint(midi) {
    const k = this.keys.get(midi);
    if (!k) return;
    const top = PRIORITY.find((w) => k.on[w] > 0);
    for (const w of PRIORITY) k.el.classList.toggle('on-' + w, w === top);
  }

  bindPointer() {
    const root = this.root;
    const keyAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const key = el && el.closest('.key');
      return key && root.contains(key) ? Number(key.dataset.midi) : null;
    };
    root.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('.key');
      if (!key) return;
      e.preventDefault();
      const m = Number(key.dataset.midi);
      this.pointers.set(e.pointerId, m);
      this.onDown && this.onDown(m);
    });
    root.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const m = keyAt(e.clientX, e.clientY);
      const prev = this.pointers.get(e.pointerId);
      if (m !== prev) {
        if (prev != null) this.onUp && this.onUp(prev);
        if (m != null) this.onDown && this.onDown(m);
        this.pointers.set(e.pointerId, m);
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      if (prev != null) this.onUp && this.onUp(prev);
      this.pointers.delete(e.pointerId);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
}
