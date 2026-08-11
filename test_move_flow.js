const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = {
  console, Math, Date, JSON, setTimeout, clearTimeout,
  Array, Object, String, Number, RegExp, Map, Set,
  document: {}, navigator: {}, window: { api: {} }
};
vm.createContext(ctx);

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return code;
}
const UCode = load('src/js/util.js');
const StoreCode = load('src/js/store.js');
vm.runInContext(UCode, ctx);
vm.runInContext(StoreCode + '\nthis.__store = Store;', ctx);
const Store = ctx.__store;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

// 构造结构：根目录含 f1、D1；D1 含 f2、D2；D2 含 f3
const f1 = Store.newFlow('f1');
const f2 = Store.newFlow('f2');
const f3 = Store.newFlow('f3');
const D2 = Store.newFlowFolder('D2'); D2.items = [f3];
const D1 = Store.newFlowFolder('D1'); D1.items = [f2, D2];
Store.state.flows = [f1, D1];

const inRoot = (n) => Store.state.flows.some((x) => x.id === n.id);
const inFolder = (folder, n) => (folder.items || []).some((x) => x.id === n.id);

// 1. f2 移到根目录
check('f2 移出 D1 到根目录', Store.moveFlow(f2.id, null) === true);
check('f2 现在在根目录', inRoot(f2));
check('f2 已不在 D1', !inFolder(D1, f2));

// 2. f3 移到 D1（D2 成为空文件夹）
check('f3 移到 D1', Store.moveFlow(f3.id, D1.id) === true);
check('f3 现在在 D1', inFolder(D1, f3));
check('f3 已不在 D2', !inFolder(D2, f3));

// 3. 不能把 D1 移到它的后代 D2（应失败，防循环引用）
check('D1 不能移到自己的子文件夹 D2', Store.moveFlow(D1.id, D2.id) === false);
check('D1 仍在根目录未移动', inRoot(D1));

// 4. 不能移到自身
check('不能移到自身', Store.moveFlow(f1.id, f1.id) === false);

// 5. 移动到不存在的文件夹 id（应失败）
check('移动到不存在的文件夹', Store.moveFlow(f1.id, 'nope') === false);

// 6. f1 移到 D2（合法），再验证 D2 含 f1
check('f1 移到 D2 合法', Store.moveFlow(f1.id, D2.id) === true);
check('f1 现在在 D2', inFolder(D2, f1));
check('f1 已不在根目录', !inRoot(f1));

// 7. 文件夹移到根目录
check('D2 移到根目录合法', Store.moveFlow(D2.id, null) === true);
check('D2 现在在根目录', inRoot(D2));
check('D1 已不含 D2', !inFolder(D1, D2));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
