import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
type Element = { type: string; props: Record<string, any> };
function nodes(root: any): Element[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
function rendered(props: Record<string, any>) {
  const states: any[] = []; let cursor = 0;
  const exports: any = {};
  runInNewContext(compile(readFileSync('app/components/golf-gps/golf-gps-view.tsx', 'utf8')), { exports, process: { env: {} }, require(id: string) {
    if (id === 'react/jsx-runtime') return { jsx: (type: string, props: object) => ({ type, props }), jsxs: (type: string, props: object) => ({ type, props }) };
    if (id === 'react') return {
      useState(initial: any) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
      useEffect() {}, useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }),
    };
    if (id.endsWith('/model.mjs')) return { gpsMeasurements: () => ({ front: null, center: null, back: null, playerTarget: null, targetCenter: null }), liveReading: () => null, displayDistance: () => '—' };
    if (id.endsWith('/google-maps.mjs')) return { googleMapsFactory: () => { throw Error('No map may initialize during a render'); } };
    if (id.endsWith('/location.mjs') || id.endsWith('/map-session.mjs')) return {};
    if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error('Unexpected provider/round/write dependency');
  } });
  const render = () => { cursor = 0; return exports.GolfGpsView({ mapsEnabled: false, mapFactory: () => undefined, ...props }); };
  const find = (label: string) => nodes(render()).find(node => node.props['aria-label'] === label)!;
  return { render, find };
}
// Synthetic coordinates/IDs are deliberately not geographic evidence.
const courses = [{ id: 'course-la-vista', name: 'La Vista', physicalHoleCount: 18, cardPositionCount: 18, source: {}, holes: [1, 2, 3].map(position => ({ position, green: { center: [0, 0] }, references: [] })) }];

test('Play GPS action navigates independently, with no round/draft/player/bet mutation', () => {
  const file = ts.createSourceFile('page.tsx', readFileSync('app/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openRoundGps') fn = node; ts.forEachChild(node, visit); }
  visit(file); assert.ok(fn);
  const exports: any = {}, tabs: string[] = [];
  runInNewContext(compile(`export ${fn!.getText(file)}`), { exports, setTab: (tab: string) => tabs.push(tab) });
  exports.openRoundGps(); assert.deepEqual(tabs, ['gps']); // Any round function would fail in this scope.
});

test('independent explorer selects stored fields and holes without score, tee, players or GHIN', () => {
  const alias = { ...courses[0], id: 'course-la-vista-club-current', name: 'Current card alias' };
  const ui = rendered({ courses: [...courses, alias], initialCourseId: 'course-la-vista' });
  assert.equal(ui.find('GPS dedicado').props['data-round-id'], undefined);
  ui.find('Elegir campo GPS').props.onClick();
  const picker = nodes(ui.render()).find(node => node.props.role === 'dialog' && node.props['aria-label'] === 'Elegir campo GPS')!;
  const buttons = nodes(picker).filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.equal(buttons.length, 1); // The current card is not a second physical field.
  buttons[0].props.onClick();
  for (const hole of [2, 3, 1]) { ui.find('Hoyo GPS').props.onChange({ target: { value: String(hole) } }); assert.equal(ui.find('Hoyo GPS').props.value, hole); }
  assert.equal(nodes(ui.render()).some(node => node.type === 'button' && String(node.props.children).includes('Anotar score')), false);
});

test('round exploration preserves round ID and navigates without capturing score; score is explicit', () => {
  const navigated: number[] = [], scored: number[] = [];
  const ui = rendered({ courses, roundContext: { roundId: 'SYNTHETIC-ROUND', name: 'Test round', teeName: 'Test tee', holes: [1, 2, 3].map(number => ({ number, par: 4 })), onNavigate: (number: number) => navigated.push(number), onScore: (number: number) => scored.push(number) } });
  for (const hole of [2, 3, 1]) ui.find('Hoyo GPS').props.onChange({ target: { value: String(hole) } });
  assert.deepEqual(navigated, [2, 3, 1]); assert.deepEqual(scored, []);
  assert.equal(ui.find('GPS dedicado').props['data-round-id'], 'SYNTHETIC-ROUND');
  const score = nodes(ui.render()).find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Anotar · ')!;
  score.props.onClick(); assert.deepEqual(scored, [1]);
});

test('map is the full-screen surface; HUD wrappers let map gestures through', () => {
  const css = readFileSync('app/components/golf-gps/golf-gps.module.css', 'utf8');
  assert.match(css, /\.mapArea\{position:absolute;inset:0/);
  assert.match(css, /\.topHud\{[^}]*pointer-events:none/);
  assert.match(css, /\.bottomHud\{[^}]*pointer-events:none/);
  assert.match(css, /\.mapControls\{[^}]*pointer-events:none/);
  assert.match(css, /\.topHud button,\.topHud select\{pointer-events:auto/);
  assert.match(css, /\.bottomHud button\{pointer-events:auto/);
});
