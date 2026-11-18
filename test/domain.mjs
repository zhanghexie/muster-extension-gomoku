import assert from 'node:assert/strict';
import { createDomainRuntime } from '../gomoku/domain.mjs';

const runtime = createDomainRuntime();
try {
  await runtime.query('game.analyze');
  const before = await runtime.getSnapshot();
  await runtime.execute('game.place', { row: 7, col: 7 }, { actor: 'human' });
  const after = await runtime.getSnapshot();
  assert.ok(after.version > before.version);
  assert.equal(after.state.board[7][7], 'black');
} finally {
  await runtime.close?.();
}
