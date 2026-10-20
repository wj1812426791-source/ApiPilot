/* 标签页右键菜单：关闭 / 关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部
   重点验证「关闭后激活谁」和「批量关闭只确认一次」这两件容易出错的事。 */
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

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  parseInt, setTimeout, clearTimeout,
  document: {}, navigator: {}, window: { api: {} }
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', ctx);
ctx.U = ctx.__U;
vm.runInContext(loadSrc('store.js') + '\nthis.__Store = Store;', ctx);
ctx.Store = ctx.__Store;
vm.runInContext(loadSrc('editor.js') + '\nthis.__Editor = Editor;', ctx);
const Editor = ctx.__Editor;
const Store = ctx.Store;

const mkTabs = (ids) => ids.map((id) => ({ id, draft: { name: id, method: 'GET' }, dirty: false }));

/* ------------------------------ 1. 关闭后激活谁 ------------------------------ */
console.log('\n[1] pickActiveAfterClose：关完激活哪个标签');
const tabs = mkTabs(['a', 'b', 'c', 'd']);
check('关掉中间的 b → 激活右邻 c', Editor.pickActiveAfterClose(tabs, ['b'], 'b') === 'c');
check('关掉最后一个 d → 激活左邻 c', Editor.pickActiveAfterClose(tabs, ['d'], 'd') === 'c');
check('关掉第一个 a → 激活右邻 b', Editor.pickActiveAfterClose(tabs, ['a'], 'a') === 'b');
check('当前标签没被关 → 保持不动', Editor.pickActiveAfterClose(tabs, ['a'], 'c') === 'c');
check('全部关掉 → null', Editor.pickActiveAfterClose(tabs, ['a', 'b', 'c', 'd'], 'b') === null);
check('关右侧（当前 b）→ 仍是 b', Editor.pickActiveAfterClose(tabs, ['c', 'd'], 'b') === 'b');
check('连右侧一起关（b 和 c 都关）→ 优先右邻 d',
  Editor.pickActiveAfterClose(tabs, ['b', 'c'], 'b') === 'd');
check('activeId 已不在列表 → 第一个幸存者',
  Editor.pickActiveAfterClose(tabs, ['a'], 'zzz') === 'b');
check('closedIds 传 Set 也支持', Editor.pickActiveAfterClose(tabs, new Set(['b']), 'b') === 'c');

/* ------------------------------ 2. 批量删除的数据层 ------------------------------ */
console.log('\n[2] removeTabsWhere：批量删除');
const setup = (active) => {
  Store.state.tabs = mkTabs(['a', 'b', 'c', 'd']);
  Store.state.activeTabId = active || 'b';
};

setup('b');
let r = Editor.removeTabsWhere((t) => t.id !== 'b', 'b');
check('关闭其他 → 只剩当前这个', Store.state.tabs.length === 1 && Store.state.tabs[0].id === 'b');
check('…active 仍是 b', r.activeId === 'b');
check('…removed 计数正确', r.removed === 3, r.removed);

setup('c');
r = Editor.removeTabsWhere((t) => ['a', 'b'].includes(t.id), 'c');
check('关闭左侧 → 当前不变', r.activeId === 'c' && Store.state.tabs.map((t) => t.id).join() === 'c,d');

setup('b');
r = Editor.removeTabsWhere((t) => ['c', 'd'].includes(t.id), 'b');
check('关闭右侧 → 当前不变', r.activeId === 'b' && Store.state.tabs.map((t) => t.id).join() === 'a,b');

setup('c');
r = Editor.removeTabsWhere((t) => ['b', 'c', 'd'].includes(t.id), 'c');
check('当前被关且右边没了 → 激活左边 a', r.activeId === 'a' && Store.state.tabs.map((t) => t.id).join() === 'a');

setup('b');
r = Editor.removeTabsWhere(() => true, 'b');
check('关闭全部 → 空列表且 active=null', Store.state.tabs.length === 0 && r.activeId === null);
check('…removed 等于总数', r.removed === 4);

setup('b');
r = Editor.removeTabsWhere(() => false, 'b');
check('没有命中 → removed=0 且不动数据', r.removed === 0 && Store.state.tabs.length === 4);

/* ------------------------------ 3. 源码接线 ------------------------------ */
console.log('\n[3] 菜单与接线');
const src = loadSrc('editor.js');
check('标签节点绑定了 onContextMenu',
  /onContextMenu: \(e\) => showTabMenu\(e, tab\)/.test(src));
check('showTabMenu 阻止冒泡（否则菜单会被 document 的监听立刻藏掉）',
  /function showTabMenu[\s\S]{0,420}e\.stopPropagation\(\)/.test(src));
check('菜单含全部 5 项',
  ['关闭', '关闭其他标签', '关闭左侧标签', '关闭右侧标签', '关闭全部标签']
    .every((t) => src.includes(`'${t}'`)));
check('没有左侧标签时「关闭左侧」置灰', /disabled: leftIds\.size === 0/.test(src));
check('没有右侧标签时「关闭右侧」置灰', /disabled: rightIds\.size === 0/.test(src));
check('只有一个标签时「关闭其他」置灰', /disabled: tabs\.length <= 1/.test(src));
check('批量关闭只弹一次确认（不是每个都弹）',
  /const dirty = targets\.filter[\s\S]{0,600}UI\.confirm/.test(src));
check('取消确认 → 一个都不关', /if \(!ok\) return 0;/.test(src));
check('只统计未保存的（dirty）才弹确认', /const dirty = targets\.filter\(\(t\) => t\.dirty\)/.test(src));
check('关完会持久化并重绘',
  /Store\.save\(\);\s*renderTabs\(\);\s*renderCurrent\(\)/.test(src));
check('导出 closeTabsWhere / showTabMenu / removeTabsWhere',
  src.includes('closeTabsWhere, showTabMenu, pickActiveAfterClose, removeTabsWhere'));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
