/* 测试流程「多选参数批量执行」核心逻辑（node 单测，不依赖 Electron）
   用法: node test_flow_multi.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const context = {
  console,
  window: { api: {} },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ appendChild() {}, addEventListener() {}, style: {}, setAttribute() {} }),
    createTextNode: () => ({})
  },
  setTimeout, clearTimeout,
  navigator: { clipboard: { writeText: async () => {} } }
};
context.globalThis = context;
vm.createContext(context);

vm.runInContext(read('src/js/util.js') + '\n;globalThis.U = U;', context);
vm.runInContext(read('src/js/vars.js') + '\n;globalThis.Vars = Vars;', context);
vm.runInContext(read('src/js/store.js') + '\n;globalThis.Store = Store;', context);
vm.runInContext(read('src/js/flow.js') + '\n;globalThis.Flow = Flow;', context);

const { U, Flow } = context;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

console.log('1) U.cartesian 笛卡尔积');
const c = U.cartesian([['a', 'b'], ['x', 'y', 'z']]);
check('2×3 = 6 组', c.length === 6);
check('首组为 [a,x]', c[0][0] === 'a' && c[0][1] === 'x');
const c2 = U.cartesian([['only']]);
check('单组取唯一值', c2.length === 1 && c2[0][0] === 'only');

console.log('2) 多选参数批量生成迭代');
const step = {
  method: 'DELETE',
  url: '{{baseUrl}}/api/item/{{id}}',
  params: [
    { key: 'id', value: '', multi: true, candidates: [
      { value: 'A-1', checked: true },
      { value: 'A-2', checked: true },
      { value: 'A-3', checked: false }   // 未勾选，应被排除
    ] }
  ],
  pathVars: [], headers: [], body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] }
};
const iters = Flow.buildStepIterations(step);
check('生成 2 次迭代（未勾选的 A-3 被排除）', iters.length === 2);
check('第 1 次使用 A-1', iters[0].params[0].value === 'A-1');
check('第 2 次使用 A-2', iters[1].params[0].value === 'A-2');

console.log('3) 单选模式返回 1 次迭代');
const single = {
  method: 'GET', url: '{{baseUrl}}/x',
  params: [{ key: 'id', value: 'Z-9', multi: false, candidates: [] }],
  pathVars: [], headers: [], body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] }
};
check('单选返回 1 次', Flow.buildStepIterations(single).length === 1);

console.log('4) 多个多选参数走笛卡尔积');
const multiParam = {
  method: 'POST', url: '{{baseUrl}}/x',
  params: [
    { key: 'a', value: '', multi: true, candidates: [{ value: 'a1', checked: true }, { value: 'a2', checked: true }] },
    { key: 'b', value: '', multi: true, candidates: [{ value: 'b1', checked: true }, { value: 'b2', checked: true }, { value: 'b3', checked: true }] }
  ],
  pathVars: [], headers: [], body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] }
};
const iters2 = Flow.buildStepIterations(multiParam);
check('2×3 = 6 次迭代', iters2.length === 6);
check('首个组合 a1+b1', iters2[0].params[0].value === 'a1' && iters2[0].params[1].value === 'b1');

console.log('5) 多选候选值含空串应被排除');
const withEmpty = {
  method: 'DELETE', url: '{{baseUrl}}/x/{{id}}',
  params: [{ key: 'id', value: '', multi: true, candidates: [
    { value: '', checked: true }, { value: 'K-1', checked: true }
  ] }],
  pathVars: [], headers: [], body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] }
};
const iters3 = Flow.buildStepIterations(withEmpty);
check('空值被排除，仅 1 次', iters3.length === 1 && iters3[0].params[0].value === 'K-1');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
