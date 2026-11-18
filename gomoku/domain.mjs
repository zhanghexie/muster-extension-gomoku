const SIZE = 15;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function emptyBoard() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(null)); }
function inside(row, col) { return row >= 0 && row < SIZE && col >= 0 && col < SIZE; }
function other(color) { return color === 'black' ? 'white' : 'black'; }

function line(board, row, col, color) {
  for (const [dr, dc] of DIRECTIONS) {
    const cells = [[row, col]];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < SIZE; step += 1) {
        const nextRow = row + dr * step * sign;
        const nextCol = col + dc * step * sign;
        if (!inside(nextRow, nextCol) || board[nextRow][nextCol] !== color) break;
        if (sign < 0) cells.unshift([nextRow, nextCol]); else cells.push([nextRow, nextCol]);
      }
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

function candidates(board) {
  const seen = new Set();
  const result = [];
  for (let row = 0; row < SIZE; row += 1) for (let col = 0; col < SIZE; col += 1) {
    if (!board[row][col]) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
      const nextRow = row + dr, nextCol = col + dc, key = `${nextRow}:${nextCol}`;
      if (inside(nextRow, nextCol) && !board[nextRow][nextCol] && !seen.has(key)) { seen.add(key); result.push([nextRow, nextCol]); }
    }
  }
  return result.length ? result : [[7, 7]];
}

function score(board, row, col, color) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [-1, 1]) for (let step = 1; step < 5; step += 1) {
      const nextRow = row + dr * step * sign, nextCol = col + dc * step * sign;
      if (!inside(nextRow, nextCol) || board[nextRow][nextCol] !== color) break;
      count += 1;
    }
    total += count * count * 100;
  }
  return total;
}

function chooseMove(board, color, level) {
  const options = candidates(board).map(([row, col]) => {
    board[row][col] = color;
    const attack = score(board, row, col, color), win = !!line(board, row, col, color);
    board[row][col] = null;
    const opponent = other(color);
    board[row][col] = opponent;
    const defense = score(board, row, col, opponent);
    board[row][col] = null;
    return { row, col, attack, defense, win, center: 14 - Math.abs(row - 7) - Math.abs(col - 7) };
  });
  options.sort((a, b) => ((b.win ? 1_000_000 : 0) + b.attack + b.defense * 1.05 + b.center) - ((a.win ? 1_000_000 : 0) + a.attack + a.defense * 1.05 + a.center));
  if (!options.length) return null;
  if (level === 'easy') return options[Math.min(2, options.length - 1)];
  return options[0];
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function createDomainRuntime({ identity = {} } = {}) {
  let version = 0;
  let state = { board: emptyBoard(), human: 'black', turn: 'black', level: 'normal', over: false, winner: null, winLine: null, last: null, hint: null, history: [], stats: { win: 0, loss: 0, draw: 0, streak: 0, best: 0 }, startedAt: Date.now(), endedAt: 0 };
  const listeners = new Set();
  const emit = (actor, payload) => listeners.forEach(listener => listener({ type: 'state.changed', extensionId: identity.extensionId || 'gomoku', extensionInstanceId: identity.extensionInstanceId || '', workspaceId: identity.workspaceId || '', version, requestId: 'sample', actor, payload }));

  function finish(color, winLine) {
    state.over = true; state.winner = color; state.winLine = winLine; state.endedAt = Date.now();
    if (color === state.human) { state.stats.win += 1; state.stats.streak += 1; state.stats.best = Math.max(state.stats.best, state.stats.streak); }
    else if (color) { state.stats.loss += 1; state.stats.streak = 0; } else state.stats.draw += 1;
  }
  function place(row, col, color, actor) {
    if (state.over || !inside(row, col) || state.board[row][col]) throw new Error('这个位置不能落子');
    if (color !== state.turn) throw new Error('当前不是这一方落子');
    state.board[row][col] = color; state.history.push({ row, col, color, actor }); state.last = { row, col, color }; state.hint = null;
    const winLine = line(state.board, row, col, color);
    if (winLine) finish(color, winLine); else if (state.history.length >= SIZE * SIZE) finish(null, null); else state.turn = other(color);
  }
  function autoReply() {
    if (state.over || state.turn === state.human) return null;
    const move = chooseMove(state.board, state.turn, state.level); if (!move) return null;
    place(move.row, move.col, state.turn, 'system'); return move;
  }
  function reset(next = {}) {
    state = { ...state, board: emptyBoard(), human: next.human === 'white' ? 'white' : 'black', turn: 'black', level: ['easy', 'normal', 'hard'].includes(next.level) ? next.level : state.level, over: false, winner: null, winLine: null, last: null, hint: null, history: [], startedAt: Date.now(), endedAt: 0 };
    if (state.human === 'white') autoReply();
  }

  return {
    async getSnapshot() { return { version, state: clone(state), availableCommands: ['game.new', 'game.place', 'game.agentMove', 'game.undo', 'game.hint', 'game.setLevel', 'game.setSide'], capturedAt: new Date().toISOString() }; },
    async query(name) {
      if (name === 'game.analyze' || name === 'game.hint') { const move = state.over ? null : chooseMove(state.board, state.turn, state.level); return { version, board: clone(state.board), turn: state.turn, human: state.human, level: state.level, moves: state.history.length, over: state.over, winner: state.winner, recommendation: move ? { row: move.row, col: move.col } : null }; }
      if (name === 'game.status') return { version, state: clone(state) };
      throw new Error(`Unknown gomoku query: ${name}`);
    },
    async execute(name, args = {}, context = {}) {
      let result = {};
      if (name === 'game.new') { reset(args); result = { restarted: true }; }
      else if (name === 'game.place' || name === 'game.agentMove') { const actor = context.actor === 'agent' ? 'agent' : 'human'; place(Number(args.row), Number(args.col), state.turn, actor); const reply = name === 'game.place' && actor === 'human' ? autoReply() : null; result = { placed: { row: Number(args.row), col: Number(args.col) }, reply }; }
      else if (name === 'game.undo') { if (!state.history.length) throw new Error('没有可以悔棋的步骤'); const removeCount = state.history.at(-1)?.actor === 'system' ? 2 : 1; for (let i = 0; i < removeCount && state.history.length; i += 1) { const move = state.history.pop(); state.board[move.row][move.col] = null; } state.turn = state.human; state.over = false; state.winner = null; state.winLine = null; state.last = state.history.at(-1) ? { ...state.history.at(-1) } : null; result = { undone: removeCount }; }
      else if (name === 'game.hint') { const move = chooseMove(state.board, state.human, 'hard'); state.hint = move ? { row: move.row, col: move.col } : null; result = { recommendation: state.hint }; }
      else if (name === 'game.setLevel') { if (!['easy', 'normal', 'hard'].includes(args.level)) throw new Error('难度不合法'); state.level = args.level; result = { level: state.level }; }
      else if (name === 'game.setSide') { reset({ human: args.human, level: state.level }); result = { human: state.human }; }
      else throw new Error(`Unknown gomoku command: ${name}`);
      version += 1; emit(context.actor === 'agent' ? 'agent' : 'human', result); return { ok: true, version, result, diff: clone(state) };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { listeners.clear(); }
  };
}
