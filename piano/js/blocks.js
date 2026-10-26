// 课程里的各种积木：示范、实验室、伴奏练习、问答游戏、自由即兴……

import {
  buildPiece, pieceEvents, parseChords, parseVoice, mergePieces, markChanges, sliceEvents, LH_PATTERNS, DRUM_STYLES,
} from './notation.js';
import { parseChord, chordToneText, lhVoicing, midiToJianpu, letterName, noteRole } from './theory.js';
import { PROGRESSIONS, LESSONS } from './lessons.js';
import {
  MOTIFS, randomMotif, MOTIF_MODES, motifPiece, QA_BANK, qaPiece, CARDS, noteToken,
} from './lab.js';
import { Recorder } from './input.js';

let uid = 0;

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function jianpuHTML(jp) {
  const acc = jp.acc > 0 ? '<span class="acc">#</span>' : jp.acc < 0 ? '<span class="acc">♭</span>' : '';
  const up = '<i></i>'.repeat(Math.max(0, jp.oct));
  const dn = '<i></i>'.repeat(Math.max(0, -jp.oct));
  return `<span class="jpi">${acc}<span class="jpi-col"><span class="d">${up}</span><b>${jp.num}</b><span class="d">${dn}</span></span></span>`;
}

function idxJianpu(idx) {
  return jianpuHTML({ num: (((idx % 7) + 7) % 7) + 1, acc: 0, oct: Math.floor(idx / 7) });
}

function chordName(sym) {
  const m = /^([A-G][#b]?)(m(?!aj))?(.*)$/.exec(sym);
  return `${m[1]}${m[2] || ''}${m[3] ? `<sup>${m[3]}</sup>` : ''}`;
}

function degName(ch) {
  return `${ch.degNum}${ch.degMinor ? 'm' : ''}${ch.degSup ? `<sup>${ch.degSup}</sup>` : ''}`;
}

export function renderBlock(block, lesson, idx, ctx) {
  switch (block.type) {
    case 'lead': return h('p', 'lead', block.html);
    case 'concept': return concept(block);
    case 'tip': return h('p', 'tip', `<span class="tip-label">小贴士</span>${block.html}`);
    case 'example': return example(block, lesson, ctx);
    case 'compare': return compare(block, lesson, ctx);
    case 'workbench': return workbench(block, lesson, ctx);
    case 'chordgame': return chordGame(block, lesson, ctx);
    case 'finale': return finale(block, lesson, ctx);
    case 'moves': return movesBlock(block, ctx);
    case 'lab': return lab(block, lesson, ctx);
    case 'practice': return practice(block, lesson, idx, ctx);
    case 'chords': return chordCards(block, ctx);
    case 'qa': return qa(block, lesson, ctx);
    case 'jam': return jam(lesson, ctx);
    case 'howto': return howto();
    case 'recap': return recap();
    default: return null;
  }
}

function concept(block) {
  const sec = h('section', 'block concept');
  sec.innerHTML = `<h2>${block.title}</h2><div class="prose">${block.html}</div>`;
  return sec;
}

function blockHead(title, desc, tag = 'h2') {
  return `<div class="block-head"><${tag}>${title}</${tag}>${desc ? `<p class="desc">${desc}</p>` : ''}</div>`;
}

// ---------- 播放控制条 ----------
function playerBar(o) {
  const id = o.id || 'pb' + ++uid;
  const bar = h('div', 'player');
  const play = h('button', 'btn primary play');
  play.type = 'button';
  play.innerHTML = `<span class="ico" aria-hidden="true"></span><span class="lbl">${o.playLabel || '播放'}</span>`;
  bar.appendChild(play);
  let loopBox = null;
  if (o.loop !== false) {
    const lab = h('label', 'check', `<input type="checkbox" id="${id}-loop"${o.loopDefault ? ' checked' : ''}><span>循环</span>`);
    loopBox = lab.querySelector('input');
    loopBox.addEventListener('change', () => o.onLoop && o.onLoop(loopBox.checked));
    bar.appendChild(lab);
  }
  let hands = null;
  if (o.hands !== false) {
    hands = h('div', 'seg');
    hands.setAttribute('role', 'radiogroup');
    hands.setAttribute('aria-label', '播放哪只手');
    [['both', '两只手'], ['L', '只放左手'], ['R', '只放右手']].forEach(([v, t], i) => {
      const lab = h('label', null, `<input type="radio" name="${id}-hands" id="${id}-h${v}" value="${v}"${i === 0 ? ' checked' : ''}><span>${t}</span>`);
      lab.querySelector('input').addEventListener('change', () => o.onHands && o.onHands(v));
      hands.appendChild(lab);
    });
    bar.appendChild(hands);
  }
  const tempo = h('label', 'tempo', `<span>速度</span><input type="range" id="${id}-bpm" min="40" max="140" step="2" value="${o.bpm}"><output>${o.bpm}</output>`);
  const range = tempo.querySelector('input');
  const out = tempo.querySelector('output');
  range.addEventListener('input', () => {
    out.textContent = range.value;
    o.onTempo && o.onTempo(Number(range.value));
  });
  bar.appendChild(tempo);
  return {
    el: bar,
    play,
    setPlaying(p) {
      play.classList.toggle('is-playing', p);
      play.setAttribute('aria-pressed', String(p));
      play.querySelector('.lbl').textContent = p ? '停止' : o.playLabel || '播放';
    },
    bpm: () => Number(range.value),
    hands: () => (hands ? hands.querySelector('input:checked').value : 'both'),
    loop: () => (loopBox ? loopBox.checked : false),
  };
}

// 示范、实验室共用：一个可播放的谱子
function playable(ctx, key, o) {
  const pb = playerBar({
    ...o,
    id: key,
    onTempo: (bpm) => ctx.isPlaying(key) && ctx.transport.setBpm(bpm),
    onHands: (v) => { if (ctx.isPlaying(key)) ctx.session.hands = v; },
    onLoop: (v) => { if (ctx.isPlaying(key)) ctx.transport.seq.loop = v; },
  });
  const host = h('div', 'score');
  let piece = null;
  const api = {
    pb,
    host,
    setPiece(p, title) {
      piece = p;
      ctx.registerScore(key, host, p, { title });
    },
    start() {
      ctx.startSession({
        key,
        length: piece.length,
        events: pieceEvents(piece),
        loop: pb.loop(),
        bpm: pb.bpm(),
        hands: pb.hands(),
        onState: pb.setPlaying,
      });
    },
    restartIfPlaying() {
      if (ctx.isPlaying(key)) api.start();
    },
  };
  pb.play.addEventListener('click', () => (ctx.isPlaying(key) ? ctx.stopSession() : api.start()));
  return api;
}

// ---------- 跟弹按钮：一个音一个音地弹 ----------
function followText(st) {
  const n = st.item.ev.notes[st.item.ev.notes.length - 1];
  const name = `${jianpuHTML(n)}<span class="muted">（${letterName(n.midi, true)}）</span>`;
  if (st.wrong != null) {
    return `你弹的是 ${jianpuHTML(midiToJianpu(st.wrong))}，这里要弹 ${name}。再试一次。`;
  }
  const head = st.done ? '<b class="ok">弹完一遍了！</b>从头再来：' : '';
  return `${head}第 ${st.idx + 1} / ${st.total} 个音，弹 ${name}`;
}

function followControls(ctx, key, getPiece) {
  const btn = h('button', 'btn ghost follow-btn', '<span class="lbl">一个音一个音跟弹</span>');
  btn.type = 'button';
  const box = h('div', 'follow-box');
  box.hidden = true;
  box.innerHTML = '<p class="follow-status" aria-live="polite"></p><div class="follow-actions"><button type="button" class="btn ghost small follow-next">下一个 →</button><span class="muted small">用电钢琴、电脑键盘或点琴键弹对了就会往下走。弹真钢琴时，可以打开右上角的“用麦克风听我弹”，或者弹完按 <kbd>→</kbd> 继续、<kbd>←</kbd> 退回。</span></div>';
  const status = box.querySelector('.follow-status');
  box.querySelector('.follow-next').addEventListener('click', () => ctx.followAdvance());
  const setOn = (on) => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.lbl').textContent = on ? '退出跟弹' : '一个音一个音跟弹';
    box.hidden = !on;
  };
  const start = () => {
    ctx.followStart({
      key,
      piece: getPiece(),
      onStatus: (st) => { status.innerHTML = followText(st); },
      onStop: () => setOn(false),
    });
    if (ctx.isFollowing(key)) setOn(true);
  };
  btn.addEventListener('click', () => (ctx.isFollowing(key) ? ctx.followStop() : start()));
  return { btn, box, restartIfOn: () => { if (ctx.isFollowing(key)) start(); } };
}

function example(block, lesson, ctx) {
  const key = `${lesson.id}-${block.id}`;
  const sec = h('section', 'block example');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  let spec = { ...block.spec, id: key };
  const p = playable(ctx, key, { bpm: spec.bpm || 80 });
  let piece = null;
  const fc = block.follow === false ? null : followControls(ctx, key, () => piece);
  if (fc) p.pb.el.appendChild(fc.btn);
  sec.appendChild(p.pb.el);
  const variants = block.variants
    || (block.patternSwitch ? LH_PATTERNS.map((pt) => ({ label: pt.name, hint: pt.hint, spec: { lhPattern: pt.id } })) : null);
  const set = (sp) => {
    spec = sp;
    piece = buildPiece(spec);
    p.setPiece(piece, block.title);
  };
  if (variants) {
    const chips = h('div', 'chips variants');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', block.variantsLabel || '换一种');
    variants.forEach((v, i) => {
      const b = h('button', 'chip', `<b>${v.label}</b>${v.hint ? `<small>${v.hint}</small>` : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const on = block.patternSwitch ? v.spec.lhPattern === block.spec.lhPattern : i === 0;
      b.setAttribute('aria-checked', String(on));
      b.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
        set({ ...block.spec, ...v.spec, id: key });
        p.restartIfPlaying();
        if (fc) fc.restartIfOn();
      });
      chips.appendChild(b);
    });
    sec.appendChild(chips);
  }
  if (fc) sec.appendChild(fc.box);
  sec.appendChild(p.host);
  set(spec);
  return sec;
}

// ---------- 对比：原版 vs 变奏 ----------
function compare(block, lesson, ctx) {
  const key = `${lesson.id}-${block.id}`;
  const sec = h('section', 'block example compare');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  const a = buildPiece({ bpm: 80, ...block.a, id: key + 'a' });
  const b = buildPiece({ bpm: 80, ...block.a, ...block.b, id: key + 'b' });
  const piece = markChanges(mergePieces(key, [a, b], [block.aLabel || '原版', block.bLabel || '变奏']), a.bars.length);
  const all = pieceEvents(piece);
  const half = a.length;
  let mode = null;

  const id = key;
  const bar = h('div', 'player');
  const modes = [
    ['a', block.aButton || '听原版', 'ghost'],
    ['b', block.bButton || '听变奏', 'primary'],
    ['ab', '连着听', 'ghost'],
  ];
  const btns = {};
  for (const [m, text, kind] of modes) {
    const btn = h('button', `btn ${kind} play`, `<span class="ico" aria-hidden="true"></span><span class="lbl">${text}</span>`);
    btn.type = 'button';
    btn.dataset.text = text;
    btn.addEventListener('click', () => (ctx.isPlaying(key) && mode === m ? ctx.stopSession() : start(m)));
    btns[m] = btn;
    bar.appendChild(btn);
  }
  const loop = h('label', 'check', `<input type="checkbox" id="${id}-loop"><span>循环</span>`);
  const loopBox = loop.querySelector('input');
  loopBox.addEventListener('change', () => { if (ctx.isPlaying(key)) ctx.transport.seq.loop = loopBox.checked; });
  bar.appendChild(loop);
  const hands = h('div', 'seg');
  hands.setAttribute('role', 'radiogroup');
  hands.setAttribute('aria-label', '播放哪只手');
  [['both', '两只手'], ['L', '只放左手'], ['R', '只放右手']].forEach(([v, t], i) => {
    const lab = h('label', null, `<input type="radio" name="${id}-hands" id="${id}-h${v}" value="${v}"${i === 0 ? ' checked' : ''}><span>${t}</span>`);
    lab.querySelector('input').addEventListener('change', () => { if (ctx.isPlaying(key)) ctx.session.hands = v; });
    hands.appendChild(lab);
  });
  bar.appendChild(hands);
  const bpm0 = block.a.bpm || 80;
  const tempo = h('label', 'tempo', `<span>速度</span><input type="range" id="${id}-bpm" min="40" max="140" step="2" value="${bpm0}"><output>${bpm0}</output>`);
  const range = tempo.querySelector('input');
  range.addEventListener('input', () => {
    tempo.querySelector('output').textContent = range.value;
    if (ctx.isPlaying(key)) ctx.transport.setBpm(Number(range.value));
  });
  bar.appendChild(tempo);

  const setState = (m) => {
    mode = m;
    for (const [k, btn] of Object.entries(btns)) {
      const on = k === m;
      btn.classList.toggle('is-playing', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('.lbl').textContent = on ? '停止' : btn.dataset.text;
    }
  };
  const start = (m) => {
    const events = m === 'a' ? sliceEvents(all, 0, half) : m === 'b' ? sliceEvents(all, half, 2 * half) : all;
    ctx.startSession({
      key,
      length: m === 'ab' ? 2 * half : half,
      events,
      loop: loopBox.checked,
      bpm: Number(range.value),
      hands: hands.querySelector('input:checked').value,
      onState: (on) => setState(on ? m : null),
    });
  };
  const changed = piece.bars.some((x) => x.rh.some((e) => e.changed) || x.chords.some((c) => c.changed));
  const legend = h('p', 'legend-line', changed
    ? '<i class="sw changed" aria-hidden="true"></i>粉色的音和和弦：和原版不一样的地方。上下两行的小节一一对齐，方便对照。'
    : '上下两行的小节一一对齐，方便对照。');
  const host = h('div', 'score');
  sec.append(bar, legend, host);
  ctx.registerScore(key, host, piece, { title: block.title, divisor: a.bars.length });
  return sec;
}

function lab(block, lesson, ctx) {
  const key = `${lesson.id}-lab`;
  const sec = h('section', 'block lab');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  const modes = block.modes.map((id) => MOTIF_MODES.find((m) => m.id === id));
  let motif = MOTIFS[0];
  let mode = modes[0].id;
  const p = playable(ctx, key, { bpm: 76 });

  const row1 = h('div', 'lab-row');
  row1.innerHTML = '<span class="lab-label">动机</span>';
  const motifs = h('div', 'chips motifs');
  motifs.setAttribute('role', 'radiogroup');
  motifs.setAttribute('aria-label', '选择动机');
  const select = (btn) => {
    motifs.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === btn)));
  };
  MOTIFS.forEach((m, i) => {
    const b = h('button', 'chip motif', m.notes.map(([idx]) => idxJianpu(idx)).join(''));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', '动机 ' + m.name);
    b.setAttribute('aria-checked', String(i === 0));
    b.addEventListener('click', () => {
      motif = m;
      select(b);
      update(true);
    });
    motifs.appendChild(b);
  });
  const rnd = h('button', 'chip motif rnd', '随机一个');
  rnd.type = 'button';
  rnd.setAttribute('role', 'radio');
  rnd.setAttribute('aria-checked', 'false');
  rnd.addEventListener('click', () => {
    motif = randomMotif();
    rnd.innerHTML = '随机：' + motif.notes.map(([idx]) => idxJianpu(idx)).join('');
    select(rnd);
    update(true);
  });
  motifs.appendChild(rnd);
  row1.appendChild(motifs);

  const row2 = h('div', 'lab-row');
  row2.innerHTML = '<span class="lab-label">玩法</span>';
  const seg = h('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', '玩法');
  const gid = key + '-mode';
  modes.forEach((m, i) => {
    const lab2 = h('label', null, `<input type="radio" name="${gid}" id="${gid}-${m.id}" value="${m.id}"${i === 0 ? ' checked' : ''}><span>${m.name}</span>`);
    lab2.querySelector('input').addEventListener('change', () => {
      mode = m.id;
      update(true);
    });
    seg.appendChild(lab2);
  });
  row2.appendChild(seg);
  sec.append(row1, row2, p.pb.el, p.host);

  function update(autoplay) {
    p.setPiece(buildPiece(motifPiece(motif, mode, key)), block.title);
    if (autoplay && ctx.isPlaying(key)) p.start();
  }
  update(false);
  return sec;
}

// ---------- 和弦进行的格子图 ----------
function chordChart(src, big = false) {
  const el = h('div', 'chart' + (big ? ' big' : ''));
  let cells = [];
  const api = {
    el,
    set(chordsSrc) {
      el.innerHTML = '';
      const bars = parseChords(chordsSrc);
      cells = bars.map((segs, i) => {
        const cell = h('div', 'cell');
        cell.innerHTML = `<span class="cell-n">${i + 1}</span>` + segs.map((s) => `<span class="cell-seg"><span class="cell-chord">${chordName(s.sym)}</span><span class="cell-deg">${degName(s.chord)}</span><span class="cell-tones">${chordToneText(s.chord)}</span></span>`).join('') + '<span class="cell-bar"><i></i></span>';
        el.appendChild(cell);
        return cell;
      });
      el.style.setProperty('--cols', Math.min(bars.length, 4));
    },
    setBar(i) {
      cells.forEach((c, k) => c.classList.toggle('now', k === i));
    },
    progress(beat) {
      const n = cells.length;
      if (!n) return;
      const bar = Math.floor(beat / 4) % n;
      const frac = (beat % 4) / 4;
      cells.forEach((c, k) => {
        const i = c.querySelector('.cell-bar i');
        i.style.width = k === bar ? (frac * 100).toFixed(1) + '%' : '0%';
      });
    },
    clear() {
      cells.forEach((c) => {
        c.classList.remove('now');
        c.querySelector('.cell-bar i').style.width = '0%';
      });
    },
  };
  api.set(src);
  return api;
}

function selectEl(id, label, options, value) {
  const wrap = h('label', 'select', `<span>${label}</span>`);
  const sel = h('select');
  sel.id = id;
  for (const [v, t] of options) {
    const o = h('option', null, t);
    o.value = v;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
  return { wrap, sel };
}

// ---------- 伴奏练习 ----------
function backingControls(ctx, key, o) {
  // o: { bpm, pattern, drums, patternChoice, selfLH, getChords, marks, chart, onBar }
  const id = key;
  const st = { bpm: o.bpm, pattern: o.pattern, drums: o.drums, metronome: false, selfLH: false };
  const row = h('div', 'player backing');
  const play = h('button', 'btn primary play big');
  play.type = 'button';
  play.innerHTML = '<span class="ico" aria-hidden="true"></span><span class="lbl">开始伴奏</span>';
  row.appendChild(play);

  const tempo = h('label', 'tempo', `<span>速度</span><input type="range" id="${id}-bpm" min="40" max="140" step="2" value="${st.bpm}"><output>${st.bpm}</output>`);
  const range = tempo.querySelector('input');
  range.addEventListener('input', () => {
    st.bpm = Number(range.value);
    tempo.querySelector('output').textContent = range.value;
    if (ctx.isPlaying(key)) ctx.transport.setBpm(st.bpm);
  });
  row.appendChild(tempo);

  if (o.patternChoice) {
    const s = selectEl(id + '-pat', '左手', LH_PATTERNS.map((p) => [p.id, p.name]), st.pattern);
    s.sel.addEventListener('change', () => { st.pattern = s.sel.value; api.restartIfPlaying(); });
    row.appendChild(s.wrap);
  }
  const d = selectEl(id + '-drums', '鼓', Object.entries(DRUM_STYLES).map(([k, v]) => [k, v.name]), st.drums);
  d.sel.addEventListener('change', () => { st.drums = d.sel.value; api.restartIfPlaying(); });
  row.appendChild(d.wrap);

  const met = h('label', 'check', `<input type="checkbox" id="${id}-met"><span>节拍器</span>`);
  met.querySelector('input').addEventListener('change', (e) => {
    st.metronome = e.target.checked;
    if (ctx.isPlaying(key)) ctx.session.metronome = st.metronome;
  });
  row.appendChild(met);

  if (o.selfLH) {
    const self = h('label', 'check', `<input type="checkbox" id="${id}-self"><span>左手我自己弹</span>`);
    self.querySelector('input').addEventListener('change', (e) => {
      st.selfLH = e.target.checked;
      if (ctx.isPlaying(key)) ctx.session.selfLH = st.selfLH;
    });
    row.appendChild(self);
  }

  const setPlaying = (p) => {
    play.classList.toggle('is-playing', p);
    play.setAttribute('aria-pressed', String(p));
    play.querySelector('.lbl').textContent = p ? '停止' : '开始伴奏';
    if (!p) o.chart.clear();
  };

  const api = {
    el: row,
    st,
    start() {
      const piece = buildPiece({ id: key, chords: o.getChords(), lhPattern: st.pattern });
      const events = pieceEvents(piece, { drums: st.drums, metronome: true });
      ctx.startSession({
        key,
        length: piece.length,
        events,
        loop: true,
        bpm: st.bpm,
        countIn: 4,
        marks: o.marks,
        metronome: st.metronome,
        selfLH: st.selfLH,
        onState: setPlaying,
        onBar: (i) => { o.chart.setBar(i); o.onBar && o.onBar(i); },
        onTick: (beat) => o.chart.progress(beat),
      });
    },
    restartIfPlaying() {
      if (ctx.isPlaying(key)) api.start();
    },
  };
  play.addEventListener('click', () => (ctx.isPlaying(key) ? ctx.stopSession() : api.start()));
  return api;
}

function practice(block, lesson, idx, ctx) {
  const key = `${lesson.id}-practice${idx}`;
  const sec = h('section', 'block practice');
  sec.innerHTML = blockHead(block.title, '网站负责伴奏，你在自己的钢琴上用右手弹。先有一小节“预备”拍，跟着进来就行。', 'h2');
  let preset = block.presets[0];
  // "@mine" = 你在配和弦小游戏里配的那组
  const resolve = (c) => (c === '@mine' ? ctx.shared.myChords || ctx.store.get('myChords', null) || block.presets[0].chords : c);
  const chart = chordChart(resolve(preset.chords));
  const ctl = backingControls(ctx, key, {
    bpm: block.bpm,
    pattern: block.pattern,
    drums: block.drums,
    patternChoice: block.patternChoice,
    selfLH: block.selfLH,
    marks: lesson.marks,
    chart,
    getChords: () => resolve(preset.chords),
  });
  if (block.presets.length > 1) {
    const chips = h('div', 'chips presets');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', '和弦进行');
    block.presets.forEach((pr, i) => {
      const b = h('button', 'chip', `<b>${pr.label}</b>`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === 0));
      b.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
        preset = pr;
        chart.set(resolve(pr.chords));
        ctl.restartIfPlaying();
      });
      chips.appendChild(b);
    });
    sec.appendChild(chips);
  }
  sec.appendChild(ctl.el);
  sec.appendChild(chart.el);
  const ol = h('ol', 'tasks');
  block.tasks.forEach((t, i) => {
    const li = h('li');
    const id = `${key}-task${i}`;
    li.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}">${t}</label>`;
    const cb = li.querySelector('input');
    cb.checked = !!ctx.progress.tasks[ctx.taskKey(lesson.id, idx, i)];
    cb.addEventListener('change', () => ctx.setTask(lesson.id, idx, i, cb.checked));
    ol.appendChild(li);
  });
  const tasksWrap = h('div', 'tasks-wrap', '<h3>做到了就勾一下</h3>');
  tasksWrap.appendChild(ol);
  sec.appendChild(tasksWrap);
  return sec;
}

// ---------- 和弦卡片 ----------
function miniOctave(chord) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
  const on = (pc) => chord.tones.includes(pc);
  let s = '<span class="mini" aria-hidden="true">';
  whites.forEach((pc) => { s += `<i class="w${on(pc) ? ' on' : ''}${pc === chord.root ? ' root' : ''}"></i>`; });
  blacks.forEach(([pc, pos]) => { s += `<i class="b${on(pc) ? ' on' : ''}" style="left:calc(${pos} * 100% / 7 - 4.5%)"></i>`; });
  return s + '</span>';
}

function chordCards(block, ctx) {
  const wrap = h('div', 'block chord-cards');
  for (const sym of block.list) {
    const ch = parseChord(sym);
    const card = h('button', 'chord-card');
    card.type = 'button';
    const tones = ch.jianpu.map(([n, a]) => jianpuHTML({ num: n, acc: a, oct: 0 })).join('');
    card.innerHTML = `<span class="cc-top"><span class="cc-name">${chordName(sym)}</span><span class="cc-deg">${degName(ch)}</span></span><span class="cc-tones">${tones}</span>${miniOctave(ch)}`;
    card.setAttribute('aria-label', `${sym} 和弦，和弦音 ${chordToneText(ch)}`);
    card.addEventListener('click', () => {
      ctx.stopSession();
      ctx.setMarksMode('chord');
      ctx.setChord(ch, null);
      const lh = lhVoicing(ch);
      const rh = ch.tones.map((pc) => 60 + pc).sort((a, b) => a - b);
      ctx.previewNotes(lh, 1.6, 'L');
      setTimeout(() => ctx.previewNotes(rh, 1.3, 'R'), 260);
      wrap.querySelectorAll('.chord-card').forEach((c) => c.classList.toggle('picked', c === card));
    });
    wrap.appendChild(card);
  }
  return wrap;
}

// ---------- 问答游戏 ----------
function qa(block, lesson, ctx) {
  const key = `${lesson.id}-qa`;
  const sec = h('section', 'block example qa');
  sec.innerHTML = blockHead(block.title, block.desc, 'h2');
  let showAnswer = false;
  let base = 0;
  let shown = -1;
  const pb = playerBar({
    id: key,
    bpm: 76,
    hands: false,
    loop: false,
    playLabel: '开始游戏',
    onTempo: (bpm) => ctx.isPlaying(key) && ctx.transport.setBpm(bpm),
  });
  const next = h('button', 'btn ghost', '下一题');
  next.type = 'button';
  const ans = h('label', 'check', `<input type="checkbox" id="${key}-ans"><span>网站也弹参考答句</span>`);
  pb.el.append(next, ans);
  const status = h('p', 'qa-status', '点“开始游戏”。先听网站问，再轮到你答。');
  status.setAttribute('aria-live', 'polite');
  const host = h('div', 'score');
  sec.append(pb.el, status, host);

  const pieceFor = (q) => buildPiece(qaPiece(q, showAnswer, `${key}-${q % QA_BANK.length}${showAnswer ? 'a' : ''}`));
  const show = (q) => {
    shown = q;
    ctx.registerScore(key, host, pieceFor(q), { title: block.title });
  };
  const eventsFor = (iter) => {
    const q = base + Math.floor(iter / 2);
    const ev = pieceEvents(pieceFor(q));
    ev.unshift({ beat: 0, type: 'cue', q, pass: iter % 2, phase: 'ask', order: -1 });
    ev.push({ beat: 8, type: 'cue', q, pass: iter % 2, phase: 'answer', order: -1 });
    ev.sort((a, b) => a.beat - b.beat || a.order - b.order);
    return ev;
  };
  const start = () => {
    ctx.startSession({
      key,
      length: 16,
      events: eventsFor,
      loop: true,
      bpm: pb.bpm(),
      countIn: 4,
      marks: 'chord',
      onState: (p) => {
        pb.setPlaying(p);
        if (!p) status.textContent = '游戏暂停了。再点一次“开始游戏”继续。';
      },
      onCue: (ev) => {
        if (ev.q !== shown) show(ev.q);
        const n = (ev.q % QA_BANK.length) + 1;
        const round = ev.pass === 0 ? '第 1 遍' : '第 2 遍';
        status.innerHTML = ev.phase === 'ask'
          ? `第 ${n} 题 · ${round}：<b class="ask">网站在问……</b>`
          : `第 ${n} 题 · ${round}：<b class="answer">轮到你答！</b>结尾落在 1 上。`;
      },
    });
  };
  pb.play.addEventListener('click', () => (ctx.isPlaying(key) ? ctx.stopSession() : start()));
  next.addEventListener('click', () => {
    base = shown + 1;
    show(base);
    if (ctx.isPlaying(key)) start();
    else status.textContent = `第 ${(base % QA_BANK.length) + 1} 题。点“开始游戏”，先听网站问。`;
  });
  ans.querySelector('input').addEventListener('change', (e) => {
    showAnswer = e.target.checked;
    show(shown < 0 ? 0 : shown);
  });
  show(0);
  return sec;
}

// ---------- 自由即兴 ----------
function jam(lesson, ctx) {
  const key = 'jam-room';
  const sec = h('section', 'block jam');
  let prog = PROGRESSIONS[0];
  const chart = chordChart(prog.chords, true);
  const card = h('div', 'idea');
  let cardIdx = Math.floor(Math.random() * CARDS.length);
  let autoCard = true;
  let barsPlayed = 0;
  const showCard = () => {
    card.querySelector('.idea-text').textContent = CARDS[cardIdx % CARDS.length];
  };
  card.innerHTML = `<span class="idea-label">灵感卡片</span><p class="idea-text" aria-live="polite"></p><div class="idea-actions"><button type="button" class="btn ghost small" id="idea-next">换一张</button><label class="check"><input type="checkbox" id="idea-auto" checked><span>每 8 小节自动换</span></label></div>`;
  card.querySelector('#idea-next').addEventListener('click', () => { cardIdx++; showCard(); });
  card.querySelector('#idea-auto').addEventListener('change', (e) => { autoCard = e.target.checked; });
  showCard();

  const ctl = backingControls(ctx, key, {
    bpm: 80,
    pattern: 'broken',
    drums: 'soft',
    patternChoice: true,
    selfLH: true,
    marks: 'chord',
    chart,
    getChords: () => prog.chords,
    onBar: () => {
      barsPlayed++;
      if (autoCard && barsPlayed > 1 && (barsPlayed - 1) % 8 === 0) {
        cardIdx++;
        showCard();
        card.classList.remove('flip');
        void card.offsetWidth;
        card.classList.add('flip');
      }
    },
  });

  const progs = h('div', 'progs');
  progs.setAttribute('role', 'radiogroup');
  progs.setAttribute('aria-label', '和弦进行');
  PROGRESSIONS.forEach((p, i) => {
    const b = h('button', 'prog', `<b>${p.label}</b><small>${p.name}</small>`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === 0));
    b.addEventListener('click', () => {
      progs.querySelectorAll('.prog').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
      prog = p;
      chart.set(p.chords);
      barsPlayed = 0;
      ctl.restartIfPlaying();
    });
    progs.appendChild(b);
  });

  sec.innerHTML = '<div class="block-head"><h2>选一组和弦进行</h2><p class="desc">点“开始伴奏”，等一小节预备拍，然后用右手进来。键盘上的绿点会跟着和弦走。</p></div>';
  sec.append(progs, ctl.el);
  const stage = h('div', 'jam-stage');
  stage.append(chart.el, card);
  sec.appendChild(stage);
  sec.appendChild(recorderUI());
  return sec;
}

function recorderUI() {
  const wrap = h('div', 'recorder');
  if (!Recorder.supported()) {
    wrap.innerHTML = '<p class="muted">这个浏览器不能录音。用手机录一段视频也是好办法。</p>';
    return wrap;
  }
  const rec = new Recorder();
  wrap.innerHTML = '<div class="rec-row"><button type="button" class="btn ghost rec-btn"><span class="rec-dot" aria-hidden="true"></span><span class="lbl">录下我的即兴</span></button><span class="rec-time" aria-live="polite"></span></div><p class="muted small">用电脑的麦克风把钢琴声和伴奏一起录下来，弹完马上能听回放。</p><div class="rec-out"></div>';
  const btn = wrap.querySelector('.rec-btn');
  const time = wrap.querySelector('.rec-time');
  const out = wrap.querySelector('.rec-out');
  let timer = null;
  let t0 = 0;
  btn.addEventListener('click', async () => {
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        time.textContent = '没有拿到麦克风权限。可以在地址栏左边的网站设置里允许麦克风。';
        return;
      }
      btn.classList.add('is-rec');
      btn.querySelector('.lbl').textContent = '停止录音';
      t0 = Date.now();
      timer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        time.textContent = `录音中 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 500);
    } else {
      clearInterval(timer);
      const r = await rec.stop();
      btn.classList.remove('is-rec');
      btn.querySelector('.lbl').textContent = '再录一段';
      time.textContent = '';
      if (r) {
        const ext = r.type.includes('mp4') ? 'm4a' : r.type.includes('ogg') ? 'ogg' : 'webm';
        out.innerHTML = `<audio controls src="${r.url}"></audio><a class="btn ghost small" href="${r.url}" download="我的即兴.${ext}">保存录音</a>`;
      }
    }
  });
  return wrap;
}

function howto() {
  const sec = h('section', 'block howto');
  sec.innerHTML = `<h2>这个页面怎么用</h2>
  <div class="howto-grid">
    <div class="howto-item"><h3>看谱</h3><p>五线谱下面对齐着简谱，1 = C，中央 C 就是不带点的 1。点谱上任意一个音，能听到它，下面的键盘也会亮出位置。熟悉以后，右上角可以关掉简谱。</p></div>
    <div class="howto-item"><h3>看键盘</h3><ul class="legend-list"><li><i class="sw rh"></i>橙色：示范里的右手</li><li><i class="sw lh"></i>蓝色：左手</li><li><i class="sw safe"></i>绿点：现在弹一定好听的音（和弦音）</li><li><i class="sw next"></i>虚线圈：下一个要弹的音</li><li><i class="sw you"></i>紫色：你弹的音</li><li><i class="sw changed"></i>粉色：变奏里改动过的地方</li></ul></div>
    <div class="howto-item"><h3>动手弹</h3><p>每个示范都能<b>一个音一个音跟弹</b>：键盘上圈出下一个音，弹对了才往下走。电钢琴用 USB 连上电脑后点右上角“连接电钢琴”；没有电钢琴就用电脑键盘 <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd>（<kbd>Z</kbd><kbd>X</kbd> 换八度），或者直接点琴键。弹真钢琴时，打开“用麦克风听我弹”，网站能听出你弹的单音；也可以弹完一个音按 <kbd>→</kbd> 继续。</p></div>
  </div>`;
  return sec;
}

function recap() {
  const sec = h('section', 'block recap');
  const items = [
    ['step1', '先学会一段旋律', '模仿：把主题弹熟，再弹两遍'],
    ['step2', '改一两个音', '换成同一和弦里的音（绿点）'],
    ['step3', '音阶与模进', '补上经过音；整句往上搬一级'],
    ['step4', '换节奏', '附点、切分、八分音符、留白'],
    ['step5', '配和弦', '看重拍的音选和弦；换和弦换情绪'],
    ['step6', '左手变化', '柱式、分解、sus4、七和弦'],
    ['step7', '你的表达', '装饰音、强弱、自己回答一句'],
    ['step8', '你的变奏曲', '原版 + 变奏 + 左手和弦'],
  ];
  sec.innerHTML = `<h2>你的工具箱</h2><ul class="toolbox">${items.map(([id, t, d]) => {
    const l = LESSONS.find((x) => x.id === id);
    return `<li><a href="#${id}"><span class="tb-num">${l ? l.num : ''}</span><span><b>${t}</b><small>${d}</small></span></a></li>`;
  }).join('')}</ul>`;
  return sec;
}

// ---------- 改音工作台：点一个音，往上或往下挪一格 ----------
function workbench(block, lesson, ctx) {
  const key = `${lesson.id}-${block.id}`;
  const theme = block.theme;
  const chordBars = parseChords(theme.chords);
  const toIdx = (n) => n.num - 1 + 7 * n.oct;
  const orig = parseVoice(theme.rh).map((b) => b.events.map((e) => ({ idx: e.rest ? null : toIdx(e.notes[0]), dur: e.dur, rest: e.rest })));
  let cur = orig.map((b) => b.map((n) => ({ ...n })));
  let sel = null;
  let piece = null;
  const bpm0 = theme.bpm || 80;

  const sec = h('section', 'block example workbench');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');

  // 播放：原版 / 你的版本 / 连着听
  const bar = h('div', 'player');
  const modes = [['a', '听原版', 'ghost'], ['b', '听你的版本', 'primary'], ['ab', '连着听', 'ghost']];
  const btns = {};
  let mode = null;
  const keyOf = (m) => (m === 'b' ? key : `${key}-${m}`);
  for (const [m, text, kind] of modes) {
    const btn = h('button', `btn ${kind} play`, `<span class="ico" aria-hidden="true"></span><span class="lbl">${text}</span>`);
    btn.type = 'button';
    btn.dataset.text = text;
    btn.addEventListener('click', () => (ctx.isPlaying(keyOf(m)) ? ctx.stopSession() : start(m)));
    btns[m] = btn;
    bar.appendChild(btn);
  }
  const tempo = h('label', 'tempo', `<span>速度</span><input type="range" id="${key}-bpm" min="40" max="140" step="2" value="${bpm0}"><output>${bpm0}</output>`);
  const range = tempo.querySelector('input');
  range.addEventListener('input', () => {
    tempo.querySelector('output').textContent = range.value;
    if (mode && ctx.isPlaying(keyOf(mode))) ctx.transport.setBpm(Number(range.value));
  });
  bar.appendChild(tempo);
  const setState = (m) => {
    mode = m;
    for (const [k, btn] of Object.entries(btns)) {
      const on = k === m;
      btn.classList.toggle('is-playing', on);
      btn.querySelector('.lbl').textContent = on ? '停止' : btn.dataset.text;
    }
  };

  const panel = h('div', 'wb-panel');
  panel.innerHTML = `<p class="wb-info" aria-live="polite">先点谱上任意一个右手的音（上面那行）。</p>
    <div class="wb-actions">
      <button type="button" class="btn ghost wb-up" disabled>↑ 高一级</button>
      <button type="button" class="btn ghost wb-down" disabled>↓ 低一级</button>
      <button type="button" class="btn ghost small wb-undo" disabled>还原这个音</button>
      <button type="button" class="btn ghost small wb-reset">全部还原</button>
    </div>
    <p class="wb-feedback" aria-live="polite"></p>`;
  const info = panel.querySelector('.wb-info');
  const feedback = panel.querySelector('.wb-feedback');
  const up = panel.querySelector('.wb-up');
  const down = panel.querySelector('.wb-down');
  const undo = panel.querySelector('.wb-undo');
  const host = h('div', 'score');
  sec.append(bar, panel, host);

  const rhString = (mel) => mel.map((b) => b.map((n) => (n.rest ? (n.dur >= 1 ? '0' + ' 0'.repeat(Math.round(n.dur) - 1) : '0_') : noteToken(n.idx, n.dur))).join(' ')).join(' | ');
  const idOf = (s2) => `${key}-${s2.b}-r${s2.k}`;
  const chordAt = (b, k) => {
    let t = 0;
    for (let i = 0; i < k; i++) t += cur[b][i].dur;
    return (chordBars[b].find((c) => t >= c.start - 1e-6 && t < c.start + c.dur - 1e-6) || chordBars[b][0]).chord;
  };
  const midiOf = (b, k) => piece.bars[b].rh[k].notes[0].midi;

  const build = () => {
    piece = buildPiece({ ...theme, rh: rhString(cur), id: key });
    piece.bars.forEach((pb, b) => pb.rh.forEach((e, k) => {
      if (!e.rest && cur[b][k].idx !== orig[b][k].idx) e.changed = true;
    }));
    ctx.registerScore(key, host, piece, {
      title: block.title,
      onNoteClick: (ev, hand) => { if (hand === 'R') pick(ev); },
      afterDraw: (view) => { if (sel) view.mark(idOf(sel), 'is-selected', true); },
    });
  };

  const hear = (b, k) => {
    const chord = chordAt(b, k);
    const lh = lhVoicing(chord);
    ctx.previewNotes(lh, 1.1, 'L');
    ctx.previewNotes([midiOf(b, k)], 0.9, 'R');
  };

  const describe = () => {
    if (!sel) return;
    const { b, k } = sel;
    const chord = chordAt(b, k);
    const m = midiOf(b, k);
    info.innerHTML = `第 ${b + 1} 小节第 ${k + 1} 个音：${jianpuHTML(midiToJianpu(m))}<span class="muted">（${letterName(m, true)}）</span>。这里的和弦是 <b>${chord.sym}</b>，和弦音 ${chordToneText(chord)}，就是键盘上的绿点。`;
    ctx.setMarksMode('chord');
    ctx.setChord(chord, null);
    up.disabled = false;
    down.disabled = false;
    undo.disabled = cur[b][k].idx === orig[b][k].idx;
  };

  const pick = (ev) => {
    for (let b = 0; b < piece.bars.length; b++) {
      const k = piece.bars[b].rh.indexOf(ev);
      if (k >= 0 && !ev.rest) {
        sel = { b, k };
        const view = ctx.getView(key);
        if (view) {
          view.unmarkAll('is-selected');
          view.mark(idOf(sel), 'is-selected', true);
        }
        describe();
        feedback.innerHTML = '';
        hear(b, k);
        return;
      }
    }
  };

  const judge = () => {
    const { b, k } = sel;
    const chord = chordAt(b, k);
    const m = midiOf(b, k);
    const jp = jianpuHTML(midiToJianpu(m));
    if (cur[b][k].idx === orig[b][k].idx) return '回到原来的音了。';
    if (noteRole(m, chord) === 'ct') return `<b class="ok">稳</b>${jp} 是 ${chord.sym} 和弦里的音，换上去一定好听。`;
    return `<b class="warn">有点悬</b>${jp} 不在 ${chord.sym} 和弦里，听起来像话没说完。短音没关系；如果是长音，下一个音最好回到绿点上。`;
  };

  const move = (d) => {
    if (!sel) return;
    const n = cur[sel.b][sel.k];
    n.idx = Math.max(-3, Math.min(11, n.idx + d));
    build();
    describe();
    feedback.innerHTML = judge();
    hear(sel.b, sel.k);
  };
  up.addEventListener('click', () => move(1));
  down.addEventListener('click', () => move(-1));
  undo.addEventListener('click', () => {
    if (!sel) return;
    cur[sel.b][sel.k].idx = orig[sel.b][sel.k].idx;
    build();
    describe();
    feedback.innerHTML = judge();
    hear(sel.b, sel.k);
  });
  panel.querySelector('.wb-reset').addEventListener('click', () => {
    cur = orig.map((b) => b.map((n) => ({ ...n })));
    build();
    if (sel) describe();
    feedback.innerHTML = '全部回到原版了。';
  });

  const start = (m) => {
    const a = buildPiece({ ...theme, id: `${key}-orig` });
    const p = m === 'a' ? a : m === 'b' ? piece : mergePieces(`${key}-ab`, [a, piece]);
    ctx.startSession({
      key: keyOf(m),
      length: p.length,
      events: pieceEvents(p),
      bpm: Number(range.value),
      onState: (on) => setState(on ? m : null),
    });
  };

  build();
  return sec;
}

// ---------- 配和弦小游戏 ----------
const GAME_CHORDS = ['C', 'Dm', 'Em', 'F', 'G', 'Am'];

function halfItems(bar, hIdx) {
  const lo = hIdx * 2;
  const hi = lo + 2;
  return bar.events
    .filter((e) => !e.rest && e.start < hi - 1e-6 && e.start + e.dur > lo + 1e-6)
    .map((e) => ({ e, w: Math.min(e.start + e.dur, hi) - Math.max(e.start, lo) + (Math.abs(e.start - lo) < 1e-6 ? 0.5 : 0) }));
}

function fitOf(items, chord) {
  let good = 0;
  let total = 0;
  for (const { e, w } of items) {
    total += w;
    if (chord.tones.includes(e.notes[0].midi % 12)) good += w;
  }
  const r = total ? good / total : 1;
  return r > 0.99 ? 'good' : r >= 0.5 ? 'ok' : 'bad';
}

const FIT_TEXT = { good: '稳', ok: '还行', bad: '打架' };

function chordGame(block, lesson, ctx) {
  const key = `${lesson.id}-${block.id}`;
  const theme = block.theme;
  const melody = parseVoice(theme.rh);
  const segOf = (segs, hIdx) => (segs.find((c) => hIdx * 2 >= c.start - 1e-6 && hIdx * 2 < c.start + c.dur - 1e-6) || segs[0]).sym;
  const answer = parseChords(theme.chords).map((segs) => [segOf(segs, 0), segOf(segs, 1)]);
  const saved = ctx.store.get('gameSlots', null);
  let slots = Array.isArray(saved) && saved.length === melody.length ? saved : melody.map(() => ['C', 'C']);

  const sec = h('section', 'block example chordgame');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  const p = playable(ctx, key, { bpm: theme.bpm || 80 });
  const resetBtn = h('button', 'btn ghost small', '全部换回 1 级');
  resetBtn.type = 'button';
  const answerBtn = h('button', 'btn ghost small', '看看最常见的配法');
  answerBtn.type = 'button';
  p.pb.el.append(resetBtn, answerBtn);
  const grid = h('div', 'cg-grid');
  const summary = h('p', 'cg-summary');
  summary.setAttribute('aria-live', 'polite');
  sec.append(p.pb.el, grid, summary, p.host);

  const chordsString = () => slots.map(([x, y]) => (x === y ? x : `${x} ${y}`)).join(' | ');

  const update = () => {
    const str = chordsString();
    p.setPiece(buildPiece({ rh: theme.rh, chords: str, lhPattern: 'smooth', bpm: theme.bpm, id: key }), block.title);
    ctx.shared.myChords = str;
    ctx.store.set('myChords', str);
    ctx.store.set('gameSlots', slots);
    let good = 0;
    let ok = 0;
    grid.querySelectorAll('.cg-slot').forEach((el) => {
      const b = Number(el.dataset.b);
      const hIdx = Number(el.dataset.h);
      const fit = fitOf(halfItems(melody[b], hIdx), parseChord(slots[b][hIdx]));
      el.dataset.fit = fit;
      el.querySelector('.cg-fit').textContent = FIT_TEXT[fit];
      el.querySelectorAll('.cg-opt').forEach((o) => o.setAttribute('aria-checked', String(o.dataset.sym === slots[b][hIdx])));
      if (fit === 'good') good++;
      else if (fit === 'ok') ok++;
    });
    const total = slots.length * 2;
    summary.innerHTML = `${total} 个位置里有 <b>${good}</b> 个“稳”${ok ? `，${ok} 个“还行”` : ''}。` + (good === total
      ? '全部都稳！点“播放”听听你配的和弦。'
      : '标着“打架”的位置，换一个和弦试试：看看这半小节的音在哪个和弦里。');
  };

  const preview = (b, hIdx) => {
    const chord = parseChord(slots[b][hIdx]);
    const spb = 60 / p.pb.bpm();
    ctx.previewNotes(lhVoicing(chord), 2 * spb, 'L');
    const t0 = ctx.engine.now + 0.03;
    for (const { e } of halfItems(melody[b], hIdx)) {
      const at = t0 + Math.max(0, e.start - hIdx * 2) * spb;
      ctx.engine.playNote(e.notes[0].midi, at, Math.min(e.dur, 2) * spb * 0.95, 0.72);
    }
  };

  melody.forEach((bar, b) => {
    [0, 1].forEach((hIdx) => {
      const el = h('div', 'cg-slot');
      el.dataset.b = b;
      el.dataset.h = hIdx;
      const notes = halfItems(bar, hIdx).map(({ e }) => jianpuHTML(e.notes[0])).join('');
      el.innerHTML = `<span class="cg-pos">第 ${b + 1} 小节 · ${hIdx ? '后半' : '前半'}</span><span class="cg-notes">${notes}</span><span class="cg-opts" role="radiogroup" aria-label="第 ${b + 1} 小节${hIdx ? '后半' : '前半'}的和弦"></span><span class="cg-fit"></span>`;
      const opts = el.querySelector('.cg-opts');
      for (const sym of GAME_CHORDS) {
        const ch = parseChord(sym);
        const o = h('button', 'cg-opt', `<b>${ch.degLabel}</b><small>${sym}</small>`);
        o.type = 'button';
        o.dataset.sym = sym;
        o.setAttribute('role', 'radio');
        o.addEventListener('click', () => {
          slots[b][hIdx] = sym;
          update();
          preview(b, hIdx);
        });
        opts.appendChild(o);
      }
      grid.appendChild(el);
    });
  });
  resetBtn.addEventListener('click', () => { slots = melody.map(() => ['C', 'C']); update(); });
  answerBtn.addEventListener('click', () => { slots = answer.map((x) => [...x]); update(); });
  update();
  return sec;
}

// ---------- 毕业作品：原版 + 你的变奏 ----------
function finale(block, lesson, ctx) {
  const key = `${lesson.id}-finale`;
  const theme = block.theme;
  const sets = [
    { label: '原配和弦', chords: theme.chords },
    { label: '换色（小调味）', chords: block.altChords },
    { label: '我配的和弦', chords: '@mine' },
  ];
  let set = sets[0];
  const st = { bpm: theme.bpm || 80, pattern: 'smooth', drums: 'soft', siteMelody: true, selfLH: false, metronome: false };
  const resolve = (c) => (c === '@mine' ? ctx.shared.myChords || ctx.store.get('myChords', null) || theme.chords : c);
  let piece = null;
  let round = 0;

  const sec = h('section', 'block finale');
  sec.innerHTML = blockHead(block.title, block.desc, 'h2');
  const chips = h('div', 'chips presets');
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-label', '左手和弦');
  sets.forEach((x, i) => {
    const b = h('button', 'chip', `<b>${x.label}</b>`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === 0));
    b.addEventListener('click', () => {
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
      set = x;
      build();
      if (ctx.isPlaying(key)) start();
    });
    chips.appendChild(b);
  });

  const row = h('div', 'player backing');
  const play = h('button', 'btn primary play big', '<span class="ico" aria-hidden="true"></span><span class="lbl">开始</span>');
  play.type = 'button';
  row.appendChild(play);
  const tempo = h('label', 'tempo', `<span>速度</span><input type="range" id="${key}-bpm" min="40" max="140" step="2" value="${st.bpm}"><output>${st.bpm}</output>`);
  const range = tempo.querySelector('input');
  range.addEventListener('input', () => {
    st.bpm = Number(range.value);
    tempo.querySelector('output').textContent = range.value;
    if (ctx.isPlaying(key)) ctx.transport.setBpm(st.bpm);
  });
  row.appendChild(tempo);
  const pat = selectEl(`${key}-pat`, '左手', LH_PATTERNS.map((x) => [x.id, x.name]), st.pattern);
  pat.sel.addEventListener('change', () => { st.pattern = pat.sel.value; build(); if (ctx.isPlaying(key)) start(); });
  row.appendChild(pat.wrap);
  const dr = selectEl(`${key}-drums`, '鼓', Object.entries(DRUM_STYLES).map(([k, v]) => [k, v.name]), st.drums);
  dr.sel.addEventListener('change', () => { st.drums = dr.sel.value; if (ctx.isPlaying(key)) start(); });
  row.appendChild(dr.wrap);
  const mel = h('label', 'check', `<input type="checkbox" id="${key}-mel" checked><span>网站先弹原版旋律</span>`);
  mel.querySelector('input').addEventListener('change', (e) => {
    st.siteMelody = e.target.checked;
    if (ctx.isPlaying(key)) ctx.session.hands = st.siteMelody ? 'both' : 'L';
  });
  row.appendChild(mel);
  const self = h('label', 'check', `<input type="checkbox" id="${key}-self"><span>左手我自己弹</span>`);
  self.querySelector('input').addEventListener('change', (e) => {
    st.selfLH = e.target.checked;
    if (ctx.isPlaying(key)) ctx.session.selfLH = st.selfLH;
  });
  row.appendChild(self);

  const status = h('p', 'qa-status', '点“开始”：先听一小节预备拍，网站弹 4 小节原版，接着轮到你弹 4 小节变奏，一直循环。');
  status.setAttribute('aria-live', 'polite');
  const host = h('div', 'score');
  sec.append(chips, row, status, host, recorderUI());

  function build() {
    const chords = resolve(set.chords);
    const a = buildPiece({ rh: theme.rh, chords, lhPattern: st.pattern, id: `${key}a`, bpm: st.bpm });
    const b = buildPiece({ chords, lhPattern: st.pattern, id: `${key}b`, bpm: st.bpm });
    piece = mergePieces(key, [a, b], ['原版 · 网站弹', '你的变奏 · 你来弹']);
    ctx.registerScore(key, host, piece, { title: block.title, divisor: 4 });
  }

  const setPlaying = (on) => {
    play.classList.toggle('is-playing', on);
    play.setAttribute('aria-pressed', String(on));
    play.querySelector('.lbl').textContent = on ? '停止' : '开始';
    if (!on) round = 0;
  };

  function start() {
    build();
    const ev = pieceEvents(piece, { drums: st.drums, metronome: true });
    ev.push({ beat: 0, type: 'cue', phase: 'theme', order: -1 }, { beat: 16, type: 'cue', phase: 'you', order: -1 });
    ev.sort((x, y) => x.beat - y.beat || x.order - y.order);
    round = 0;
    ctx.startSession({
      key,
      length: piece.length,
      events: ev,
      loop: true,
      bpm: st.bpm,
      countIn: 4,
      marks: 'chord',
      hands: st.siteMelody ? 'both' : 'L',
      selfLH: st.selfLH,
      metronome: st.metronome,
      onState: setPlaying,
      onCue: (e) => {
        if (e.phase === 'theme') round++;
        status.innerHTML = e.phase === 'theme'
          ? `第 ${round} 轮 · <b class="ask">原版</b>：${st.siteMelody ? '网站在弹，你听着，也可以跟着弹。' : '你先弹原版。'}`
          : `第 ${round} 轮 · <b class="answer">轮到你！</b>4 小节，弹出你的变奏。`;
      },
    });
  }
  play.addEventListener('click', () => (ctx.isPlaying(key) ? ctx.stopSession() : start()));
  build();
  return sec;
}

// ---------- 招式清单：试过就点亮 ----------
const MOVES = ['改一两个音', '用音阶连起来', '往上搬一级', '换节奏', '加装饰音', '换一组和弦', '左手换弹法', '强弱变化', '自己编一句回答'];

function movesBlock(block, ctx) {
  const saved = new Set(ctx.store.get('moves', []));
  const wrap = h('section', 'block moves');
  wrap.innerHTML = `<div class="block-head"><h3>${block.title}</h3><p class="desc">${block.desc}</p></div>`;
  const list = h('div', 'move-list');
  const count = h('p', 'move-count');
  const refresh = () => {
    count.textContent = `已经试过 ${saved.size} / ${MOVES.length} 招`;
    ctx.store.set('moves', [...saved]);
  };
  MOVES.forEach((m) => {
    const b = h('button', 'move', m);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(saved.has(m)));
    b.addEventListener('click', () => {
      if (saved.has(m)) saved.delete(m);
      else saved.add(m);
      b.setAttribute('aria-pressed', String(saved.has(m)));
      refresh();
    });
    list.appendChild(b);
  });
  wrap.append(list, count);
  refresh();
  return wrap;
}
