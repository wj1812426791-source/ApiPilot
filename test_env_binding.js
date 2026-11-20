/* 环境绑定集合：点集合（或它下面的请求）自动切换环境
   另外校验默认过期方式已改为「每天固定时刻 00:00」 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

const mkEl = () => ({
  className: '', textContent: '', innerHTML: '', hidden: false, value: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, addEventListener() {}, insertBefore() {}, querySelector: () => null,
  querySelectorAll: () => []
});

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  parseInt, setTimeout, clearTimeout,
  document: {
    createElement: mkEl, createTextNode: (t) => ({ text: t }),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: mkEl()
  },
  navigator: {}, window: { api: {} }
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U=U;', ctx); ctx.U = ctx.__U;
vm.runInContext(loadSrc('store.js') + '\nthis.__Store=Store;', ctx); ctx.Store = ctx.__Store;
const Store = ctx.Store;

let toasts = [];
ctx.UI = { toast: (m) => toasts.push(m), contextMenu() {}, confirm: async () => true, prompt: async () => null };
ctx.Editor = {
  liveReq: (n) => n, isDirty: () => false, openRequest() {}, renderTabs() {},
  renderCurrent() {}, currentRefId: () => null, closeTabsByRef() {},
  renderAuth() {}, renderAutoHeaders() {}, syncUrlHighlight() {}
};
ctx.App = { refreshEnvSelect() {} };
ctx.Scheduler = { badgeTip: () => '', open() {}, cancel() {} };
ctx.Importer = { toCurl: () => '', exportRequest() {}, exportCollection() {} };

vm.runInContext(loadSrc('tree.js') + '\nthis.__tree=Tree;', ctx);
const Tree = ctx.__tree;

/* ------------------------------ 1. 默认值 ------------------------------ */
console.log('\n[1] 新建环境的默认值');
const fresh = Store.newEnvironment('新环境');
check('默认绑定集合为空', fresh.boundCollectionId === null, String(fresh.boundCollectionId));
const d = Store.DEFAULT_LOGIN();
check('默认过期方式为「每天固定时刻」', d.expiryMode === 'daily', d.expiryMode);
check('默认每日过期时刻 00:00', d.dailyExpireAt === '00:00', d.dailyExpireAt);

/* ------------------------------ 2. 绑定后点集合切环境 ------------------------------ */
console.log('\n[2] 点集合自动切换环境');
const colA = Store.newCollection('集合A');
const reqA = Store.newRequest('请求A');
colA.items = [reqA];
const folderA = Store.newFolder('文件夹A');
const reqA2 = Store.newRequest('子请求');
folderA.items = [reqA2];
colA.items.push(folderA);
const colB = Store.newCollection('集合B');
colB.items = [Store.newRequest('B的请求')];
Store.state.collections = [colA, colB];

const env1 = Store.newEnvironment('环境1');
env1.boundCollectionId = colA.id;
const env2 = Store.newEnvironment('环境2');
Store.state.environments = [env1, env2];
Store.state.activeEnvId = env2.id;

toasts = [];
check('点绑定的集合 → 切到对应环境',
  Tree.applyBoundEnv(colA) === env1 && Store.state.activeEnvId === env1.id);
check('…并给出提示', toasts.some((t) => t.includes('环境1')), toasts.join(' | '));

Store.state.activeEnvId = env2.id;   // 模拟用户手动换成别的环境
toasts = [];
check('点集合下的请求也能切（按所属集合判定）',
  Tree.applyBoundEnv(reqA) === env1 && Store.state.activeEnvId === env1.id);

Store.state.activeEnvId = env2.id;
check('点集合里更深一层的请求也能切',
  Tree.applyBoundEnv(reqA2) === env1 && Store.state.activeEnvId === env1.id);

Store.state.activeEnvId = env1.id;
toasts = [];
check('已经是对应环境 → 不重复切换、不刷提示',
  Tree.applyBoundEnv(colA) === env1 && toasts.length === 0);

Store.state.activeEnvId = env1.id;
check('点没绑定环境的集合 → 保持当前环境',
  Tree.applyBoundEnv(colB) === null && Store.state.activeEnvId === env1.id);

Store.state.activeEnvId = env2.id;
check('手动切到别的环境后，点绑定的集合会切回去',
  Tree.applyBoundEnv(colA) === env1 && Store.state.activeEnvId === env1.id);

check('传空节点不崩', Tree.applyBoundEnv(null) === null);

/* ------------------------------ 3. 删除集合时清理 ------------------------------ */
console.log('\n[3] 删除集合时解除绑定');
check('删除前确实绑着', env1.boundCollectionId === colA.id);
Store.removeNode(colA.id);
check('删掉集合后绑定被清空（不留脏数据）', env1.boundCollectionId === null, String(env1.boundCollectionId));
check('删除别的节点不会误清',
  (() => { env1.boundCollectionId = colB.id; Store.removeNode(reqA.id); return env1.boundCollectionId === colB.id; })());

/* ------------------------------ 4. 源码接线 ------------------------------ */
console.log('\n[4] 接线');
const envSrc = loadSrc('env.js');
const treeSrc = loadSrc('tree.js');
const storeSrc = loadSrc('store.js');
check('环境详情里有「绑定集合（可选）」下拉', envSrc.includes('绑定集合（可选）'));
check('下拉含「不绑定」选项', envSrc.includes('不绑定（手动切换环境）'));
check('绑定写入 boundCollectionId 并持久化',
  /env\.boundCollectionId = colSel\.value \|\| null;[\s\S]{0,80}Store\.save\(\)/.test(envSrc));
check('无删除集合时回落到「不绑定」', envSrc.includes('boundAlive'));

check('树节点点击会调用 applyBoundEnv', /row\.addEventListener\('click'[\s\S]{0,160}applyBoundEnv\(node\)/.test(treeSrc));
check('切换后刷新环境下拉', treeSrc.includes('App.refreshEnvSelect()'));
check('切换后刷新 Token/自动 Header 展示',
  treeSrc.includes('Editor.renderAuth()') && treeSrc.includes('Editor.renderAutoHeaders()'));
check('applyBoundEnv 已导出', treeSrc.includes('applyBoundEnv'));

check('store 新环境带 boundCollectionId', storeSrc.includes('boundCollectionId: null'));
check('store 载入时迁移该字段', storeSrc.includes('boundCollectionId: e.boundCollectionId || null'));
check('删除节点时清理绑定', storeSrc.includes('if (e.boundCollectionId === id) e.boundCollectionId = null;'));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
