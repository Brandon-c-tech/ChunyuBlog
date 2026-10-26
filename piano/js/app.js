// 入口：设置、路由、播放会话、底部键盘与输入

import { AudioEngine, Transport } from './audio.js';
import { Keyboard } from './keyboard.js';
import { Input, MicListener } from './input.js';
import { renderScore } from './score.js';
import { parseChord, chordToneText, midiToJianpu, noteRole, PENTA_PCS, MAJOR_PCS } from './theory.js';
import { LESSONS } from './lessons.js';
import { renderBlock, jianpuHTML } from './blocks.js';

const $ = (sel, root = document) => root.querySelector(sel);

// ---------- 本地保存（失败也不影响使用） ----------
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('impro.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try { localStorage.setItem('impro.' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
  },
};

const settings = {
  jianpu: store.get('jianpu', true),
  labels: store.get('labels', 'jianpu'),
  volume: store.get('volume', 0.8),
  hints: store.get('hints', false),
  midiSound: store.get('midiSound', false),
  autoLetter: store.get('autoLetter', false),
};
const progress = store.get('progress', { tasks: {}, seen: {} });

// ---------- 核心对象 ----------
const engine = new AudioEngine('samples/');
engine.volume = settings.volume;
const transport = new Transport(engine);

const state = {
  lesson: null,
  marksMode: 'penta',
  chord: null,
  session: null,
  views: new Map(),
  scores: new Map(),
};

const keyboard = new Keyboard($('#keyboard'), {
  labelMode: settings.labels,
  onDown: (m) => userOn(m, 0.75, 'mouse'),
  onUp: (m) => userOff(m, 'mouse'),
});

const input = new Input({ onNoteOn: userOn, onNoteOff: userOff, onChange: refreshInputUI });
const mic = new MicListener({ onNoteOn: (m) => userOn(m, 0.7, 'mic'), onNoteOff: (m) => userOff(m, 'mic') });
// 网站自己在弹右手旋律时，麦克风会把它也听进去，这段时间先不算
let siteRh = 0;
let siteRhOff = 0;

// ---------- 键盘上的标记 ----------
function computeMarks() {
  const marks = new Map();
  const mode = state.marksMode;
  for (let n = 60; n <= 84; n++) {
    const pc = n % 12;
    if (mode === 'penta') {
      if (PENTA_PCS.includes(pc)) marks.set(n, 'safe');
    } else if (mode === 'chord') {
      const ch = state.chord || parseChord('C');
      if (ch.tones.includes(pc)) marks.set(n, pc === ch.root ? 'root' : 'safe');
      else if (MAJOR_PCS.includes(pc)) marks.set(n, 'scale');
    }
  }
  return marks;
}

function refreshMarks() {
  keyboard.setMarks(computeMarks());
}

function setMarksMode(mode) {
  state.marksMode = mode;
  refreshMarks();
}

// ---------- 底部“现在”信息 ----------
const nowEl = {
  chord: $('#now-chord'),
  deg: $('#now-deg'),
  tones: $('#now-tones'),
  next: $('#now-next'),
  beats: [...document.querySelectorAll('#now-beats i')],
  count: $('#now-count'),
  box: $('#now'),
};

function chordLabelHTML(ch) {
  const m = /^([A-G][#b]?)(m(?!aj))?(.*)$/.exec(ch.sym);
  return `${m[1]}${m[2] || ''}${m[3] ? `<sup>${m[3]}</sup>` : ''}`;
}

function setChord(chord, next) {
  state.chord = chord;
  if (chord) {
    nowEl.chord.innerHTML = chordLabelHTML(chord);
    nowEl.deg.innerHTML = `${chord.degNum}${chord.degMinor ? 'm' : ''}${chord.degSup ? `<sup>${chord.degSup}</sup>` : ''}`;
    nowEl.tones.textContent = '和弦音 ' + chordToneText(chord);
    nowEl.box.classList.remove('idle');
  } else {
    nowEl.chord.textContent = '—';
    nowEl.deg.textContent = '';
    nowEl.tones.textContent = '点播放，这里会显示当前和弦';
    nowEl.box.classList.add('idle');
  }
  nowEl.next.innerHTML = next ? `下一个 <b>${chordLabelHTML(next)}</b>` : '';
  if (state.marksMode === 'chord') refreshMarks();
}

function setBeat(i) {
  nowEl.beats.forEach((b, k) => b.classList.toggle('on', k === i));
}

function showCount(n) {
  nowEl.count.textContent = n ? String(n) : '';
  nowEl.count.classList.toggle('show', !!n);
}

// ---------- 播放会话（同一时间只有一个） ----------
function startSession(opts) {
  engine.ensure();
  noteActivity();
  stopSession();
  followStop();
  const list = Array.isArray(opts.events) ? opts.events : [];
  const timeline = list.filter((e) => e.type === 'chord');
  const rhNotes = list.filter((e) => e.type === 'note' && e.hand === 'R');
  const session = { ...opts, timeline, rhNotes, nextId: null };
  state.session = session;
  if (opts.marks) setMarksMode(opts.marks);
  opts.onState && opts.onState(true);
  transport.start(
    { length: opts.length, loop: !!opts.loop, events: opts.events },
    {
      bpm: opts.bpm,
      countIn: opts.countIn || 0,
      isMuted: (ev) => {
        if (ev.type === 'note') {
          if (session.hands === 'L' && ev.hand === 'R') return true;
          if (session.hands === 'R' && ev.hand === 'L') return true;
          if (session.selfLH && ev.hand === 'L') return true;
        }
        if (ev.type === 'click') return !session.metronome;
        return false;
      },
      onVisual: (ev, on) => visual(session, ev, on),
      onTick: (beat) => {
        if (beat < 0) return;
        setBeat(Math.floor(beat) % 4);
        lookAhead(session, beat);
        session.onTick && session.onTick(beat);
      },
      onStop: () => endSession(session),
    },
  );
}

// 你自己弹右手时（只放左手），提前一拍在琴键和谱上提示下一个音
function lookAhead(session, beat) {
  let id = null;
  let next = null;
  if (session.hands === 'L' && session.rhNotes.length) {
    const len = session.length;
    const pos = session.loop ? ((beat % len) + len) % len : beat;
    next = session.rhNotes.find((e) => e.beat > pos + 0.03);
    if (!next && session.loop) next = session.rhNotes[0];
    const ahead = next ? (next.beat - pos + len) % len : Infinity;
    if (next && ahead <= 1.25) id = next.id;
  }
  if (id === session.nextId) return;
  session.nextId = id;
  const view = state.views.get(session.key);
  if (view) view.unmarkAll('is-next');
  if (id) {
    keyboard.setNext(next.midis);
    if (view) view.mark(id, 'is-next', true);
  } else keyboard.setNext(null);
}

function nextChordAfter(session, ev) {
  const tl = session.timeline;
  if (!tl.length) return null;
  const i = tl.findIndex((e) => e.beat === ev.beat);
  if (i < 0) return null;
  if (i + 1 < tl.length) return tl[i + 1].chord;
  return session.loop ? tl[0].chord : null;
}

function visual(session, ev, on) {
  const view = state.views.get(session.key);
  switch (ev.type) {
    case 'note': {
      const who = ev.hand === 'R' ? 'rh' : 'lh';
      for (const m of ev.midis) (on ? keyboard.press(m, who) : keyboard.release(m, who));
      if (view) view.set(ev.id, on, ev.hand);
      if (ev.hand === 'R' && session.hands !== 'L') {
        siteRh = Math.max(0, siteRh + (on ? 1 : -1));
        if (!on) siteRhOff = performance.now();
      }
      break;
    }
    case 'chord':
      setChord(ev.chord, ev.next || nextChordAfter(session, ev));
      if (view) view.setChord(ev.bar, ev.seg);
      session.onChord && session.onChord(ev);
      break;
    case 'bar':
      showCount(0);
      session.onBar && session.onBar(ev.index);
      break;
    case 'count':
      showCount(ev.n);
      break;
    case 'cue':
      session.onCue && session.onCue(ev);
      break;
    default:
  }
}

function endSession(session) {
  siteRh = 0;
  siteRhOff = performance.now();
  keyboard.releaseAll('rh');
  keyboard.releaseAll('lh');
  keyboard.setNext(null);
  const view = state.views.get(session.key);
  if (view) {
    view.clear();
    view.unmarkAll('is-next');
  }
  setBeat(-1);
  showCount(0);
  if (state.session === session) {
    state.session = null;
    setChord(null, null);
  }
  session.onState && session.onState(false);
}

function stopSession() {
  if (transport.playing) transport.stop();
  else if (state.session) endSession(state.session);
}

function isPlaying(key) {
  return !!(state.session && state.session.key === key && transport.playing);
}

// ---------- 乐谱注册（切换简谱、改变窗口大小时重画） ----------
function registerScore(key, host, piece, extra = {}) {
  state.scores.set(key, { host, piece, extra });
  drawScore(key);
}

function drawScore(key) {
  const s = state.scores.get(key);
  if (!s || !s.host.isConnected) return;
  const view = renderScore(s.host, s.piece, {
    jianpu: settings.jianpu,
    onNoteClick: s.extra.onNoteClick || ((ev) => previewNotes(ev.notes.map((n) => n.midi), Math.min(1.2, ev.dur * 0.55), ev.hand)),
    ariaLabel: s.extra.title ? `${s.extra.title}的乐谱` : undefined,
    divisor: s.extra.divisor,
  });
  s.width = s.host.clientWidth;
  state.views.set(key, view);
  // 重画以后把“下一个音”“选中”等标记补回来
  if (followState && followState.key === key) followShow(true);
  if (s.extra.afterDraw) s.extra.afterDraw(view);
}

function redrawAll(onlyIfResized) {
  for (const [key, s] of state.scores) {
    if (!s.host.isConnected) {
      state.scores.delete(key);
      continue;
    }
    if (onlyIfResized && Math.abs(s.host.clientWidth - s.width) < 2) continue;
    drawScore(key);
  }
}

function previewNotes(midis, seconds = 0.8, hand = 'R') {
  engine.ensure();
  noteActivity();
  const t = engine.now + 0.02;
  for (const m of midis) {
    engine.playNote(m, t, seconds, hand === 'L' ? 0.55 : 0.72);
    keyboard.flash(m, seconds * 1000);
  }
}

// ---------- 你弹的音 ----------
const liveVoices = new Map();
const trailEl = $('#trail-notes');
let trailTimer = null;

function userOn(midi, vel = 0.75, src = 'keys') {
  const external = src === 'midi' || src === 'mic';
  if (src === 'mic' && (siteRh > 0 || performance.now() - siteRhOff < 350)) return;
  if (!external) engine.ensure();
  noteActivity();
  keyboard.press(midi, 'you');
  if ((!external || (src === 'midi' && settings.midiSound)) && engine.ctx) {
    const key = src + midi;
    if (liveVoices.has(key)) liveVoices.get(key).stop();
    liveVoices.set(key, engine.playNote(midi, engine.now, null, vel));
  }
  addTrail(midi);
  if (followState) followCheck(midi);
}

// ---------- 跟弹：一个音一个音地弹，弹对了才往下走 ----------
let followState = null;

function followStart({ key, piece, onStatus, onStop }) {
  stopSession();
  followStop();
  const items = [];
  piece.bars.forEach((bar, bi) => {
    for (const ev of bar.rh) {
      if (ev.rest) continue;
      const lh = bar.lh.find((l) => !l.rest && Math.abs(l.start - ev.start) < 1e-6);
      const seg = bar.chords.find((c) => ev.start >= c.start - 1e-6 && ev.start < c.start + c.dur - 1e-6);
      items.push({ ev, lh, chord: seg ? seg.chord : null, bar: bi });
    }
  });
  if (!items.length) return;
  engine.ensure();
  noteActivity();
  followState = { key, items, idx: 0, onStatus, onStop };
  if (state.marksMode !== 'chord') setMarksMode('chord');
  followShow();
}

function followShow(quiet) {
  const f = followState;
  const it = f.items[f.idx];
  const view = state.views.get(f.key);
  if (view) {
    view.unmarkAll('is-next');
    view.mark(it.ev.id, 'is-next', true);
  }
  keyboard.setNext(it.ev.notes.map((n) => n.midi));
  if (it.chord) setChord(it.chord, null);
  if (!quiet && f.onStatus) f.onStatus({ idx: f.idx, total: f.items.length, item: it, done: f.justDone });
  f.justDone = false;
}

function followCheck(midi) {
  const f = followState;
  const it = f.items[f.idx];
  const ok = it.ev.notes.some((n) => n.midi === midi || (n.midi - midi) % 12 === 0);
  if (ok) followAdvance();
  else {
    keyboard.pulse(midi, 'is-wrong');
    if (f.onStatus) f.onStatus({ idx: f.idx, total: f.items.length, item: it, wrong: midi });
  }
}

function followAdvance() {
  const f = followState;
  if (!f) return;
  const it = f.items[f.idx];
  // 弹到和弦开始的地方，网站轻轻配上左手（开着麦克风时不配，免得被当成你弹的）
  if (it.lh && engine.ctx && !mic.active) {
    const t = engine.now + 0.01;
    for (const n of it.lh.notes) {
      engine.playNote(n.midi, t, Math.min(2.4, it.lh.dur * 0.75), 0.4);
      keyboard.flash(n.midi, 450);
    }
  }
  f.idx++;
  if (f.idx >= f.items.length) {
    f.idx = 0;
    f.justDone = true;
  }
  followShow();
}

function followBack() {
  if (!followState) return;
  followState.idx = Math.max(0, followState.idx - 1);
  followShow();
}

function followStop() {
  if (!followState) return;
  const f = followState;
  followState = null;
  const view = state.views.get(f.key);
  if (view) view.unmarkAll('is-next');
  keyboard.setNext(null);
  if (f.onStop) f.onStop();
}

window.addEventListener('keydown', (e) => {
  if (!followState || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); followAdvance(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); followBack(); }
  else if (e.key === 'Escape') followStop();
});

function userOff(midi, src = 'keys') {
  keyboard.release(midi, 'you');
  const key = src + midi;
  const v = liveVoices.get(key);
  if (v) {
    v.stop();
    liveVoices.delete(key);
  }
}

function addTrail(midi) {
  const role = state.chord ? noteRole(midi, state.chord) : 'st';
  const span = document.createElement('span');
  span.className = 'tn ' + role;
  span.innerHTML = jianpuHTML(midiToJianpu(midi));
  trailEl.appendChild(span);
  while (trailEl.children.length > 16) trailEl.firstChild.remove();
  trailEl.parentElement.classList.remove('faded', 'empty');
  clearTimeout(trailTimer);
  trailTimer = setTimeout(() => trailEl.parentElement.classList.add('faded'), 7000);
}

// ---------- 设置与工具栏 ----------
function refreshInputUI() {
  const btn = $('#btn-midi');
  const status = $('#midi-status');
  const st = input.midiState;
  btn.classList.toggle('connected', st === 'on');
  const text = {
    off: '',
    on: '已连接：' + input.devices.join('、'),
    none: '没找到电钢琴。用 USB 线连上电脑后再点一次。',
    unsupported: '这个浏览器不支持 MIDI。请用电脑上的 Chrome 或 Edge。',
    denied: '浏览器没有允许访问 MIDI。可以在地址栏左边的网站设置里打开。',
  }[st];
  status.textContent = text;
  status.hidden = !text;
  $('#midi-sound-wrap').hidden = st !== 'on';
  btn.querySelector('span').textContent = st === 'on' ? '电钢琴已连接' : '连接电钢琴';
  $('#kbd-octave').textContent = 'A = ' + ['C2', 'C3', 'C4', 'C5', 'C6'][(input.base - 36) / 12];
  keyboard.setHints(settings.hints ? input.keyHints() : null);
}

function bindTopbar() {
  const jp = $('#opt-jianpu');
  jp.checked = settings.jianpu;
  jp.addEventListener('change', () => {
    settings.jianpu = jp.checked;
    store.set('jianpu', settings.jianpu);
    document.documentElement.classList.toggle('no-jianpu', !settings.jianpu);
    // 关掉简谱时，琴键上的简谱数字也换成音名；再打开时换回来
    if (!jp.checked && settings.labels === 'jianpu') setLabels('letter', true);
    else if (jp.checked && settings.autoLetter) setLabels('jianpu', false);
    redrawAll(false);
  });
  document.documentElement.classList.toggle('no-jianpu', !settings.jianpu);

  const radios = [...document.querySelectorAll('[name="opt-labels"]')];
  const setLabels = (mode, auto) => {
    settings.labels = mode;
    settings.autoLetter = auto;
    store.set('labels', mode);
    store.set('autoLetter', auto);
    radios.forEach((r) => { r.checked = r.value === mode; });
    keyboard.setLabelMode(mode);
  };
  radios.forEach((r) => {
    r.checked = r.value === settings.labels;
    r.addEventListener('change', () => {
      if (r.checked) setLabels(r.value, false);
    });
  });

  const vol = $('#opt-volume');
  vol.value = String(Math.round(settings.volume * 100));
  vol.addEventListener('input', () => {
    settings.volume = Number(vol.value) / 100;
    store.set('volume', settings.volume);
    engine.setVolume(settings.volume);
  });

  $('#btn-midi').addEventListener('click', () => input.connectMidi());
  const micBtn = $('#btn-mic');
  const micStatus = $('#mic-status');
  micBtn.hidden = !MicListener.supported();
  const micUI = (msg) => {
    micBtn.classList.toggle('listening', mic.active);
    micBtn.setAttribute('aria-pressed', String(mic.active));
    micBtn.querySelector('span').textContent = mic.active ? '麦克风在听' : '用麦克风听我弹';
    micStatus.textContent = msg || '';
    micStatus.hidden = !msg;
  };
  micBtn.addEventListener('click', async () => {
    if (mic.active) {
      mic.stop();
      micUI('');
      return;
    }
    try {
      await mic.start(engine.ensure());
      micUI('麦克风打开了：弹单音最准，跟弹时能自动往下走。戴耳机可以避免把伴奏也听进去。');
    } catch (e) {
      micUI('没有拿到麦克风权限。可以在地址栏左边的网站设置里允许麦克风。');
    }
  });
  const ms = $('#opt-midi-sound');
  ms.checked = settings.midiSound;
  ms.addEventListener('change', () => {
    settings.midiSound = ms.checked;
    store.set('midiSound', ms.checked);
    if (ms.checked) engine.ensure();
  });

  const hints = $('#opt-hints');
  hints.checked = settings.hints;
  hints.addEventListener('change', () => {
    settings.hints = hints.checked;
    store.set('hints', hints.checked);
    refreshInputUI();
  });
  $('#oct-down').addEventListener('click', () => input.shiftOctave(-1));
  $('#oct-up').addEventListener('click', () => input.shiftOctave(1));

  engine.onChange(() => {
    const el = $('#sound-status');
    el.textContent = engine.samplesReady ? '' : '钢琴音色没有加载成功，正在用备用音色';
    el.hidden = engine.samplesReady;
  });
}

// ---------- 练习计时：30 分钟的进度 ----------
let practiceStart = null;
let lastActivity = 0;
let practiced = store.get('practiced', 0);
function noteActivity() {
  const now = Date.now();
  if (!practiceStart) practiceStart = now;
  if (lastActivity && now - lastActivity < 5 * 60 * 1000) {
    practiced += (now - lastActivity) / 1000;
  }
  lastActivity = now;
}
function renderTimer() {
  const total = Math.min(practiced, 99 * 60);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  $('#timer-text').textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const frac = Math.min(1, total / 1800);
  $('#timer-bar').style.width = (frac * 100).toFixed(1) + '%';
}
setInterval(() => {
  if (transport.playing) noteActivity();
  renderTimer();
  store.set('practiced', practiced);
}, 1000);

// ---------- 进度 ----------
function taskKey(lessonId, blockIdx, i) {
  return `${lessonId}:${blockIdx}:${i}`;
}

function lessonStatus(lesson) {
  let total = 0;
  let doneCount = 0;
  lesson.blocks.forEach((b, bi) => {
    (b.tasks || []).forEach((_, i) => {
      total++;
      if (progress.tasks[taskKey(lesson.id, bi, i)]) doneCount++;
    });
  });
  return { total, done: doneCount, finished: (total && doneCount === total) || !!progress.seen[lesson.id] };
}

function setTask(lessonId, blockIdx, i, val) {
  progress.tasks[taskKey(lessonId, blockIdx, i)] = val;
  store.set('progress', progress);
  renderRoute();
}

function markSeen(lessonId) {
  progress.seen[lessonId] = true;
  store.set('progress', progress);
  renderRoute();
}

function renderRoute() {
  const nav = $('#route-list');
  nav.innerHTML = '';
  for (const l of LESSONS) {
    const st = lessonStatus(l);
    const a = document.createElement('a');
    a.href = '#' + l.id;
    a.className = 'stop' + (state.lesson === l ? ' current' : '') + (st.finished ? ' done' : '');
    if (state.lesson === l) a.setAttribute('aria-current', 'page');
    const meta = l.minutes ? `${l.minutes} 分钟` : '随意';
    const count = st.total ? `<span class="stop-count">${st.done}/${st.total}</span>` : '';
    a.innerHTML = `<span class="stop-num">${st.finished && state.lesson !== l ? '✓' : l.num}</span><span class="stop-text"><span class="stop-title">${l.short}</span><span class="stop-meta">${meta}${count}</span></span>`;
    nav.appendChild(a);
  }
  // 窄屏时路线是一行横向滚动条，把当前这一步滚进视野
  const cur = nav.querySelector('.current');
  const bar = nav.parentElement;
  if (cur && bar.scrollWidth > bar.clientWidth) {
    bar.scrollLeft = cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2;
  }
}

// ---------- 路由 ----------
function go(id) {
  if (location.hash.slice(1) !== id) location.hash = id;
  else route();
}

function route() {
  const id = location.hash.slice(1) || 'start';
  const lesson = LESSONS.find((l) => l.id === id) || LESSONS[0];
  if (state.lesson === lesson && $('#main').childElementCount) return;
  stopSession();
  followStop();
  state.lesson = lesson;
  state.scores.clear();
  state.views.clear();
  setChord(null, null);
  setMarksMode(lesson.marks);
  renderLesson(lesson);
  renderRoute();
  $('#main-scroll').scrollTop = 0;
  document.title = lesson.num ? `第 ${lesson.num} 步 · ${lesson.short} | 即兴钢琴课` : '即兴钢琴课';
}

const ctx = {
  settings,
  engine,
  transport,
  keyboard,
  store,
  startSession,
  stopSession,
  isPlaying,
  registerScore,
  drawScore,
  previewNotes,
  setChord,
  setMarksMode,
  setTask,
  progress,
  taskKey,
  markSeen,
  go,
  followStart,
  followStop,
  followAdvance,
  isFollowing: (key) => !!(followState && followState.key === key),
  getView: (key) => state.views.get(key),
  shared: {},
  get session() { return state.session; },
  get lesson() { return state.lesson; },
};

function renderLesson(lesson) {
  const main = $('#main');
  main.innerHTML = '';
  const head = document.createElement('header');
  head.className = 'lesson-head';
  const eyebrow = lesson.num ? `第 ${lesson.num} 步${lesson.minutes ? ` · 约 ${lesson.minutes} 分钟` : ''}` : '即兴钢琴课 · 30 分钟入门';
  head.innerHTML = `<p class="eyebrow">${eyebrow}</p><h1>${lesson.title}</h1>${lesson.goal ? `<p class="goal"><span>目标</span>${lesson.goal}</p>` : ''}`;
  main.appendChild(head);
  lesson.blocks.forEach((b, i) => {
    const el = renderBlock(b, lesson, i, ctx);
    if (el) main.appendChild(el);
  });
  main.appendChild(renderNav(lesson));
  // 乐谱需要先放进页面才能量宽度
  for (const key of state.scores.keys()) drawScore(key);
}

function renderNav(lesson) {
  const i = LESSONS.indexOf(lesson);
  const prev = LESSONS[i - 1];
  const next = LESSONS[i + 1];
  const nav = document.createElement('nav');
  nav.className = 'lesson-nav';
  nav.setAttribute('aria-label', '上一步和下一步');
  if (prev) {
    const a = document.createElement('a');
    a.href = '#' + prev.id;
    a.className = 'btn ghost';
    a.textContent = '← ' + (prev.num ? `第 ${prev.num} 步` : '开始');
    nav.appendChild(a);
  } else nav.appendChild(document.createElement('span'));
  if (next) {
    const a = document.createElement('a');
    a.href = '#' + next.id;
    a.className = 'btn primary';
    a.innerHTML = `${lesson.num ? '下一步' : '开始第 1 步'}：${next.short} →`;
    a.addEventListener('click', () => markSeen(lesson.id));
    nav.appendChild(a);
  }
  return nav;
}

// ---------- 键盘宽度自适应 ----------
function fitKeyboard() {
  const w = $('#keyboard').parentElement.clientWidth;
  if (w >= 29 * 23) keyboard.setRange(36, 84);
  else if (w >= 22 * 21) keyboard.setRange(48, 84);
  else keyboard.setRange(60, 84);
  refreshMarks();
  refreshInputUI();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitKeyboard();
    redrawAll(true);
  }, 180);
});

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const v of liveVoices.values()) v.stop();
    liveVoices.clear();
    keyboard.releaseAll('you');
  }
});

function waitForVexFlow(cb, tries = 0) {
  if (window.Vex && window.Vex.Flow) cb();
  else if (tries < 100) setTimeout(() => waitForVexFlow(cb, tries + 1), 50);
  else $('#main').innerHTML = '<p class="error">乐谱组件没有加载出来，请刷新页面再试一次。</p>';
}

// 方便在浏览器控制台里调试
window.impro = { engine, transport, keyboard, input, state };

bindTopbar();
fitKeyboard();
renderTimer();
setChord(null, null);
waitForVexFlow(() => {
  route();
  document.documentElement.classList.add('ready');
});
