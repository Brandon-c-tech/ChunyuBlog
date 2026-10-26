// 课程里的各种积木：示范、实验室、伴奏练习、问答游戏、自由即兴……

import { buildPiece, pieceEvents, parseChords, LH_PATTERNS, DRUM_STYLES } from './notation.js';
import { parseChord, chordToneText, lhVoicing } from './theory.js';
import { PROGRESSIONS, LESSONS } from './lessons.js';
import {
  randomPentatonic, MOTIFS, randomMotif, MOTIF_MODES, motifPiece, QA_BANK, qaPiece, CARDS,
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
    case 'random': return randomBlock(block, lesson, ctx);
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

function example(block, lesson, ctx) {
  const key = `${lesson.id}-${block.id}`;
  const sec = h('section', 'block example');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  const spec = { ...block.spec, id: key };
  const p = playable(ctx, key, { bpm: spec.bpm || 80 });
  sec.appendChild(p.pb.el);
  if (block.patternSwitch) {
    const chips = h('div', 'chips');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', '左手弹法');
    LH_PATTERNS.forEach((pt) => {
      const b = h('button', 'chip', `<b>${pt.name}</b><small>${pt.hint}</small>`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(pt.id === spec.lhPattern));
      b.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        spec.lhPattern = pt.id;
        p.setPiece(buildPiece(spec), block.title);
        p.restartIfPlaying();
      });
      chips.appendChild(b);
    });
    sec.appendChild(chips);
  }
  sec.appendChild(p.host);
  p.setPiece(buildPiece(spec), block.title);
  return sec;
}

function randomBlock(block, lesson, ctx) {
  const key = `${lesson.id}-random`;
  const sec = h('section', 'block example random');
  sec.innerHTML = blockHead(block.title, block.desc, 'h3');
  const p = playable(ctx, key, { bpm: 76, hands: false });
  const again = h('button', 'btn ghost', '换一段随机旋律');
  again.type = 'button';
  again.addEventListener('click', () => {
    p.setPiece(buildPiece(randomPentatonic(key)), block.title);
    p.start();
  });
  p.pb.el.insertBefore(again, p.pb.el.children[1]);
  sec.appendChild(p.pb.el);
  sec.appendChild(p.host);
  p.setPiece(buildPiece(randomPentatonic(key)), block.title);
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
  const chart = chordChart(preset.chords);
  const ctl = backingControls(ctx, key, {
    bpm: block.bpm,
    pattern: block.pattern,
    drums: block.drums,
    patternChoice: block.patternChoice,
    selfLH: block.selfLH,
    marks: lesson.marks,
    chart,
    getChords: () => preset.chords,
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
        chart.set(pr.chords);
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
    <div class="howto-item"><h3>看谱</h3><p>五线谱下面对齐着简谱，1 = C，中央 C 就是不带点的 1。点谱上任意一个音，能听到它，下面的键盘也会亮出位置。不需要简谱时，右上角可以关掉。</p></div>
    <div class="howto-item"><h3>看键盘</h3><ul class="legend-list"><li><i class="sw rh"></i>橙色：示范里的右手</li><li><i class="sw lh"></i>蓝色：左手</li><li><i class="sw safe"></i>绿点：现在弹一定好听的音</li><li><i class="sw you"></i>紫色：你弹的音</li><li><i class="sw sticker"></i>黄色小贴纸：中央 C</li></ul></div>
    <div class="howto-item"><h3>跟着伴奏练</h3><p>每一步都有伴奏循环：网站弹左手和鼓，你在自己的钢琴上用右手试。电钢琴用 USB 连上电脑，点右上角“连接电钢琴”，网站就能看到你弹的音。手边没琴，也能用电脑键盘弹：<kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd> 是白键，<kbd>Z</kbd><kbd>X</kbd> 换八度。</p></div>
  </div>`;
  return sec;
}

function recap() {
  const sec = h('section', 'block recap');
  const items = [
    ['step1', '五声音阶', '1 2 3 5 6，怎么弹都和谐'],
    ['step2', '动机 + 重复', 'A A A′ 收：说两遍，第三遍改一点'],
    ['step3', '模进', '把动机整体搬高、搬低'],
    ['step4', '和弦音落点', '每小节第 1 拍踩绿点'],
    ['step5', '节奏与问答', '换节奏；问句停在 2、5，答句回到 1'],
    ['step6', '左手变化', '换弹法、sus4、七和弦、转位'],
  ];
  sec.innerHTML = `<h2>你的工具箱</h2><ul class="toolbox">${items.map(([id, t, d]) => {
    const l = LESSONS.find((x) => x.id === id);
    return `<li><a href="#${id}"><span class="tb-num">${l.num}</span><span><b>${t}</b><small>${d}</small></span></a></li>`;
  }).join('')}</ul>`;
  return sec;
}
