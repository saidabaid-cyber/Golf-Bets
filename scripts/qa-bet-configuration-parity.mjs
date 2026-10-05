import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Read-only pinned previous implementation. Never checks out or writes main.
const referenceSha = 'a1b33ddfad905e0d45bcfe0848916ba19ceed0af';
const require = createRequire(import.meta.url), cache = new Map();
function previous(path) {
  if (cache.has(path)) return cache.get(path);
  const source = execFileSync('git', ['show', `${referenceSha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, structuredClone, require: id => id.startsWith('.') ? previous(`${posix.normalize(posix.join(posix.dirname(path), id))}.ts`) : require(id) });
  return exports;
}
const before = previous('lib/engine.ts'), after = require('../.test-dist/lib/engine.js');
const beforeSide = previous('lib/supplemental-bets.ts'), afterSide = require('../.test-dist/lib/supplemental-bets.js');
const { wizardEngineFixture } = require('../.test-dist/tests/fixtures/round-wizard-engine.js');
const plain = value => JSON.stringify(value);
const scenarios = [];
for (const start of [1, 10]) {
  const f = wizardEngineFixture(start, 'relative');
  const cases = [
    ['Conejos', 'calculateRabbits', [f.course, f.scores, f.players, f.bets.rabbits, f.order]],
    ['Skins', 'calculateSkins', [f.course, f.scores, f.players, f.bets.skins, f.order]],
    ['Unidades', 'calculateUnits', [f.players, [], f.bets.units, f.course, f.scores, f.order]],
    ['Foursome', 'calculateFoursomes', [f.course, f.scores, f.players, f.bets.foursome, f.segments, f.order]],
    ['Bola Amiga', 'calculateBallFriend', [f.course, f.scores, f.players, f.bets.ballFriend, f.ballFriendSetup, f.order]],
    ['Polla', 'calculatePolla', [f.course, f.scores, f.players, f.bets.polla, f.order]],
    ['Nassau personal', 'calculatePersonalBets', [f.personalBets, f.ownerId, f.players, f.course, f.scores, f.order]],
  ];
  for (const [bet, method, args] of cases) {
    const reference = before[method](...structuredClone(args)), current = after[method](...structuredClone(args));
    const keys = ['balances', 'won', 'results'];
    const payouts = value => Object.fromEntries(keys.filter(key => key in value).map(key => [key, key === 'results' ? value[key].map(item => ({ totalMoney: item.totalMoney, componentMoney: item.componentMoney })) : value[key]]));
    scenarios.push({ bet, startHole: start, parity: plain(payouts(reference)) === plain(payouts(current)), reference: payouts(reference), current: payouts(current) });
  }
  const bets = f.supplementalBets.filter(bet => bet.type === 'individual_pressures' || bet.type === 'team_pressures');
  const args = [bets, f.players, f.course, f.scores, f.putts, f.order];
  const reference = beforeSide.calculateSupplementalBets(...structuredClone(args)), current = afterSide.calculateSupplementalBets(...structuredClone(args));
  scenarios.push({ bet: 'Presiones', startHole: start, parity: plain(reference.balances) === plain(current.balances), reference: reference.balances, current: current.balances });
}
const artifact = { referenceSha, reference: 'previous implementation from origin/main, read only; not a claim about current Production deployment', buildSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), engineSourceUnchanged: readFileSync('lib/engine.ts', 'utf8').replaceAll('\r\n','\n') === execFileSync('git', ['show', 'HEAD:lib/engine.ts'], { encoding: 'utf8' }).replaceAll('\r\n','\n'), scenarios };
writeFileSync('.qa-artifacts/bet-functional-parity.json', JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({ referenceSha, cases: scenarios.length, pass: scenarios.filter(item => item.parity).length, differences: scenarios.filter(item => !item.parity).map(item => `${item.bet} H${item.startHole}`), engineSourceUnchanged: artifact.engineSourceUnchanged }));
