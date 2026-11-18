/* 五子棋面板 UI：Canvas 棋盘、三档 AI、悔棋/提示、战绩与偏好本地保存。 */
import {
  SIZE, EMPTY, BLACK, WHITE,
  createBoard, idx, findWin, isFull, chooseMove, bestHint, other
} from './logic.mjs';

const $ = sel => document.querySelector(sel);
const board = createBoard();

const game = {
  human: BLACK,
  turn: BLACK,
  level: 'normal',
  over: false,
  winner: EMPTY,
  winLine: null,
  last: null,
  thinking: false,
  gen: 0,
  startedAt: 0,
  endedAt: 0,
  winGlowUntil: 0,
  history: [],
  hint: null,
  hover: null,
  anim: null,
  sound: true,
  stats: { win: 0, loss: 0, draw: 0, streak: 0, best: 0 }
};

const canvas = $('#board');
const ctx = canvas.getContext('2d');
let domainSnapshot = null;
let geo = { size: 0, pad: 0, cell: 0, dpr: 1 };
let hintTimer = 0;
let saveTimer = 0;
let raf = 0;
let audio = null;

const PALETTES = {
  dark: {
    board: '#3a2e25',
    sheen: 'rgba(255,238,205,0.12)',
    shade: 'rgba(0,0,0,0.30)',
    grid: 'rgba(255,240,215,0.16)',
    gridStrong: 'rgba(255,240,215,0.30)',
    star: 'rgba(255,240,215,0.50)',
    stoneShadow: 'rgba(0,0,0,0.50)',
    blackTop: '#4c4c56',
    blackMid: '#232328',
    blackBottom: '#08080a',
    whiteTop: '#ffffff',
    whiteMid: '#f7f4ea',
    whiteBottom: '#c9c2af'
  },
  light: {
    board: '#e7d3b1',
    sheen: 'rgba(255,255,255,0.40)',
    shade: 'rgba(120,80,30,0.16)',
    grid: 'rgba(92,62,28,0.46)',
    gridStrong: 'rgba(92,62,28,0.68)',
    star: 'rgba(92,62,28,0.72)',
    stoneShadow: 'rgba(80,50,20,0.30)',
    blackTop: '#4c4c56',
    blackMid: '#232328',
    blackBottom: '#08080a',
    whiteTop: '#ffffff',
    whiteMid: '#fbf8f0',
    whiteBottom: '#cbc4b2'
  }
};

function readPalette() {
  return document.documentElement.dataset.theme === 'light' ? PALETTES.light : PALETTES.dark;
}

let palette = readPalette();

function accentColor() {
  // 扩展 SDK 写入的 accent token 是 --ma-accent（theme.accent 声明经宿主注入）。
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ma-accent').trim();
  return v || '#8b7bff';
}

/* ---------- 尺寸与绘制 ---------- */

function resizeCanvas() {
  const size = canvas.getBoundingClientRect().width;
  if (size <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const pad = size * 0.055;
  geo = { size, pad, cell: (size - pad * 2) / (SIZE - 1), dpr };
  draw();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  if (!geo.size) return;
  const { size, pad, cell, dpr } = geo;
  const p = palette;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  roundRect(0.5, 0.5, size - 1, size - 1, size * 0.02);
  ctx.fillStyle = p.board;
  ctx.fill();

  const glow = ctx.createRadialGradient(size * 0.34, size * 0.22, size * 0.04, size * 0.5, size * 0.55, size * 0.9);
  glow.addColorStop(0, p.sheen);
  glow.addColorStop(1, p.shade);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.strokeStyle = p.grid;
  ctx.lineWidth = Math.max(1, size * 0.0016);
  for (let i = 0; i < SIZE; i++) {
    const v = pad + i * cell;
    ctx.beginPath(); ctx.moveTo(pad, v); ctx.lineTo(size - pad, v); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(v, pad); ctx.lineTo(v, size - pad); ctx.stroke();
  }

  ctx.strokeStyle = p.gridStrong;
  ctx.lineWidth = Math.max(1.2, size * 0.0026);
  ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

  for (const [sx, sy] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
    ctx.beginPath();
    ctx.arc(pad + sx * cell, pad + sy * cell, Math.max(1.6, cell * 0.07), 0, Math.PI * 2);
    ctx.fillStyle = p.star;
    ctx.fill();
  }

  const accent = accentColor();
  const now = performance.now();

  if (game.winLine && game.winLine.length >= 2) {
    const [ax, ay] = game.winLine[0];
    const [bx, by] = game.winLine[game.winLine.length - 1];
    const pulse = now < game.winGlowUntil ? 0.45 + 0.35 * Math.abs(Math.sin(now / 180)) : 0.72;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    // 先铺一条柔光带，让五连在相邻棋子之间也能被看见
    ctx.globalAlpha = pulse * 0.22;
    ctx.lineWidth = cell * 0.95;
    ctx.beginPath();
    ctx.moveTo(pad + ax * cell, pad + ay * cell);
    ctx.lineTo(pad + bx * cell, pad + by * cell);
    ctx.stroke();
    ctx.globalAlpha = pulse * 0.55;
    ctx.lineWidth = cell * 0.2;
    ctx.beginPath();
    ctx.moveTo(pad + ax * cell, pad + ay * cell);
    ctx.lineTo(pad + bx * cell, pad + by * cell);
    ctx.stroke();
    ctx.restore();
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[idx(x, y)];
      if (!v) continue;
      let scale = 1;
      if (game.anim && game.anim.x === x && game.anim.y === y) {
        const t = Math.min(1, (now - game.anim.start) / 180);
        scale = 0.55 + 0.45 * (1 - Math.pow(1 - t, 3));
      }
      drawStone(x, y, v, scale);
    }
  }

  if (game.winLine) {
    const pulse = now < game.winGlowUntil ? 0.55 + 0.45 * Math.abs(Math.sin(now / 160)) : 0.9;
    for (const [x, y] of game.winLine) {
      ctx.beginPath();
      ctx.arc(pad + x * cell, pad + y * cell, cell * 0.47, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = Math.max(1.5, cell * 0.075);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  if (game.last) {
    const { x, y } = game.last;
    ctx.beginPath();
    ctx.arc(pad + x * cell, pad + y * cell, Math.max(1.6, cell * 0.13), 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  if (game.hint) {
    const { x, y } = game.hint;
    const cx = pad + x * cell, cy = pad + y * cell;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.4, cell * 0.07);
    ctx.setLineDash([cell * 0.22, cell * 0.18]);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (game.hover && !game.over && !game.thinking && game.turn === game.human) {
    drawStone(game.hover.x, game.hover.y, game.turn, 1, 0.3);
  }
}

function drawStone(x, y, color, scale = 1, alpha = 1) {
  const { pad, cell } = geo;
  const p = palette;
  const cx = pad + x * cell, cy = pad + y * cell;
  const r = cell * 0.44 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = p.stoneShadow;
  ctx.shadowBlur = Math.max(2, cell * 0.16);
  ctx.shadowOffsetY = Math.max(1, cell * 0.06);
  const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.4, r * 0.12, cx, cy, r * 1.08);
  if (color === BLACK) {
    g.addColorStop(0, p.blackTop);
    g.addColorStop(0.48, p.blackMid);
    g.addColorStop(1, p.blackBottom);
  } else {
    g.addColorStop(0, p.whiteTop);
    g.addColorStop(0.55, p.whiteMid);
    g.addColorStop(1, p.whiteBottom);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2);
  ctx.strokeStyle = color === BLACK ? 'rgba(255,255,255,0.10)' : 'rgba(120,110,90,0.28)';
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.stroke();
}

function animate() {
  if (raf) return;
  const step = () => {
    draw();
    const busy = game.anim || (game.winLine && performance.now() < game.winGlowUntil);
    if (!busy) { raf = 0; return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

/* ---------- 声音 ---------- */

function tone(freq, duration = 0.07, gainValue = 0.03) {
  if (!game.sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = audio || new AC();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(gainValue, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  } catch { /* 音频不可用时静默 */ }
}

function winSound() {
  tone(523.25, 0.12, 0.03);
  setTimeout(() => tone(659.25, 0.12, 0.03), 110);
  setTimeout(() => tone(783.99, 0.2, 0.032), 220);
}

function loseSound() {
  tone(329.63, 0.14, 0.026);
  setTimeout(() => tone(261.63, 0.22, 0.024), 140);
}

/* ---------- 游戏流程 ---------- */

function newGame() {
  game.gen++;
  game.thinking = false;
  board.fill(EMPTY);
  game.history = [];
  game.turn = BLACK;
  game.over = false;
  game.winner = EMPTY;
  game.winLine = null;
  game.last = null;
  game.hint = null;
  game.hover = null;
  game.anim = null;
  game.startedAt = Date.now();
  game.endedAt = 0;
  game.winGlowUntil = 0;
  updateChrome();
  draw();
  if (game.human === WHITE) aiTurn();
}

function humanTurn() {
  return !game.over && !game.thinking && game.turn === game.human;
}

function place(x, y, color) {
  const i = idx(x, y);
  if (!(x >= 0 && y >= 0 && x < SIZE && y < SIZE) || board[i] !== EMPTY) return false;
  board[i] = color;
  game.history.push({ x, y, color });
  game.last = { x, y, color };
  game.hint = null;
  game.anim = { x, y, start: performance.now() };
  tone(color === game.human ? 620 : 430, 0.06, 0.022);
  animate();

  const line = findWin(board, x, y, color);
  if (line) {
    endGame(color, line);
    return true;
  }
  if (isFull(board)) {
    endGame(EMPTY, null);
    return true;
  }
  game.turn = other(color);
  updateChrome();
  return true;
}

function endGame(winner, line) {
  game.over = true;
  game.winner = winner;
  game.winLine = line;
  game.thinking = false;
  game.endedAt = Date.now();
  game.winGlowUntil = performance.now() + 1800;
  game.hint = null;
  game.hover = null;
  if (winner === game.human) {
    game.stats.win++;
    game.stats.streak++;
    game.stats.best = Math.max(game.stats.best, game.stats.streak);
    winSound();
  } else if (winner === other(game.human)) {
    game.stats.loss++;
    game.stats.streak = 0;
    loseSound();
  } else {
    game.stats.draw++;
  }
  persist();
  updateChrome();
  draw();
  animate();
}

function aiTurn() {
  if (game.over) return;
  game.thinking = true;
  game.hover = null;
  game.gen++;
  const token = game.gen;
  updateChrome();
  draw();
  const delay = 220 + Math.random() * 320;
  setTimeout(() => {
    if (token !== game.gen || game.over) return;
    let move = null;
    try {
      move = chooseMove(board, other(game.human), game.level);
    } catch (err) {
      console.warn('[gomoku] AI 计算失败', err);
    }
    game.thinking = false;
    if (!move) {
      updateChrome();
      return;
    }
    place(move.x, move.y, other(game.human));
    updateChrome();
  }, delay);
}

function hasHumanMove() {
  return game.history.some(m => m.color === game.human);
}

function undo() {
  if (game.thinking || game.over || !hasHumanMove()) return;
  game.gen++;
  let removed = false;
  while (game.history.length) {
    const m = game.history.pop();
    board[idx(m.x, m.y)] = EMPTY;
    if (m.color === game.human) { removed = true; break; }
  }
  if (!removed) {
    // 理论上不会出现：没有可撤的己方棋子时把 AI 的子放回去
    for (const m of game.history) board[idx(m.x, m.y)] = m.color;
  }
  game.over = false;
  game.winner = EMPTY;
  game.winLine = null;
  game.hint = null;
  game.anim = null;
  game.last = game.history.length ? game.history[game.history.length - 1] : null;
  game.turn = game.human;
  updateChrome();
  draw();
  if (!game.history.length && game.human === WHITE) aiTurn();
}

function showHint() {
  if (!humanTurn() || !game.history.length) return;
  const move = bestHint(board, game.human) || chooseMove(board, game.human, 'normal');
  if (!move) return;
  game.hint = { x: move.x, y: move.y };
  draw();
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    game.hint = null;
    draw();
  }, 5000);
  updateChrome();
}

/* ---------- 状态渲染 ---------- */

function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = String(m).padStart(2, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

function sideName(color) {
  return color === BLACK ? '黑' : '白';
}

function updateChrome() {
  const dot = $('#turnDot');
  const main = $('#statusMain');
  const sub = $('#statusSub');

  let dotClass = 'dot';
  let mainText = '';
  let subText = '';
  if (game.over) {
    if (game.winner === EMPTY) {
      dotClass += ' draw';
      mainText = '平局';
      subText = `棋盘已满 · 共用时 ${fmtDuration(game.endedAt - game.startedAt)}`;
    } else if (game.winner === game.human) {
      dotClass += ' win';
      mainText = '你赢了！';
      subText = `五连达成 · 用时 ${fmtDuration(game.endedAt - game.startedAt)} · ${game.history.length} 手`;
    } else {
      dotClass += ' lose';
      mainText = 'AI 赢了';
      subText = `用时 ${fmtDuration(game.endedAt - game.startedAt)} · 再来一局？`;
    }
  } else if (game.thinking) {
    dotClass += ' think';
    mainText = 'AI 正在思考…';
    subText = `执${sideName(game.human)} · 已落 ${game.history.length} 手`;
  } else {
    dotClass += game.turn === BLACK ? ' black' : ' white';
    mainText = game.turn === game.human ? '轮到你落子' : 'AI 回合';
    subText = `执${sideName(game.human)} · 第 ${game.history.length + 1} 手`;
  }
  dot.className = dotClass;
  main.textContent = mainText;
  sub.textContent = subText;

  $('#timer').textContent = fmtDuration((game.over ? game.endedAt : Date.now()) - game.startedAt);
  $('#moves').textContent = `${game.history.length} 手`;

  $('#undoBtn').disabled = game.thinking || game.over || !hasHumanMove();
  $('#hintBtn').disabled = !humanTurn() || !game.history.length;
  $('#newBtn').textContent = game.over ? '再来一局' : '新开一局';

  $('#statWin').textContent = String(game.stats.win);
  $('#statLoss').textContent = String(game.stats.loss);
  $('#statDraw').textContent = String(game.stats.draw);
  $('#streakText').textContent = `连胜 ${game.stats.streak} · 最佳 ${game.stats.best}`;

  for (const btn of document.querySelectorAll('#levels button')) {
    btn.classList.toggle('on', btn.dataset.level === game.level);
  }
  for (const btn of document.querySelectorAll('#sides button')) {
    const side = btn.dataset.side === 'black' ? BLACK : WHITE;
    btn.classList.toggle('on', side === game.human);
  }
  $('#soundIcon').setAttribute('href', game.sound ? '#i-vol' : '#i-mute');
  $('#soundBtn').classList.toggle('off', !game.sound);
  canvas.setAttribute('aria-label', `五子棋棋盘，15 路，当前${game.over ? '已结束' : `${game.thinking ? 'AI 思考中' : game.turn === game.human ? '轮到你' : 'AI 回合'}`}，共 ${game.history.length} 手`);
}

/* ---------- 本地保存 ---------- */

const store = {
  async get(key) {
    if (typeof ma === 'undefined') return null;
    try { return await ma.storage.get(key); } catch { return null; }
  },
  async set(key, value) {
    if (typeof ma === 'undefined') return false;
    try { await ma.storage.set(key, value); return true; } catch (err) {
      console.warn('[gomoku] 保存失败', err);
      return false;
    }
  }
};

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void store.set('stats', game.stats);
    void store.set('prefs', { level: game.level, human: game.human, sound: game.sound });
  }, 300);
}

function colorNumber(value) { return value === 'black' ? BLACK : value === 'white' ? WHITE : EMPTY; }

function syncFromDomain(snapshot) {
  domainSnapshot = snapshot;
  const state = snapshot?.state || {};
  board.fill(EMPTY);
  (state.board || []).forEach((row, y) => (row || []).forEach((value, x) => { if (y < SIZE && x < SIZE) board[idx(x, y)] = colorNumber(value); }));
  game.human = state.human === 'white' ? WHITE : BLACK;
  game.turn = state.turn === 'white' ? WHITE : BLACK;
  game.level = ['easy', 'normal', 'hard'].includes(state.level) ? state.level : 'normal';
  game.over = !!state.over;
  game.winner = colorNumber(state.winner);
  game.winLine = Array.isArray(state.winLine) ? state.winLine.map(([row, col]) => [col, row]) : null;
  game.last = state.last ? { x: state.last.col, y: state.last.row, color: colorNumber(state.last.color) } : null;
  game.history = Array.isArray(state.history) ? state.history.map(move => ({ x: move.col, y: move.row, color: colorNumber(move.color), actor: move.actor })) : [];
  game.hint = state.hint ? { x: state.hint.col, y: state.hint.row } : null;
  game.stats = state.stats || game.stats;
  game.startedAt = state.startedAt || Date.now();
  game.endedAt = state.endedAt || 0;
  game.thinking = false;
  game.anim = null;
}

async function refreshDomain() {
  try {
    const snapshot = await ma.agent.domain.snapshot();
    syncFromDomain(snapshot);
    updateChrome();
    draw();
  } catch (error) {
    console.warn('[gomoku] DomainRuntime 快照读取失败', error);
    game.thinking = false;
    updateChrome();
  }
}

async function newGameFromDomain() {
  game.thinking = true;
  updateChrome();
  await ma.agent.domain.command('game.new', { human: game.human === WHITE ? 'white' : 'black', level: game.level });
  await refreshDomain();
}

async function undoFromDomain() {
  if (!game.history.length) return;
  game.thinking = true;
  updateChrome();
  try { await ma.agent.domain.command('game.undo', {}); await refreshDomain(); }
  catch (error) { console.warn('[gomoku] 悔棋失败', error); game.thinking = false; updateChrome(); }
}

async function hintFromDomain() {
  if (game.over) return;
  try { await ma.agent.domain.command('game.hint', {}); await refreshDomain(); }
  catch (error) { console.warn('[gomoku] 提示失败', error); }
}

async function placeFromDomain(row, col) {
  if (!humanTurn()) return;
  game.thinking = true;
  game.hover = null;
  updateChrome();
  try { await ma.agent.domain.command('game.place', { row, col }); await refreshDomain(); }
  catch (error) { console.warn('[gomoku] 落子失败', error); game.thinking = false; updateChrome(); }
}

/* ---------- 交互 ---------- */

function bindUi() {
  $('#newBtn').onclick = () => { audioUnlock(); void newGameFromDomain(); };
  $('#undoBtn').onclick = () => { audioUnlock(); void undoFromDomain(); };
  $('#hintBtn').onclick = () => { audioUnlock(); void hintFromDomain(); };

  document.querySelectorAll('#levels button').forEach(btn => {
    btn.onclick = () => {
      game.level = btn.dataset.level;
      persist();
      void ma.agent.domain.command('game.setLevel', { level: game.level }).then(refreshDomain);
    };
  });

  document.querySelectorAll('#sides button').forEach(btn => {
    btn.onclick = () => {
      const side = btn.dataset.side === 'black' ? BLACK : WHITE;
      if (side === game.human) return;
      game.human = side;
      persist();
      void ma.agent.domain.command('game.setSide', { human: side === WHITE ? 'white' : 'black' }).then(refreshDomain);
    };
  });

  $('#soundBtn').onclick = () => {
    game.sound = !game.sound;
    persist();
    updateChrome();
    if (game.sound) { audioUnlock(); tone(660, 0.05, 0.02); }
  };

  canvas.addEventListener('pointermove', ev => {
    if (!humanTurn()) {
      if (game.hover) { game.hover = null; draw(); }
      return;
    }
    const hit = hitTest(ev);
    if (!hit || board[idx(hit.x, hit.y)] !== EMPTY) {
      if (game.hover) { game.hover = null; draw(); }
      return;
    }
    if (!game.hover || game.hover.x !== hit.x || game.hover.y !== hit.y) {
      game.hover = hit;
      draw();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (game.hover) { game.hover = null; draw(); }
  });

  canvas.addEventListener('click', ev => {
    if (!humanTurn()) return;
    const hit = hitTest(ev);
    if (!hit) return;
    audioUnlock();
    game.hover = null;
    void placeFromDomain(hit.y, hit.x);
  });

  document.addEventListener('keydown', ev => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const key = ev.key.toLowerCase();
    if (key === 'u') { ev.preventDefault(); void undoFromDomain(); }
    else if (key === 'r') { ev.preventDefault(); void newGameFromDomain(); }
    else if (key === 'h') { ev.preventDefault(); void hintFromDomain(); }
  });

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas);

  new MutationObserver(() => {
    palette = readPalette();
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });

  setInterval(updateChrome, 500);
}

function hitTest(ev) {
  const rect = canvas.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const gx = Math.round((px - geo.pad) / geo.cell);
  const gy = Math.round((py - geo.pad) / geo.cell);
  if (gx < 0 || gy < 0 || gx >= SIZE || gy >= SIZE) return null;
  const cx = geo.pad + gx * geo.cell;
  const cy = geo.pad + gy * geo.cell;
  if (Math.hypot(px - cx, py - cy) > geo.cell * 0.62) return null;
  return { x: gx, y: gy };
}

function audioUnlock() {
  if (!game.sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = audio || new AC();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* 忽略 */ }
}

/* ---------- 启动 ---------- */

function sanitizeStats(raw) {
  const num = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    win: num(raw.win),
    loss: num(raw.loss),
    draw: num(raw.draw),
    streak: num(raw.streak),
    best: num(raw.best)
  };
}

async function boot() {
  if (typeof ma !== 'undefined') {
    try { await ma.ready; } catch (err) { console.warn('[gomoku] 宿主初始化未完成，按独立页面运行', err); }
  }
  bindUi();
  resizeCanvas();
  await refreshDomain();
  if (typeof ma.on === 'function') ma.on('state.changed', () => { void refreshDomain(); });
}

void boot();
