/* 集合树：复制 / 粘贴 单元测试
   验证点了复制再把请求粘贴到其他集合（或粘贴到某个请求后面）的行为，
   以及深拷贝快照、id 重建、文件夹递归、空剪贴板等边界。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* 极简 DOM 桩：tree.js 的 render/select 会碰 document / #tree / #collectionsEmpty */
const mkEl = () => ({
  tagName: 'DIV', className: '', textContent: '', innerHTML: '', hidden: false,
  style: {}, dataset: {}, children: [],
  classList: { toggle() { }, add() { }, remove() { }, contains: () => false },
  setAttribute() { }, removeAttribute() { }, getAttribute() { return null; },
  addEventListener() { }, removeEventListener() { }, remove() { },
  appendChild(c) { this.children.push(c); return c; },
  querySelectorAll: () => [], querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, bottom: 0, right: 0 })
});

const ctx = {
  console, Math, Date, JSON, setTimeout, clearTimeout,
  Array, Object, String, Number, RegExp, Map, Set,
  document: {
    createElement: mkEl,
    createTextNode: (t) => ({ text: t }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    body: mkEl()
  },
  navigator: {}, window: { api: {} }
};
vm.createContext(ctx);

function load(file) { return fs.readFileSync(path.join(__dirname, file), 'utf8'); }

vm.runInContext(load('src/js/util.js') + '\nthis.__u = U;', ctx);
vm.runInContext(load('src/js/store.js') + '\nthis.__store = Store;', ctx);
const Store = ctx.__store;
const U = ctx.__u;

const fakeEl = mkEl;
U.$ = () => fakeEl();
U.$$ = () => [];

// 依赖桩：只保留 tree.js 用到的接口
let liveReqImpl = (node) => node;
ctx.Editor = { liveReq: (n) => liveReqImpl(n), isDirty: () => false, openRequest() { }, renderTabs() { }, renderCurrent() { }, currentRefId: () => null, closeTabsByRef() { } };
ctx.UI = { toast() { }, contextMenu() { }, confirm: async () => true, prompt: async () => null };
ctx.Scheduler = { badgeTip: () => '', open() { }, cancel() { } };
ctx.Importer = { toCurl: () => '', exportRequest() { }, exportCollection() { } };

vm.runInContext(load('src/js/tree.js') + '\nthis.__tree = Tree;', ctx);
const Tree = ctx.__tree;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* ------------------------------ 构造数据 ------------------------------ */
function buildData() {
  const colA = Store.newCollection('集合A');
  const reqX = Store.newRequest('请求X');
  reqX.url = '{{baseUrl}}/a';
  reqX.method = 'POST';
  reqX.headers = [{ key: 'x-current-project', value: 'p1', desc: '', enabled: true }];
  reqX.body = { mode: 'raw', raw: '{"a":1}', rawType: 'application/json', formdata: [], urlencoded: [] };
  colA.items = [reqX];

  const folderB = Store.newFolder('文件夹B');
  const reqInB = Store.newRequest('B里的请求');
  reqInB.url = '{{baseUrl}}/b';
  folderB.items = [reqInB];

  const colC = Store.newCollection('集合C');
  colC.items = [folderB];

  Store.state.collections = [colA, colC];
  return { colA, reqX, folderB, reqInB, colC };
}

const allIds = () => {
  const ids = [];
  Store.walk(Store.state.collections, (n) => ids.push(n.id));
  return ids;
};

/* ------------------------------ 1. 复制请求 → 粘贴到别的集合 ------------------------------ */
console.log('\n[1] 复制请求并粘贴到另一个集合');
let d = buildData();
check('复制前剪贴板为空', Tree.hasClipboard() === false);
check('复制成功返回 true', Tree.copyNode(d.reqX) === true);
check('复制后剪贴板非空', Tree.hasClipboard() === true);

// 复制后改动源节点：粘贴出来的应是「复制那一刻」的快照
d.reqX.url = 'MUTATED';
d.reqX.headers[0].value = 'MUTATED-VALUE';
d.reqX.name = 'MUTATED-NAME';

const pasted = Tree.pasteTo(d.colC);
check('粘贴返回新节点', !!pasted);
check('粘贴的 url 是复制时的快照（未被后续改动污染）', pasted.url === '{{baseUrl}}/a');
check('粘贴的 header 值是快照', pasted.headers[0].value === 'p1');
check('粘贴保留了请求名', pasted.name === '请求X');
check('粘贴保留了 method', pasted.method === 'POST');
check('粘贴保留了 body', (pasted.body || {}).raw === '{"a":1}');
check('新节点 id 与源不同', pasted.id !== d.reqX.id);
check('新节点已进入集合C', d.colC.items.some((n) => n.id === pasted.id));
check('集合C 现在有 2 个子项', d.colC.items.length === 2);
check('源集合A 不受影响（仍是 1 项）', d.colA.items.length === 1);
check('源集合里仍是原节点对象', d.colA.items[0].id === d.reqX.id);
check('全局 id 无重复', new Set(allIds()).size === allIds().length);
check('粘贴后新节点被选中', Tree.getSelected() && Tree.getSelected().id === pasted.id);

/* ------------------------------ 2. 再粘贴一次：副本互不影响 ------------------------------ */
console.log('\n[2] 连续粘贴两次，两个副本互相独立');
const pasted2 = Tree.pasteTo(d.colC);
check('第二次粘贴也成功', !!pasted2 && pasted2.id !== pasted.id);
pasted.headers[0].value = 'CHANGED';
check('改副本1 不影响副本2', pasted2.headers[0].value === 'p1');

/* ------------------------------ 3. 粘贴到某一个请求「后面」 ------------------------------ */
console.log('\n[3] 粘贴到请求后面（同级插入）');
d = buildData();
Tree.copyNode(d.reqX);
const after = Tree.pasteTo(d.reqInB);
check('以请求为目标也返回新节点', !!after);
check('粘贴到「B里的请求」之后', d.folderB.items[1] && d.folderB.items[1].id === after.id);
check('「B里的请求」仍在原位', d.folderB.items[0].id === d.reqInB.id);

/* ------------------------------ 4. 复制文件夹（含子请求） ------------------------------ */
console.log('\n[4] 复制文件夹并粘贴到集合');
d = buildData();
const beforeIds = allIds();
check('复制文件夹成功', Tree.copyNode(d.folderB) === true);
const fPasted = Tree.pasteTo(d.colA);
check('粘贴出的是文件夹', fPasted.type === 'folder');
check('文件夹名保留', fPasted.name === '文件夹B');
check('子请求一起被复制', (fPasted.items || []).length === 1);
check('子请求 url 保留', fPasted.items[0].url === '{{baseUrl}}/b');
check('子请求 id 已重建', fPasted.items[0].id !== d.reqInB.id);
check('原文件夹仍在集合C', d.colC.items.some((n) => n.id === d.folderB.id));
check('新文件夹在集合A', d.colA.items.some((n) => n.id === fPasted.id));
check('复制文件夹后全局 id 仍无重复', new Set(allIds()).size === allIds().length);
check('原有 id 集合是现在的子集（未破坏旧节点）', beforeIds.every((id) => allIds().includes(id)));

/* ------------------------------ 5. 边界情况 ------------------------------ */
console.log('\n[5] 边界情况');
d = buildData();
// 空剪贴板：用一个全新的 Tree 实例模拟（会话内剪贴板是实例私有状态）
check('清空前：原实例剪贴板有内容', Tree.hasClipboard() === true);
vm.runInContext('this.__tree2 = (function(){ ' + load('src/js/tree.js') + ' return Tree; })();', ctx);
const Tree2 = ctx.__tree2;
check('新实例剪贴板为空', Tree2.hasClipboard() === false);
check('空剪贴板粘贴返回 null', Tree2.pasteTo(d.colA) === null);
check('空剪贴板粘贴没有污染数据', d.colA.items.length === 1);
check('目标为 null 时粘贴返回 null', Tree.pasteTo(null) === null);

// 没有选中节点时的 Ctrl+C / Ctrl+V
check('未选中时 copySelected 返回 false', Tree2.copySelected() === false);
check('未选中时 pasteSelected 返回 false', Tree2.pasteSelected() === false);

/* ------------------------------ 6. 未保存草稿：取编辑区最新内容 ------------------------------ */
console.log('\n[6] 请求在编辑区有未保存修改时，复制取最新草稿');
d = buildData();
liveReqImpl = () => ({
  ...Store.newRequest('请求X'),
  id: d.reqX.id, name: '请求X', url: '{{baseUrl}}/draft-url', method: 'PUT'
});
Tree.copyNode(d.reqX);
const fromDraft = Tree.pasteTo(d.colC);
check('复制的是编辑区草稿的 url', fromDraft.url === '{{baseUrl}}/draft-url');
check('复制的是编辑区草稿的 method', fromDraft.method === 'PUT');
liveReqImpl = (n) => n;

/* ------------------------------ 7. 选中态 ------------------------------ */
console.log('\n[7] 选中态');
d = buildData();
Tree.select(d.reqInB.id);
check('select 后 getSelected 返回该节点', Tree.getSelected() && Tree.getSelected().id === d.reqInB.id);
Tree.select('not-exist-id');
check('选中不存在的 id 时 getSelected 返回 null', Tree.getSelected() === null);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
