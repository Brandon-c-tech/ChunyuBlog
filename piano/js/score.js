// 五线谱（VexFlow 大谱表）+ 对齐的简谱 + 和弦记号

import { vfKey, staffStep } from './theory.js';
import { BEATS } from './notation.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DURS = [
  [4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1], [1, 'q', 0],
  [0.75, '8', 1], [0.5, '8', 0], [0.375, '16', 1], [0.25, '16', 0],
];
const T_TOP = 38; // 高音谱表第五线 F5
const T_BOT = 30; // 第一线 E4
const B_TOP = 26; // 低音谱表第五线 A3
const B_BOT = 18; // 第一线 G2

function splitDur(dur) {
  const parts = [];
  let rem = dur;
  while (rem > 1e-6) {
    const f = DURS.find(([d]) => d <= rem + 1e-6);
    if (!f) break;
    parts.push({ dur: f[0], code: f[1], dots: f[2] });
    rem -= f[0];
  }
  return parts;
}

function node(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// "Am7" → ["Am", "7"]，"Cmaj7" → ["C", "maj7"]
function splitChordName(sym) {
  const m = /^([A-G][#b]?)(m(?!aj))?(.*)$/.exec(sym);
  return [m[1] + (m[2] || ''), m[3] || ''];
}

function chordText(parent, x, y, base, sup, cls) {
  const t = node('text', { x, y, class: cls }, parent);
  t.appendChild(document.createTextNode(base));
  if (sup) {
    const s = node('tspan', { dy: -6, 'font-size': '0.68em' }, t);
    s.textContent = sup;
  }
  return t;
}

export function renderScore(host, piece, opts = {}) {
  const VF = window.Vex.Flow;
  const jianpu = opts.jianpu !== false;
  host.innerHTML = '';
  const width = Math.max(300, Math.floor(host.clientWidth || 800));
  const div = document.createElement('div');
  host.appendChild(div);
  const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);

  // ---------- 竖向排版：根据实际音域留空间 ----------
  const bars = piece.bars;
  const rhNotes = bars.flatMap((b) => b.rh.flatMap((e) => e.notes));
  const lhNotes = bars.flatMap((b) => b.lh.flatMap((e) => e.notes));
  const steps = (ns) => ns.map((n) => staffStep(n));
  const rhMax = Math.max(T_TOP - 2, ...steps(rhNotes));
  const rhMin = Math.min(T_BOT + 2, ...steps(rhNotes));
  const lhMax = Math.max(B_TOP - 2, ...steps(lhNotes));
  const lhMin = Math.min(B_BOT + 2, ...steps(lhNotes));
  const hasLabels = bars.some((b) => b.label);
  const hasChords = bars.some((b) => b.chords.length);
  const maxStack = Math.max(1, ...bars.flatMap((b) => b.lh.map((e) => e.notes.length)));
  const jpUp = Math.max(0, ...rhNotes.map((n) => n.oct));
  const jpDown = Math.max(0, ...rhNotes.map((n) => -n.oct));
  const lhDotsDown = Math.max(0, ...lhNotes.map((n) => -n.oct));
  const lhDotsUp = Math.max(0, ...lhNotes.map((n) => n.oct));
  const rhSize = 18;
  const rhCap = 13;
  const lhSize = 13;
  const lhCap = 9.5;
  const lhRow = lhCap + 5 + (lhDotsDown + lhDotsUp) * 3.6;

  const L = {};
  let y = 4;
  if (hasLabels) { L.label = y + 11; y += 26; }
  if (hasChords) { L.chord = y + 15; L.deg = y + 32; y += 40; }
  L.tTop = y + Math.max(12, (rhMax - T_TOP) * 5 + 10);
  y = L.tTop + 40 + Math.max(18, (T_BOT - rhMin) * 5 + 12);
  if (jianpu) {
    L.rhJp = y + jpUp * 4.6 + rhCap + 2;
    y = L.rhJp + 9 + jpDown * 4.6 + 8;
  }
  L.bTop = y + Math.max(14, (lhMax - B_TOP) * 5 + 10);
  y = L.bTop + 40 + Math.max(16, (B_BOT - lhMin) * 5 + 10);
  if (jianpu) {
    L.lhJp = y + 2;
    y = L.lhJp + maxStack * lhRow + 10;
  }
  const lineH = y + 10;

  // ---------- 横向：每行几小节 ----------
  const nBars = bars.length;
  const density = Math.max(1, ...bars.map((b) => Math.max(b.rh.length, b.lh.length)));
  const minBarW = 84 + density * 15;
  let perLine = Math.max(1, Math.min(opts.maxPerLine || 4, Math.floor((width - 60) / minBarW)));
  const nLines = Math.ceil(nBars / perLine);
  perLine = Math.ceil(nBars / nLines);
  const totalH = nLines * lineH;
  renderer.resize(width, totalH);
  const ctx = renderer.getContext();
  const svg = div.querySelector('svg');
  svg.classList.add('score-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.ariaLabel || '五线谱与简谱');

  const view = { svg, notes: new Map(), chords: [], piece, host };
  const leftPad = 24;
  const rightPad = 8;

  for (let li = 0; li < nLines; li++) {
    const oy = li * lineH;
    const lineBars = bars.slice(li * perLine, li * perLine + perLine);
    const clefW = li === 0 ? 74 : 46;
    const barW = (width - leftPad - rightPad - clefW) / perLine;
    let x = leftPad;
    lineBars.forEach((bar, k) => {
      const first = k === 0;
      const isLast = bar.index === nBars - 1;
      const w = barW + (first ? clefW : 0);
      const so = { space_above_staff_ln: 0, space_below_staff_ln: 0 };
      const ts = new VF.Stave(x, oy + L.tTop, w, so);
      const bs = new VF.Stave(x, oy + L.bTop, w, so);
      if (first) {
        ts.addClef('treble');
        bs.addClef('bass');
        if (li === 0) {
          ts.addTimeSignature('4/4');
          bs.addTimeSignature('4/4');
        }
      } else {
        ts.setBegBarType(VF.Barline.type.NONE);
        bs.setBegBarType(VF.Barline.type.NONE);
      }
      if (isLast) {
        ts.setEndBarType(VF.Barline.type.END);
        bs.setEndBarType(VF.Barline.type.END);
      }
      const sx = Math.max(ts.getNoteStartX(), bs.getNoteStartX()) + (first ? 4 : 10);
      ts.setNoteStartX(sx);
      bs.setNoteStartX(sx);
      ts.setContext(ctx).draw();
      bs.setContext(ctx).draw();
      const C = VF.StaveConnector.type;
      if (first) {
        new VF.StaveConnector(ts, bs).setType(C.BRACE).setContext(ctx).draw();
        new VF.StaveConnector(ts, bs).setType(C.SINGLE_LEFT).setContext(ctx).draw();
      }
      new VF.StaveConnector(ts, bs).setType(isLast ? C.BOLD_DOUBLE_RIGHT : C.SINGLE_RIGHT).setContext(ctx).draw();

      // ----- 音符 -----
      const build = (events, clef) => {
        const out = [];
        const ties = [];
        for (const ev of events) {
          let off = 0;
          let prev = null;
          for (const p of splitDur(ev.dur)) {
            const dstr = p.code + 'd'.repeat(p.dots) + (ev.rest ? 'r' : '');
            const keys = ev.rest ? [clef === 'treble' ? 'b/4' : 'd/3'] : ev.notes.map(vfKey);
            const sn = new VF.StaveNote({ keys, duration: dstr, clef, auto_stem: !ev.rest });
            if (p.dots) VF.Dot.buildAndAttach([sn], { all: true });
            out.push({ sn, ev, t: ev.start + off });
            if (prev && !ev.rest) ties.push([prev, sn, ev.notes.length]);
            prev = sn;
            off += p.dur;
          }
        }
        return { out, ties };
      };
      const T = build(bar.rh, 'treble');
      const B = build(bar.lh, 'bass');
      const tv = new VF.Voice({ num_beats: BEATS, beat_value: 4 }).addTickables(T.out.map((o) => o.sn));
      const bv = new VF.Voice({ num_beats: BEATS, beat_value: 4 }).addTickables(B.out.map((o) => o.sn));
      VF.Accidental.applyAccidentals([tv], 'C');
      VF.Accidental.applyAccidentals([bv], 'C');
      const groups = [new VF.Fraction(1, 4)];
      const beams = [
        ...VF.Beam.generateBeams(T.out.map((o) => o.sn), { groups }),
        ...VF.Beam.generateBeams(B.out.map((o) => o.sn), { groups }),
      ];
      tv.setStave(ts);
      bv.setStave(bs);
      new VF.Formatter().joinVoices([tv]).joinVoices([bv]).format([tv, bv], x + w - sx - 16);
      tv.draw(ctx, ts);
      bv.draw(ctx, bs);
      beams.forEach((b) => b.setContext(ctx).draw());
      for (const [a, b, n] of [...T.ties, ...B.ties]) {
        const idx = [...Array(n).keys()];
        new VF.StaveTie({ first_note: a, last_note: b, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
      }

      // ----- 时间 → 横坐标 -----
      const center = (sn) => (sn.getNoteHeadBeginX() + sn.getNoteHeadEndX()) / 2;
      const pts = new Map();
      for (const o of [...T.out, ...B.out]) {
        const key = Math.round(o.t * 1000);
        if (!pts.has(key)) pts.set(key, []);
        pts.get(key).push(center(o.sn));
      }
      const tp = [...pts.entries()].map(([k, xs]) => [k / 1000, xs.reduce((a, b) => a + b, 0) / xs.length]);
      tp.push([BEATS, x + w - 10]);
      tp.sort((a, b) => a[0] - b[0]);
      const xAt = (t) => {
        if (t <= tp[0][0]) return tp[0][1];
        for (let i = 1; i < tp.length; i++) {
          if (t <= tp[i][0] + 1e-9) {
            const [t0, x0] = tp[i - 1];
            const [t1, x1] = tp[i];
            return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0 || 1);
          }
        }
        return tp[tp.length - 1][1];
      };

      // 记下每个音对应的 SVG 元素
      const reg = (o, hand) => {
        const g = o.sn.getSVGElement();
        if (!g) return;
        g.setAttribute('data-nid', o.ev.id);
        if (o.ev.mark) g.classList.add('is-target');
        if (!view.notes.has(o.ev.id)) view.notes.set(o.ev.id, { els: [], ev: o.ev, hand });
        view.notes.get(o.ev.id).els.push(g);
      };
      T.out.forEach((o) => !o.ev.rest && reg(o, 'R'));
      B.out.forEach((o) => !o.ev.rest && reg(o, 'L'));

      // ----- 和弦记号 -----
      bar.chords.forEach((c, si) => {
        const cx = xAt(c.start) - 7;
        const g = node('g', { class: 'chord-sym', 'data-bar': bar.index, 'data-seg': si }, svg);
        const [base, sup] = splitChordName(c.sym);
        chordText(g, cx, oy + L.chord, base, sup, 'chord-name');
        const chord = c.chord;
        const degBase = chord.degNum + (chord.degMinor ? 'm' : '');
        const t2 = chordText(g, cx + 4, oy + L.deg, degBase, chord.degSup, 'chord-deg');
        const bb = t2.getBBox ? t2.getBBox() : { x: cx + 4, y: oy + L.deg - 10, width: 14, height: 12 };
        const r = node('rect', {
          x: bb.x - 4, y: bb.y - 1, width: bb.width + 8, height: bb.height + 2, rx: 7, class: 'chord-deg-bg',
        });
        g.insertBefore(r, t2);
        view.chords.push({ bar: bar.index, seg: si, g });
      });

      // ----- 小节标签 -----
      if (bar.label) {
        const g = node('g', { class: 'bar-label' }, svg);
        const tx = node('text', { x: (first ? sx : x + 8) + 2, y: oy + L.label + 4 }, g);
        tx.textContent = bar.label;
        const bb = tx.getBBox ? tx.getBBox() : null;
        if (bb) {
          const r = node('rect', { x: bb.x - 6, y: bb.y - 3, width: bb.width + 12, height: bb.height + 6, rx: 9 });
          g.insertBefore(r, tx);
        }
      }

      // ----- 简谱 -----
      if (jianpu) {
        drawJianpuLine(svg, bar.rh, xAt, oy + L.rhJp, rhSize, rhCap, view, 'R', 1);
        drawJianpuStack(svg, bar.lh, xAt, oy + L.lhJp, lhSize, lhCap, lhRow, view);
      }
      x += w;
    });
  }

  svg.addEventListener('click', (e) => {
    const g = e.target.closest('[data-nid]');
    if (!g || !opts.onNoteClick) return;
    const n = view.notes.get(g.getAttribute('data-nid'));
    if (n) opts.onNoteClick(n.ev, n.hand);
  });

  view.set = (id, on, hand) => {
    const n = view.notes.get(id);
    if (!n) return;
    for (const g of n.els) g.classList.toggle('on-' + hand, on);
  };
  view.clear = () => {
    svg.querySelectorAll('.on-R, .on-L').forEach((g) => g.classList.remove('on-R', 'on-L'));
    view.chords.forEach((c) => c.g.classList.remove('is-current'));
  };
  view.setChord = (bar, seg) => {
    view.chords.forEach((c) => c.g.classList.toggle('is-current', c.bar === bar && c.seg === seg));
  };
  return view;
}

// 一行简谱（右手）：数字、高低音点、减时线、增时线、附点
function drawJianpuLine(svg, events, xAt, base, size, cap, view, hand) {
  const groups = [];
  let cur = null;
  events.forEach((ev) => {
    if (ev.dur < 1 - 1e-6) {
      const beat = Math.floor(ev.start + 1e-6);
      if (cur && cur.beat === beat) cur.items.push(ev);
      else { cur = { beat, items: [ev] }; groups.push(cur); }
    } else cur = null;
  });
  const underOf = (ev) => (ev.dur < 0.5 - 1e-6 ? 2 : ev.dur < 1 - 1e-6 ? 1 : 0);

  for (const ev of events) {
    const g = node('g', { class: 'jp' + (ev.rest ? ' jp-rest' : '') }, svg);
    const x = xAt(ev.start);
    const nUnder = underOf(ev);
    if (ev.rest) {
      const beats = ev.dur >= 1 ? Math.round(ev.dur) : 1;
      for (let k = 0; k < beats; k++) {
        const t = node('text', { x: xAt(ev.start + k), y: base, class: 'jp-num', 'font-size': size }, g);
        t.textContent = '0';
      }
      continue;
    }
    const note = ev.notes[ev.notes.length - 1];
    if (ev.mark) node('circle', { cx: x, cy: base - cap / 2, r: size * 0.66, class: 'jp-target' }, g);
    const t = node('text', { x, y: base, class: 'jp-num', 'font-size': size }, g);
    t.textContent = String(note.num);
    if (note.acc) {
      const a = node('text', { x: x - size * 0.48, y: base - cap * 0.55, class: 'jp-acc', 'font-size': size * 0.62 }, g);
      a.textContent = note.acc > 0 ? '#' : '♭';
    }
    for (let i = 0; i < note.oct; i++) node('circle', { cx: x, cy: base - cap - 4 - i * 4.6, r: 1.8, class: 'jp-dot' }, g);
    for (let i = 0; i < -note.oct; i++) {
      node('circle', { cx: x, cy: base + 5 + nUnder * 3.6 + i * 4.6, r: 1.8, class: 'jp-dot' }, g);
    }
    // 增时线
    const whole = Math.floor(ev.dur + 1e-6);
    for (let k = 1; k < whole; k++) {
      const dx = xAt(ev.start + k);
      node('line', { x1: dx - 6, x2: dx + 6, y1: base - cap / 2, y2: base - cap / 2, class: 'jp-line' }, g);
    }
    // 附点
    const frac = ev.dur - whole;
    const dotted = (ev.dur > 1 && Math.abs(frac - 0.5) < 1e-6) || Math.abs(ev.dur - 0.75) < 1e-6 || Math.abs(ev.dur - 0.375) < 1e-6;
    if (dotted) {
      const dx = whole >= 2 ? xAt(ev.start + whole - 1) + 10 : x + size * 0.55;
      node('circle', { cx: dx, cy: base - cap / 2, r: 2, class: 'jp-dot' }, g);
    }
    g.setAttribute('data-nid', ev.id);
    if (ev.mark) g.classList.add('is-target');
    const n = view.notes.get(ev.id);
    if (n) n.els.push(g);
    else view.notes.set(ev.id, { els: [g], ev, hand });
  }
  // 减时线（同一拍里的八分/十六分音符连在一起）
  for (const grp of groups) {
    const xs = grp.items.map((e) => xAt(e.start));
    const g = node('g', { class: 'jp-under' }, svg);
    node('line', { x1: Math.min(...xs) - 7, x2: Math.max(...xs) + 7, y1: base + 4, y2: base + 4, class: 'jp-line' }, g);
    let run = [];
    const flush = () => {
      if (run.length) {
        const rx = run.map((e) => xAt(e.start));
        node('line', { x1: Math.min(...rx) - 7, x2: Math.max(...rx) + 7, y1: base + 7.6, y2: base + 7.6, class: 'jp-line' }, g);
      }
      run = [];
    };
    for (const e of grp.items) {
      if (underOf(e) === 2) run.push(e);
      else flush();
    }
    flush();
  }
}

// 左手简谱：和弦竖着叠，低音在下
function drawJianpuStack(svg, events, xAt, top, size, cap, rowH, view) {
  const pairs = [];
  for (const ev of events) {
    const x = xAt(ev.start);
    const g = node('g', { class: 'jp jp-lh' + (ev.rest ? ' jp-rest' : '') }, svg);
    if (ev.rest) {
      const beats = ev.dur >= 1 ? Math.round(ev.dur) : 1;
      for (let k = 0; k < beats; k++) {
        const t = node('text', { x: xAt(ev.start + k), y: top + cap, class: 'jp-num', 'font-size': size }, g);
        t.textContent = '0';
      }
      continue;
    }
    const notes = [...ev.notes].sort((a, b) => b.midi - a.midi);
    const n = notes.length;
    const nUnder = ev.dur < 0.5 - 1e-6 ? 2 : ev.dur < 1 - 1e-6 ? 1 : 0;
    notes.forEach((note, i) => {
      const upDots = Math.max(0, note.oct);
      const yb = top + cap + upDots * 3.6 + i * rowH;
      const t = node('text', { x, y: yb, class: 'jp-num', 'font-size': size }, g);
      t.textContent = String(note.num);
      if (note.acc) {
        const a = node('text', { x: x - size * 0.5, y: yb - cap * 0.55, class: 'jp-acc', 'font-size': size * 0.62 }, g);
        a.textContent = note.acc > 0 ? '#' : '♭';
      }
      for (let k = 0; k < upDots; k++) node('circle', { cx: x, cy: yb - cap - 3 - k * 3.6, r: 1.4, class: 'jp-dot' }, g);
      const under = i === n - 1 ? nUnder : 0;
      for (let k = 0; k < -note.oct; k++) {
        node('circle', { cx: x, cy: yb + 4 + under * 3.4 + k * 3.6, r: 1.4, class: 'jp-dot' }, g);
      }
      if (i === n - 1 && nUnder) pairs.push({ ev, x, y: yb });
    });
    const whole = Math.floor(ev.dur + 1e-6);
    const midY = top + cap / 2 + ((n - 1) * rowH) / 2;
    for (let k = 1; k < whole; k++) {
      const dx = xAt(ev.start + k);
      node('line', { x1: dx - 5, x2: dx + 5, y1: midY, y2: midY, class: 'jp-line' }, g);
    }
    g.setAttribute('data-nid', ev.id);
    const v = view.notes.get(ev.id);
    if (v) v.els.push(g);
    else view.notes.set(ev.id, { els: [g], ev, hand: 'L' });
  }
  // 左手八分音符的减时线：按拍分组
  const byBeat = new Map();
  for (const p of pairs) {
    const key = Math.floor(p.ev.start + 1e-6) + ':' + p.y;
    if (!byBeat.has(key)) byBeat.set(key, []);
    byBeat.get(key).push(p);
  }
  for (const list of byBeat.values()) {
    const xs = list.map((p) => p.x);
    const yy = list[0].y + 3.6;
    node('line', { x1: Math.min(...xs) - 5, x2: Math.max(...xs) + 5, y1: yy, y2: yy, class: 'jp-line' }, svg);
  }
}
