// 生成器：随机五声旋律、动机实验室（重复 / 改结尾 / 换节奏 / 模进）、问答题库

import { parseChord, MAJOR_PCS } from './theory.js';

// 音阶序号：0 = 1（中央 C），1 = 2 …… 7 = 1̇，-1 = 7̣
export function idxToken(idx) {
  const num = (((idx % 7) + 7) % 7) + 1;
  const oct = Math.floor(idx / 7);
  return num + (oct > 0 ? "'".repeat(oct) : ','.repeat(-oct));
}

export function noteToken(idx, dur) {
  const t = idxToken(idx);
  if (dur >= 2) return t + ' -'.repeat(Math.round(dur) - 1);
  return t + ({ 1.5: '.', 1: '', 0.75: '_.', 0.5: '_', 0.25: '__' }[dur] ?? '');
}

const PENTA_LADDER = [-3, -2, 0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14];
const C_TONES = [0, 2, 4, 7, 9, 11, 14];
const AM_TONES = [-2, 0, 2, 5, 7, 9, 12];

function nearest(list, idx) {
  return list.reduce((b, x) => (Math.abs(x - idx) < Math.abs(b - idx) ? x : b), list[0]);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 节奏模板（每个加起来正好一小节）
export const RHYTHMS = {
  2: [[2, 2], [1, 3], [3, 1]],
  3: [[1, 1, 2], [0.5, 0.5, 3], [1.5, 0.5, 2], [2, 1, 1], [1, 2, 1]],
  4: [[1, 1, 1, 1], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [2, 0.5, 0.5, 1]],
  5: [[0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2]],
};

function walk(start, n, lo = 0, hi = 9) {
  const out = [start];
  let pos = PENTA_LADDER.indexOf(nearest(PENTA_LADDER, start));
  const ok = (p) => PENTA_LADDER[p] !== undefined && PENTA_LADDER[p] >= lo && PENTA_LADDER[p] <= hi;
  for (let i = 1; i < n; i++) {
    const r = Math.random();
    let step = r < 0.55 ? 1 : r < 0.8 ? 2 : r < 0.9 ? 0 : 3;
    if (Math.random() < 0.5) step = -step;
    let next = pos + step;
    if (!ok(next)) next = pos - step;
    if (!ok(next)) next = pos;
    pos = next;
    out.push(PENTA_LADDER[pos]);
  }
  return out;
}

function barTokens(notes) {
  return notes.map(([i, d]) => noteToken(i, d)).join(' ');
}

// 第 1 步：随机五声旋律（C 和弦上 4 小节）
export function randomPentatonic(id) {
  const bars = [];
  let last = pick([0, 2, 4]);
  for (let b = 0; b < 3; b++) {
    const r = pick([...RHYTHMS[3], ...RHYTHMS[4], ...RHYTHMS[5]]);
    const pitches = walk(last, r.length + 1).slice(1);
    bars.push(r.map((d, k) => [pitches[k], d]));
    last = pitches[pitches.length - 1];
  }
  const p = walk(last, 2)[1];
  bars.push([[p, 2], [nearest([0, 2, 4, 7], p), 2]]);
  return {
    id,
    rh: bars.map(barTokens).join(' | '),
    chords: 'C | C | C | C',
    lhPattern: 'whole',
    bpm: 76,
  };
}

// ---------- 动机 ----------
export const MOTIFS = [
  { name: '3 5 6', notes: [[2, 1], [4, 1], [5, 2]] },
  { name: '5 3 2', notes: [[4, 1], [2, 1], [1, 2]] },
  { name: '1 2 3 5', notes: [[0, 0.5], [1, 0.5], [2, 1], [4, 2]] },
  { name: '6 5 3', notes: [[5, 1.5], [4, 0.5], [2, 2]] },
  { name: '3 2 1 2', notes: [[2, 1], [1, 1], [0, 1], [1, 1]] },
];

export function randomMotif() {
  const n = pick([3, 3, 4]);
  const start = pick([0, 1, 2, 4, 5]);
  const pitches = walk(start, n, 0, 7);
  const r = pick(RHYTHMS[n]);
  const notes = pitches.map((p, k) => [p, r[k]]);
  return { name: pitches.map(idxToken).join(' '), notes, random: true };
}

function shift(notes, s) {
  return notes.map(([i, d]) => [i + s, d]);
}

function withRhythm(notes, rhythm) {
  return notes.map(([i], k) => [i, rhythm[k]]);
}

// 给一小节旋律配和弦：长音、强拍上的音最好是和弦音；平分时选根音 = 动机首音的和弦（平行模进）
const CANDIDATES = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'G7'].map(parseChord);
const pcOf = (idx) => MAJOR_PCS[((idx % 7) + 7) % 7];

function harmonize(notes, firstIdx) {
  let best = CANDIDATES[0];
  let bestScore = -Infinity;
  for (const ch of CANDIDATES) {
    let t = 0;
    let score = 0;
    for (const [i, d] of notes) {
      const w = d + (t === 0 ? 1 : t === 2 ? 0.5 : 0);
      score += ch.tones.includes(pcOf(i)) ? w : -0.5 * w;
      t += d;
    }
    if (ch.root === pcOf(firstIdx) && ch.sym !== 'G7') score += 0.6;
    if (score > bestScore) { bestScore = score; best = ch; }
  }
  return best.sym;
}

export const MOTIF_MODES = [
  { id: 'aaab', name: '说两遍，第三遍改', step: 2 },
  { id: 'rhythm', name: '音不变，换节奏', step: 2 },
  { id: 'repeat', name: '原样重复四遍', step: 2 },
  { id: 'up', name: '往上爬 ↗', step: 3 },
  { id: 'down', name: '往下走 ↘', step: 3 },
  { id: 'hill', name: '上山再下山 ⛰', step: 3 },
];

export function motifPiece(motif, mode, id) {
  const A = motif.notes;
  const first = A[0][0];
  let bars;
  let chords;
  let labels;
  if (mode === 'repeat' || mode === 'aaab' || mode === 'rhythm') {
    chords = ['C', 'Am', 'C', 'Am'];
    if (mode === 'repeat') {
      bars = [A, A, A, A];
      labels = ['A', 'A', 'A', 'A'];
    } else if (mode === 'aaab') {
      // 顺着动机最后一步的方向，把结尾音换到相邻的五声音上
      const lastIdx = A[A.length - 1][0];
      const prevIdx = A.length > 1 ? A[A.length - 2][0] : lastIdx - 1;
      const pos = PENTA_LADDER.indexOf(nearest(PENTA_LADDER, lastIdx));
      const dir = lastIdx >= prevIdx ? 1 : -1;
      const alt = PENTA_LADDER[pos + dir] ?? PENTA_LADDER[pos - dir];
      const A2 = A.map((n, k) => (k === A.length - 1 ? [alt, n[1]] : n));
      // 收尾：离 A′ 结尾最近、但不是同一个音的 Am 和弦音
      const end = AM_TONES.filter((x) => x !== alt)
        .sort((x, y) => Math.abs(x - alt) - Math.abs(y - alt) || Math.abs(x - 4) - Math.abs(y - 4))[0];
      bars = [A, A, A2, [[end, 4]]];
      labels = ['A', 'A', 'A′', '收'];
    } else {
      const pool = RHYTHMS[A.length] || [A.map((n) => n[1])];
      const orig = JSON.stringify(A.map((n) => n[1]));
      const others = pool.filter((r) => JSON.stringify(r) !== orig);
      const r1 = others[0] || pool[0];
      const r2 = others[1] || r1;
      bars = [A, withRhythm(A, r1), withRhythm(A, r2), A];
      labels = ['A', '换节奏', '再换', 'A'];
    }
  } else {
    const shifts = mode === 'up' ? [0, 1, 2, 3] : mode === 'down' ? [3, 2, 1, 0] : [0, 1, 2, 3, 2, 1, 0];
    bars = shifts.map((s) => shift(A, s));
    chords = bars.map((b, k) => harmonize(b, first + shifts[k]));
    labels = shifts.map((s, k) => (k === 0 ? '原样' : s > shifts[k - 1] ? '高一级' : '低一级'));
    if (mode === 'hill') {
      const lastBar = bars[bars.length - 1];
      const end = nearest(C_TONES, lastBar[lastBar.length - 1][0]);
      bars.push([[end, 4]]);
      chords.push('C');
      labels.push('到家');
    }
  }
  return {
    id,
    rh: bars.map((b, k) => `{${labels[k]}} ${barTokens(b)}`).join(' | '),
    chords: chords.join(' | '),
    lhPattern: 'whole',
    bpm: 76,
  };
}

// ---------- 第 5 步：问答游戏（问句在 C → G 上，答句在 F → C 上） ----------
export const QA_BANK = [
  { q: '5 3 5 6 | 5 - - 0', a: '6 5 3 2 | 1 - - 0' },
  { q: '3 5 6 5 | 2 - - 0', a: "1' 6 5 3 | 1 - - 0" },
  { q: '3_ 3_ 5 6 5 | 2 - - 0', a: '6_ 6_ 5 3 2 | 1 - - 0' },
  { q: "1' 6 5 3 | 5 - - 0", a: '6 5 3 2 | 3 - 1 -' },
  { q: "3. 5_ 6 1' | 7 - - 0", a: "1'. 6_ 5 6 | 1' - - 0" },
  { q: '1 2 3 5 | 2 - - 0', a: '4 3 2 3 | 1 - - 0' },
];

export function qaPiece(i, withAnswer, id) {
  const item = QA_BANK[i % QA_BANK.length];
  const [q1, q2] = item.q.split('|').map((s) => s.trim());
  const [a1, a2] = withAnswer ? item.a.split('|').map((s) => s.trim()) : ['0 - - -', '0 - - -'];
  return {
    id,
    rh: `{问} ${q1} | ${q2} | {你来答} ${a1} | ${a2}`,
    chords: 'C | G | F | C',
    lhPattern: 'whole',
    bpm: 76,
  };
}

// ---------- 自由即兴：灵感卡片 ----------
export const CARDS = [
  '这 4 小节只用 3 个音。',
  '每小节第 1 拍，先踩一个绿点。',
  '一个动机说两遍，第三遍换结尾。',
  '一个动机往上爬三级。',
  '从高处一级一级走下来，回到 1。',
  '弹两小节，停两小节，像在对话。',
  '全部用长音，每个音至少两拍。',
  '全部用八分音符跑起来，然后突然停住。',
  '用同一个音连弹 4 下开头。',
  '弹一个问句：结尾停在 2 或 5。',
  '再接一个答句：结尾回到 1。',
  '用附点节奏（长—短）弹 4 小节。',
  '让旋律一直往上走，在最高点停住。',
  '只用 5 6 1̇ 三个音。',
  '把刚才那句整体搬高一个音，再弹一次。',
  '弹得特别轻，像在说悄悄话。',
  '最后一个音落在和弦的 3 音上。',
  '闭上眼睛弹 8 小节，只听左手。',
  '模仿左手的节奏来弹右手。',
  '先唱一句，再在琴上找出来。',
];
