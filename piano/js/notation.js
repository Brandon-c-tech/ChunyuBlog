// 简谱小语言 → 乐曲数据
//
// 右手、左手都用同一种写法：
//   3 5 6 -        四分音符，"-" 延长一拍
//   3_ 5_          八分音符（下划线 = 时值减半），3__ 是十六分音符
//   3. 5_          附点四分 + 八分
//   1' 1''  5, 5,, 高八度 / 低八度
//   #4 b7          升降号
//   0              休止
//   (1,3,5,)       左手和弦：括号里的音同时弹
//   *5             落点音（谱上会标出来）
//   {问}           本小节的标签
//   |              小节线
// 和弦写法："C | Am | F G | C:3 G7:1"（不写拍数就平分本小节）

import { jianpuToMidi, midiToJianpu, parseChord, lhVoicing, smoothVoicing } from './theory.js';

export const BEATS = 4;

const NOTE_RE = /([#b]?)([0-7])([',]*)/g;
const TOKEN_RE = /^(\*?)(\([^)]*\)|[#b]?[0-7][',]*)(_*)(\.?)$/;

function noteFrom(acc, digit, marks) {
  const num = Number(digit);
  const a = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  const oct = (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length;
  return { num, acc: a, oct, midi: jianpuToMidi(num, a, oct) };
}

export function parseVoice(src) {
  const chunks = src.split('|').map((s) => s.trim());
  while (chunks.length && chunks[chunks.length - 1] === '') chunks.pop();
  return chunks.map((chunk, barIdx) => {
    const bar = { label: null, events: [] };
    let t = 0;
    for (const tok of chunk.split(/\s+/).filter(Boolean)) {
      if (tok.startsWith('{') && tok.endsWith('}')) {
        bar.label = tok.slice(1, -1);
        continue;
      }
      if (tok === '-') {
        const last = bar.events[bar.events.length - 1];
        if (!last) throw new Error(`第 ${barIdx + 1} 小节以 "-" 开头`);
        last.dur += 1;
        t += 1;
        continue;
      }
      const m = TOKEN_RE.exec(tok);
      if (!m) throw new Error(`看不懂的记号 "${tok}"（第 ${barIdx + 1} 小节）`);
      const body = m[2].startsWith('(') ? m[2].slice(1, -1) : m[2];
      const notes = [...body.matchAll(NOTE_RE)].map(([, a, d, o]) => noteFrom(a, d, o));
      let dur = Math.pow(0.5, m[3].length);
      if (m[4]) dur *= 1.5;
      const rest = notes.length === 1 && notes[0].num === 0;
      notes.sort((x, y) => x.midi - y.midi);
      bar.events.push({ start: t, dur, rest, notes: rest ? [] : notes, mark: m[1] === '*' });
      t += dur;
    }
    if (Math.abs(t - BEATS) > 1e-6) {
      throw new Error(`第 ${barIdx + 1} 小节是 ${t} 拍，应为 ${BEATS} 拍："${chunk}"`);
    }
    return bar;
  });
}

export function parseChords(src) {
  const chunks = src.split('|').map((s) => s.trim());
  while (chunks.length && chunks[chunks.length - 1] === '') chunks.pop();
  return chunks.map((chunk) => {
    const toks = chunk.split(/\s+/).filter(Boolean).map((tk) => {
      const [sym, beats] = tk.split(':');
      return { sym, beats: beats ? Number(beats) : null };
    });
    const fixed = toks.reduce((s, x) => s + (x.beats || 0), 0);
    const free = toks.filter((x) => !x.beats).length;
    const each = free ? (BEATS - fixed) / free : 0;
    let t = 0;
    return toks.map((x) => {
      const dur = x.beats || each;
      const seg = { start: t, dur, sym: x.sym, chord: parseChord(x.sym) };
      t += dur;
      return seg;
    });
  });
}

// ---------- 左手伴奏型 ----------
export const LH_PATTERNS = [
  { id: 'whole', name: '柱式和弦', hint: '1 3 5 一起按住，最稳' },
  { id: 'half', name: '两拍一次', hint: '每两拍按一次柱式和弦' },
  { id: 'root5', name: '根音 + 五音', hint: '只弹 1 和 5，干净、空旷' },
  { id: 'broken', name: '分解 1-5-1̇-5', hint: '流行抒情最常用' },
  { id: 'oompah', name: '低音 + 和弦', hint: '“嘭-嚓-嘭-嚓”，轻快' },
  { id: 'smooth', name: '转位柱式', hint: '找最近的手型，手几乎不动' },
];

function noteObjs(midis) {
  return midis.map((m) => ({ ...midiToJianpu(m), midi: m }));
}

export function lhSegmentEvents(chord, start, dur, pattern, prev) {
  const base = lhVoicing(chord);
  const v = pattern === 'smooth' ? smoothVoicing(chord, prev) : base;
  const root = base[0];
  const fifth = root + (chord.intervals.includes(6) ? 6 : 7);
  const ev = [];
  const push = (s, d, midis, sustain) =>
    ev.push({ start: s, dur: d, rest: false, notes: noteObjs(midis), mark: false, sustain });
  switch (pattern) {
    case 'half':
      for (let b = 0; b < dur - 1e-6; b += 2) push(start + b, Math.min(2, dur - b), v);
      break;
    case 'root5':
      push(start, dur, [root, fifth]);
      break;
    case 'broken': {
      const cyc = [root, fifth, root + 12, fifth];
      const n = Math.round(dur * 2);
      for (let i = 0; i < n; i++) push(start + i * 0.5, 0.5, [cyc[i % 4]], dur - i * 0.5);
      break;
    }
    case 'oompah': {
      const upper = v.slice(1);
      const low = fifth - 12;
      const n = Math.round(dur);
      for (let i = 0; i < n; i++) push(start + i, 1, i % 2 ? upper : [i % 4 === 0 ? root : low]);
      break;
    }
    default:
      push(start, dur, v);
  }
  return { events: ev, voicing: v };
}

function restBar() {
  return [{ start: 0, dur: BEATS, rest: true, notes: [], mark: false }];
}

// spec: { id, rh, lh | lhPattern, chords, bpm, drums, endBlock }
export function buildPiece(spec) {
  const rh = spec.rh ? parseVoice(spec.rh) : null;
  const chords = spec.chords ? parseChords(spec.chords) : null;
  const nBars = rh ? rh.length : chords.length;
  let lh = null;
  if (spec.lh) {
    lh = parseVoice(spec.lh).map((b) => b.events);
  } else if (spec.lhPattern && chords) {
    let prev = null;
    lh = chords.map((segs, i) => {
      const pattern = spec.endBlock && i === chords.length - 1 ? 'whole' : spec.lhPattern;
      const out = [];
      for (const s of segs) {
        const r = lhSegmentEvents(s.chord, s.start, s.dur, pattern, prev);
        prev = r.voicing;
        out.push(...r.events);
      }
      return out;
    });
  }
  const check = (arr, name) => {
    if (arr && arr.length !== nBars) throw new Error(`${spec.id}: ${name} 有 ${arr.length} 小节，右手有 ${nBars} 小节`);
  };
  check(chords, '和弦');
  check(lh, '左手');
  const bars = [];
  for (let i = 0; i < nBars; i++) {
    const bar = {
      index: i,
      label: rh ? rh[i].label : null,
      chords: chords ? chords[i] : [],
      rh: rh ? rh[i].events : restBar(),
      lh: lh ? lh[i] : restBar(),
    };
    bar.rh.forEach((e, k) => { e.id = `${spec.id}-${i}-r${k}`; e.hand = 'R'; });
    bar.lh.forEach((e, k) => { e.id = `${spec.id}-${i}-l${k}`; e.hand = 'L'; });
    bars.push(bar);
  }
  return {
    id: spec.id,
    bars,
    bpm: spec.bpm || 80,
    drums: spec.drums || 'none',
    length: nBars * BEATS,
    hasRH: !!rh,
  };
}

// ---------- 鼓 ----------
export const DRUM_STYLES = {
  none: { name: '不要鼓', parts: [] },
  soft: {
    name: '轻轻的',
    parts: [
      { inst: 'kick', steps: [0, 8], vel: [0.75] },
      { inst: 'rim', steps: [4, 12], vel: [0.5] },
      { inst: 'shaker', steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [0.45, 0.25] },
    ],
  },
  pop: {
    name: '流行鼓',
    parts: [
      { inst: 'kick', steps: [0, 8, 10], vel: [0.9, 0.85, 0.6] },
      { inst: 'snare', steps: [4, 12], vel: [0.7] },
      { inst: 'hat', steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: [0.5, 0.3] },
    ],
  },
};

// 乐曲 → 播放事件（拍为单位）
export function pieceEvents(piece, { drums, metronome } = {}) {
  const ev = [];
  const style = DRUM_STYLES[drums || piece.drums || 'none'] || DRUM_STYLES.none;
  piece.bars.forEach((bar, i) => {
    const b0 = i * BEATS;
    ev.push({ beat: b0, type: 'bar', index: i, order: 0 });
    bar.chords.forEach((c, k) =>
      ev.push({ beat: b0 + c.start, type: 'chord', chord: c.chord, bar: i, seg: k, order: 1 }));
    for (const hand of ['rh', 'lh']) {
      for (const n of bar[hand]) {
        if (n.rest) continue;
        ev.push({
          beat: b0 + n.start,
          dur: n.dur,
          sustain: n.sustain,
          type: 'note',
          hand: n.hand,
          midis: n.notes.map((x) => x.midi),
          id: n.id,
          vel: hand === 'rh' ? (n.mark ? 0.82 : 0.74) : 0.5,
          order: 2,
        });
      }
    }
    for (const p of style.parts) {
      p.steps.forEach((s, k) =>
        ev.push({ beat: b0 + s / 4, type: 'drum', inst: p.inst, vel: p.vel[k % p.vel.length], order: 2 }));
    }
    if (metronome) {
      for (let b = 0; b < BEATS; b++) ev.push({ beat: b0 + b, type: 'click', accent: b === 0, order: 2 });
    }
  });
  ev.sort((a, b) => a.beat - b.beat || a.order - b.order);
  // 每个和弦记下“下一个”和弦（循环时回到开头）
  const chords = ev.filter((e) => e.type === 'chord');
  chords.forEach((c, i) => { c.next = (chords[i + 1] || chords[0]).chord; });
  return ev;
}
