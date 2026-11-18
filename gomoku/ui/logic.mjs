/* 五子棋纯逻辑：棋盘、胜负判断、启发式 AI。无 DOM、无网络依赖，便于单元测试。 */

export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const WIN_SCORE = 10_000_000;

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
/* 候选点周围 5 格窗口中「己方子数」对应的权重。 */
const WINDOW = [0, 8, 120, 1500, 30000, WIN_SCORE];

export const idx = (x, y) => y * SIZE + x;
export const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const other = color => (color === BLACK ? WHITE : BLACK);

export function createBoard() {
  return new Int8Array(SIZE * SIZE);
}

export function countStones(board) {
  let n = 0;
  for (let i = 0; i < board.length; i++) if (board[i] !== EMPTY) n++;
  return n;
}

export function isFull(board) {
  for (let i = 0; i < board.length; i++) if (board[i] === EMPTY) return false;
  return true;
}

/** 已有棋子周围 2 格内的空点；空棋盘返回天元。 */
export function candidates(board, radius = 2) {
  const seen = new Uint8Array(SIZE * SIZE);
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] === EMPTY) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inB(nx, ny)) continue;
          const i = idx(nx, ny);
          if (board[i] !== EMPTY || seen[i]) continue;
          seen[i] = 1;
          out.push([nx, ny]);
        }
      }
    }
  }
  if (!out.length) out.push([(SIZE - 1) >> 1, (SIZE - 1) >> 1]);
  return out;
}

/** 假设 (x,y) 已落下 color，该点的攻势评分（四方向 5 格窗口累加）。 */
export function lineScore(board, x, y, color) {
  let total = 0;
  for (let d = 0; d < DIRS.length; d++) {
    const dx = DIRS[d][0], dy = DIRS[d][1];
    for (let start = -4; start <= 0; start++) {
      let mine = 0, blocked = false;
      for (let k = 0; k < 5; k++) {
        const nx = x + dx * (start + k), ny = y + dy * (start + k);
        if (!inB(nx, ny)) { blocked = true; break; }
        const v = board[idx(nx, ny)];
        if (v === color) mine++;
        else if (v !== EMPTY) { blocked = true; break; }
      }
      if (!blocked) total += WINDOW[mine];
    }
  }
  return total;
}

/**
 * 对每个候选点评分：
 * atk = 我方落此点的攻势，def = 对手落此点的攻势（堵点价值）。
 * score 用于排序，真正的「必胜/必堵」由 chooseMove 单独判断。
 */
export function rankMoves(board, color) {
  const opp = other(color);
  const out = [];
  for (const [x, y] of candidates(board)) {
    const i = idx(x, y);
    board[i] = color;
    const atk = lineScore(board, x, y, color);
    board[i] = EMPTY;
    let def = 0;
    if (atk < WIN_SCORE) {
      board[i] = opp;
      def = lineScore(board, x, y, opp);
      board[i] = EMPTY;
    }
    const centerBias = 14 - Math.abs(x - 7) - Math.abs(y - 7);
    out.push({ x, y, atk, def, score: atk + def * 1.02 + centerBias });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** (x,y) 上的 color 是否成五，返回连成的整条线（>=5 子）或 null。 */
export function findWin(board, x, y, color) {
  if (!inB(x, y) || board[idx(x, y)] !== color) return null;
  for (let d = 0; d < DIRS.length; d++) {
    const dx = DIRS[d][0], dy = DIRS[d][1];
    const cells = [[x, y]];
    for (const sign of [-1, 1]) {
      for (let k = 1; k < SIZE; k++) {
        const nx = x + dx * k * sign, ny = y + dy * k * sign;
        if (!inB(nx, ny) || board[idx(nx, ny)] !== color) break;
        if (sign < 0) cells.unshift([nx, ny]);
        else cells.push([nx, ny]);
      }
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

function pickWeighted(list, rand) {
  const weights = list.map((_, i) => Math.max(1, 14 - i * 2.4));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/** 对手在我方落子后能获得的最大单点攻势（粗略两步评估）。 */
function opponentBestThreat(board, opp) {
  let best = 0;
  for (const [x, y] of candidates(board, 2)) {
    const i = idx(x, y);
    board[i] = opp;
    const s = lineScore(board, x, y, opp);
    board[i] = EMPTY;
    if (s > best) {
      best = s;
      if (best >= WIN_SCORE) break;
    }
  }
  return best;
}

/**
 * 选点。level: 'easy' | 'normal' | 'hard'。
 * 会优先走自己的必胜点；对手的必胜点默认必堵（easy 会偶尔漏看）。
 */
export function chooseMove(board, color, level = 'normal', rand = Math.random) {
  if (countStones(board) === 0) return { x: (SIZE - 1) >> 1, y: (SIZE - 1) >> 1 };
  const opp = other(color);
  const ranked = rankMoves(board, color);
  if (!ranked.length) return null;

  const winning = ranked.find(m => m.atk >= WIN_SCORE);
  if (winning) return { x: winning.x, y: winning.y };

  const blocking = ranked.filter(m => m.def >= WIN_SCORE).sort((a, b) => b.atk - a.atk);
  if (blocking.length && !(level === 'easy' && rand() < 0.55)) {
    return { x: blocking[0].x, y: blocking[0].y };
  }

  if (level === 'easy') {
    const pool = ranked.slice(0, Math.min(6, ranked.length));
    const pick = pickWeighted(pool, rand);
    return { x: pick.x, y: pick.y };
  }

  if (level === 'hard') {
    let bestMove = ranked[0], bestValue = -Infinity;
    for (const move of ranked.slice(0, 6)) {
      const i = idx(move.x, move.y);
      board[i] = color;
      const threat = opponentBestThreat(board, opp);
      board[i] = EMPTY;
      const value = move.score - threat * 0.62 + rand() * 40;
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
    }
    return { x: bestMove.x, y: bestMove.y };
  }

  return { x: ranked[0].x, y: ranked[0].y };
}

export function bestHint(board, humanColor) {
  return chooseMove(board, humanColor, 'hard');
}
