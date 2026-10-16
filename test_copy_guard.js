/* 快捷键守卫测试：Ctrl+C 别抢复制请求 / Ctrl+A 只全选当前文本区
   用户反馈：
   1) 在响应体里拖选一段文本，按 Ctrl+C 却提示"已复制请求「xxx」"（应该复制选中的文本）
   2) 点了响应体（以及请求 Body 面板空白处）后按 Ctrl+A 还是全选整个页面 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

/* ------------------------------ DOM 桩 ------------------------------ */
/** selKeys：这个节点"能被哪些选择器命中"，closest 按逗号拆分后逐个比对 */
const mkEl = (keys, parent, opts) => {
  const n = Object.assign({
    tagName: 'DIV', selKeys: new Set(keys || []), parentNode: parent || null,
    offsetParent: {}, style: {}, dataset: {}, children: [], hidden: false,
    focused: 0, selected: 0,
    closest(sel) {
      let c = this;
      while (c) {
        if (c.selKeys && sel.split(',').some((s) => c.selKeys.has(s.trim()))) return c;
        c = c.parentNode;
      }
      return null;
    },
    contains(t) { let c = t; while (c) { if (c === this) return true; c = c.parentNode; } return false; },
    focus() { this.focused++; },
    select() { this.selected++; }
  }, opts || {});
  if (parent) parent.children.push(n);
  return n;
};

const handlers = { mousedown: [], keydown: [] };
const selection = {
  rangeCount: 0, ranges: [], text: '',
  toString() { return this.text; },
  removeAllRanges() { this.ranges = []; this.rangeCount = 0; },
  addRange(r) { this.ranges.push(r); this.rangeCount = this.ranges.length; }
};

const doc = {
  tagName: 'BODY',
  addEventListener(type, fn, capture) { (handlers[type] = handlers[type] || []).push({ fn, capture }); },
  createRange: () => ({ node: null, selectNodeContents(el) { this.node = el; } })
};

/* 关键节点 */
const reqBodyPanel = mkEl(['.req-panel[data-rp="body"]']);
const rawBody = mkEl([], reqBodyPanel, { tagName: 'TEXTAREA' });
const resContent = mkEl(['#resContent']);
const resHeaders = mkEl(['#resHeaders']);
const treeNode = mkEl([]);
const elMap = { '#rawBody': rawBody };

/* ------------------------------ 上下文 ------------------------------ */
let copied = 0;
let selectedNode = { id: 'req1', type: 'request', name: '获取用户列表' };

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  setTimeout, clearTimeout,
  document: doc,
  window: { getSelection: () => selection, api: {} },
  U: { $: (sel) => elMap[sel] || null, el: () => mkEl(), escapeHtml: (s) => String(s) },
  Tree: {
    getSelected: () => selectedNode,
    copyNode: () => { copied++; },
    hasClipboard: () => true,
    pasteTo: () => {}
  },
  UI: { toast: () => {}, close: () => {}, contextMenu: () => {}, open: () => {} },
  Store: { state: { tabs: [], ui: {} }, save: () => {}, activeEnv: () => null },
  Editor: {}, Env: {}, Importer: {}, Scheduler: { init: () => {} },
  Response: {}, Flow: null, Vars: {}, Http: {}, Auth: {}, Modal: {}
};
vm.createContext(ctx);
vm.runInContext(loadSrc('app.js') + '\nthis.__App = App;', ctx);
const App = ctx.__App;
App.bindShortcuts();

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

/** 触发一次 keydown（所有已注册的 handler 都会跑，跟真实冒泡一致） */
const fireKey = (key, opts) => {
  const ev = {
    key, ctrlKey: true, metaKey: false, shiftKey: false,
    target: (opts && opts.target) || doc,
    pd: false,
    preventDefault() { this.pd = true; },
    stopPropagation() {}
  };
  handlers.keydown.forEach((h) => h.fn(ev));
  return ev;
};
const fireMouseDown = (target) => handlers.mousedown.forEach((h) => h.fn({ target }));
const withSelection = (text) => { selection.text = text; selection.rangeCount = text ? 1 : 0; };
const clearSelection = () => { selection.text = ''; selection.rangeCount = 0; selection.ranges = []; };

/* ------------------------------ 1. 有选区判定 ------------------------------ */
console.log('\n[1] hasTextSelection：有没有选中文本');
clearSelection();
check('没有选区 → false', App.hasTextSelection() === false);
withSelection('"houseType": "3"');
check('有选区 → true', App.hasTextSelection() === true);
withSelection('   ');
check('只选中空白也算有选区（浏览器行为一致）', App.hasTextSelection() === true);
clearSelection();

/* ------------------------------ 2. 文本区识别 ------------------------------ */
console.log('\n[2] textZoneFor：这次点击属于哪个文本区');
const inRes = mkEl([], resContent);
const zone1 = App.textZoneFor(inRes);
check('响应体里的元素 → 响应体容器', zone1 && zone1.el === resContent && zone1.field === null);
const inResHead = mkEl([], resHeaders);
check('响应头面板里的元素 → 该面板', App.textZoneFor(inResHead).el === resHeaders);
const inBody = mkEl([], reqBodyPanel);
const zone2 = App.textZoneFor(inBody);
check('请求 Body 面板里的元素 → 优先指向 #rawBody', zone2 && zone2.field === rawBody);
rawBody.offsetParent = null;          // 模拟非 raw 模式（文本域隐藏）
const zone3 = App.textZoneFor(mkEl([], reqBodyPanel));
check('文本域隐藏时退回选整个 Body 面板', zone3 && zone3.field === null && zone3.el === reqBodyPanel);
rawBody.offsetParent = {};            // 还原
check('集合树节点 → 不属于任何文本区', App.textZoneFor(treeNode) === null);
check('null / 无 closest 的对象 → null', App.textZoneFor(null) === null && App.textZoneFor({}) === null);

/* ------------------------------ 3. Ctrl+A 的作用范围 ------------------------------ */
console.log('\n[3] selectAllInZone：Ctrl+A 到底选什么');
App.setLastTextZone(null);
check('没点过文本区 → 不劫持（false）', App.selectAllInZone() === false);

App.setLastTextZone({ el: resContent, field: null });
clearSelection();
check('点过响应体 → 返回 true（调用方 preventDefault）', App.selectAllInZone() === true);
check('选区确实落在响应体容器上', selection.ranges[0] && selection.ranges[0].node === resContent);
check('只产生 1 段选区', selection.rangeCount === 1);

App.setLastTextZone({ el: reqBodyPanel, field: rawBody });
rawBody.focused = 0; rawBody.selected = 0;
check('点过请求 Body → 走文本域全选', App.selectAllInZone() === true);
check('#rawBody 被 focus + select', rawBody.focused === 1 && rawBody.selected === 1);

const hidden = mkEl(['#resContent']);
hidden.offsetParent = null;
App.setLastTextZone({ el: hidden, field: null });
check('文本区已隐藏（切到别的 tab）→ 不劫持', App.selectAllInZone() === false);

/* ------------------------------ 4. 真实按键：Ctrl+C ------------------------------ */
console.log('\n[4] 真实按 Ctrl+C');
copied = 0;
withSelection('"rows": [ { "id": "1c16417…" } ]');
let ev = fireKey('c');
check('有选区时不复制请求（copied 仍为 0）', copied === 0, 'copied=' + copied);
check('有选区时不 preventDefault（交给浏览器原生复制）', ev.pd === false);

copied = 0;
clearSelection();
ev = fireKey('c');
check('没选区时才复制请求（copied=1）', copied === 1, 'copied=' + copied);
check('复制请求时 preventDefault', ev.pd === true);

copied = 0;
withSelection('x');
ev = fireKey('c', { target: rawBody });
check('焦点在文本域里 → 不劫持（原生复制文本域选区）', copied === 0 && ev.pd === false);

copied = 0;
clearSelection();
selectedNode = null;
ev = fireKey('c');
check('没选中任何节点 → 什么也不做', copied === 0 && ev.pd === false);
selectedNode = { id: 'req1', type: 'request', name: '获取用户列表' };

/* ------------------------------ 5. 真实按键：Ctrl+A ------------------------------ */
console.log('\n[5] 真实按 Ctrl+A');
App.setLastTextZone(null);
clearSelection();
ev = fireKey('a');
check('没点过文本区 → 不劫持（全页选中维持原样）', ev.pd === false);

fireMouseDown(mkEl([], resContent));      // 用户点了一下响应体的内容
clearSelection();
ev = fireKey('a');
check('点过响应体后 Ctrl+A → preventDefault', ev.pd === true);
check('…且选区锁定在响应体里', selection.ranges[0] && selection.ranges[0].node === resContent);

fireMouseDown(treeNode);                  // 转头点了集合树节点
clearSelection();
ev = fireKey('a');
check('点了集合树之后 → 不再限定（恢复默认行为）', ev.pd === false);

fireMouseDown(mkEl([], reqBodyPanel));    // 点在请求 Body 面板的空白处
rawBody.focused = 0; rawBody.selected = 0;
clearSelection();
ev = fireKey('a');
check('点请求 Body 空白处 → 选中 #rawBody', ev.pd === true && rawBody.selected === 1);

/* ------------------------------ 6. 源码接线 ------------------------------ */
console.log('\n[6] 源码接线检查');
const appSrc = loadSrc('app.js');
const editorSrc = loadSrc('editor.js');
check('Ctrl+C 分支有 hasTextSelection 守卫', /k === 'c'[\s\S]{0,260}hasTextSelection\(\)\)\s*return/.test(appSrc));
check("新增了 Ctrl+A 分支（k === 'a'）", /k === 'a'/.test(appSrc));
check('Ctrl+A 分支先判断 isEditable', /k === 'a'[\s\S]{0,160}isEditable\(e\.target\)/.test(appSrc));
check('Ctrl+A 分支用 selectAllInZone 判定', /k === 'a'[\s\S]{0,260}selectAllInZone\(\)/.test(appSrc));
check('mousedown 以捕获方式记录文本区',
  /addEventListener\('mousedown'[\s\S]{0,120}textZoneFor\(e\.target\)[\s\S]{0,40}\},\s*true\)/.test(appSrc));
check('响应区四个面板 + 流程结果区都在识别范围内',
  appSrc.includes('#resContent, #resHeaders, #resRequest, #resScheduleLog, #flowResult'));
check('editor.js 已移除重复的 doc 级 Ctrl+A（bodyRegionActive 不再存在）', !editorSrc.includes('bodyRegionActive'));
check('editor.js 仍保留 #rawBody 自身的 Ctrl+A 全选', /rawBody'\)\.addEventListener\('keydown'/.test(editorSrc));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
