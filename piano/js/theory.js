// 乐理工具：全部以 C 大调为准（1 = C），中央 C = MIDI 60。

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DEGREE_PC = [0, 2, 4, 5, 7, 9, 11]; // 简谱 1..7 → 音级
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const MAJOR_PCS = DEGREE_PC;
export const PENTA_PCS = [0, 2, 4, 7, 9];

export const MIDDLE_C = 60;

export function isBlack(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

// 简谱音 → MIDI。num 1..7，acc -1/0/1，oct 相对中央 C 所在八度
export function jianpuToMidi(num, acc = 0, oct = 0) {
  return MIDDLE_C + 12 * oct + DEGREE_PC[num - 1] + acc;
}

// MIDI → 简谱拼写（升号为主，降 3 / 降 7 用降号）
const PC_TO_JP = [
  [1, 0], [1, 1], [2, 0], [3, -1], [3, 0], [4, 0],
  [4, 1], [5, 0], [5, 1], [6, 0], [7, -1], [7, 0],
];
export function midiToJianpu(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const [num, acc] = PC_TO_JP[pc];
  // B♭/E♭ 等降号拼写不跨八度；只有 C 才以 C 为八度起点
  const oct = Math.floor((midi - MIDDLE_C) / 12);
  return { num, acc, oct };
}

// 拼写 → 字母、八度（科学音高记号）
export function spell(jp) {
  return { letter: LETTERS[jp.num - 1], acc: jp.acc, octave: 4 + jp.oct };
}

export function letterName(midi, withOctave = false) {
  const s = spell(midiToJianpu(midi));
  const acc = s.acc > 0 ? '#' : s.acc < 0 ? 'b' : '';
  return s.letter + acc + (withOctave ? s.octave : '');
}

// 五线谱上的“位置”（每个白键一级），用来估计谱面高度
export function staffStep(jp) {
  const s = spell(jp);
  return LETTERS.indexOf(s.letter) + 7 * s.octave;
}

// VexFlow 的 key 写法，例如 "c#/4"
export function vfKey(jp) {
  const s = spell(jp);
  const acc = s.acc > 0 ? '#' : s.acc < 0 ? 'b' : '';
  return `${s.letter.toLowerCase()}${acc}/${s.octave}`;
}

// ---------- 和弦 ----------
const QUALITIES = {
  '':     { iv: [0, 4, 7] },
  m:      { iv: [0, 3, 7], minor: true },
  '7':    { iv: [0, 4, 7, 10], sup: '7' },
  maj7:   { iv: [0, 4, 7, 11], sup: 'maj7' },
  m7:     { iv: [0, 3, 7, 10], minor: true, sup: '7' },
  sus4:   { iv: [0, 5, 7], sup: 'sus4' },
  sus2:   { iv: [0, 2, 7], sup: 'sus2' },
  dim:    { iv: [0, 3, 6], sup: 'dim' },
  '6':    { iv: [0, 4, 7, 9], sup: '6' },
  add9:   { iv: [0, 4, 7, 14], sup: 'add9' },
};

const chordCache = new Map();

export function parseChord(sym) {
  if (chordCache.has(sym)) return chordCache.get(sym);
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
  if (!m || !(m[3] in QUALITIES)) throw new Error('未知和弦: ' + sym);
  const q = QUALITIES[m[3]];
  const root = (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const tones = [...new Set(q.iv.map((i) => (root + i) % 12))];
  const degIdx = DEGREE_PC.indexOf(root);
  const chord = {
    sym,
    root,
    intervals: q.iv,
    tones,
    degNum: degIdx >= 0 ? String(degIdx + 1) : '?',
    degMinor: !!q.minor,
    degSup: q.sup || '',
    // 和弦音的简谱（从根音往上）
    jianpu: tones.map((pc) => PC_TO_JP[pc]),
  };
  chord.degLabel = chord.degNum + (chord.degMinor ? 'm' : '') + chord.degSup;
  chordCache.set(sym, chord);
  return chord;
}

export function chordToneText(chord) {
  return chord.jianpu.map(([n, a]) => (a > 0 ? '#' : a < 0 ? 'b' : '') + n).join(' ');
}

// 左手原位和弦：根音放在 F2..E3 之间，七和弦用“根-三-七”
export function lhVoicing(chord) {
  let root = 36 + chord.root;
  while (root < 41) root += 12;
  while (root > 52) root -= 12;
  const iv = chord.intervals;
  let shape;
  if (iv.includes(10) || iv.includes(11)) {
    const third = iv.includes(3) ? 3 : 4;
    const seventh = iv.includes(10) ? 10 : 11;
    shape = [0, third, seventh];
  } else {
    shape = iv.filter((i) => i < 12);
  }
  return shape.map((i) => root + i);
}

// 转位：从上一个和弦就近找手型（第 6 步“转位”用）
export function smoothVoicing(chord, prev) {
  const pcs = chord.intervals.filter((i) => i < 12).map((i) => (chord.root + i) % 12);
  const candidates = [];
  for (let r = 0; r < pcs.length; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (let base = 45; base <= 56; base++) {
      if (base % 12 !== order[0]) continue;
      const notes = [base];
      for (let k = 1; k < order.length; k++) {
        let n = notes[k - 1] + 1;
        while (n % 12 !== order[k]) n++;
        notes.push(n);
      }
      if (notes[notes.length - 1] <= 60) candidates.push(notes);
    }
  }
  if (!prev) {
    // 第一个和弦尽量接近 C3-E3-G3
    prev = [48, 52, 55];
  }
  const center = prev.reduce((a, b) => a + b, 0) / prev.length;
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const cc = c.reduce((a, b) => a + b, 0) / c.length;
    const cost = Math.abs(cc - center) + 0.1 * (c[c.length - 1] - c[0]);
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  return best;
}

// 和弦级数 → 和弦（C 大调顺阶）
const DEGREE_CHORDS = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'G'];
export function chordForDegree(scaleIndex) {
  return DEGREE_CHORDS[((scaleIndex % 7) + 7) % 7];
}

// 音在当前和弦里的角色：'ct' 和弦音、'st' 音阶音、'out' 调外音
export function noteRole(midi, chord) {
  const pc = ((midi % 12) + 12) % 12;
  if (chord && chord.tones.includes(pc)) return 'ct';
  if (MAJOR_PCS.includes(pc)) return 'st';
  return 'out';
}
