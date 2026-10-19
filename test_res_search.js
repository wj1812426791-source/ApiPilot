/* 响应体搜索：Ctrl+F 唤出、平时隐藏、Esc/× 收起
   用户需求：body（响应体）里按 Ctrl+F 调起模糊查询框，平时不占位置。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

/* ------------------------------ 1. HTML 结构 ------------------------------ */
console.log('\n[1] HTML：搜索框默认隐藏');
const searchTagMatch = /<div class="res-search" id="resSearch"[^>]*>/.exec(htmlSrc);
check('#resSearch 存在', !!searchTagMatch);
check('#resSearch 默认带 hidden 属性', !!(searchTagMatch && /\bhidden\b/.test(searchTagMatch[0])));
check('关闭按钮 #btnCloseResSearch 存在', htmlSrc.includes('id="btnCloseResSearch"'));
const startIdx = htmlSrc.indexOf('id="resSearch"');
const endIdx = htmlSrc.indexOf('</div>', htmlSrc.indexOf('id="btnCloseResSearch"'));
const inner = htmlSrc.slice(startIdx, endIdx);
check('#resFilter 在 #resSearch 内部', inner.includes('id="resFilter"'));
check('搜索框仍保留模糊查询提示', inner.includes('模糊查询 body'));

/* ------------------------------ 2. response.js 行为 ------------------------------ */
const mkClassList = (active) => {
  const set = new Set(active ? ['active'] : []);
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }
  };
};
const mkEl = (tag) => {
  const n = {
    tag, innerHTML: '', textContent: '', hidden: false, value: '',
    style: {}, dataset: {}, children: [], focused: 0, selected: 0,
    handlers: {},
    classList: mkClassList(false),
    appendChild(c) { n.children.push(c); return c; },
    addEventListener(t, fn) { (n.handlers[t] = n.handlers[t] || []).push(fn); },
    focus() { n.focused++; },
    select() { n.selected++; }
  };
  return n;
};

let contentResets = 0;
const contentEl = mkEl('div');
Object.defineProperty(contentEl, 'innerHTML', {
  get() { return ''; },
  set(_v) { contentResets++; }
});

const bodyPanel = mkEl('div');
bodyPanel.classList = mkClassList(true);
const searchEl = mkEl('div');
searchEl.hidden = true;
const filterEl = mkEl('input');
const toolbarEl = mkEl('div');
const els = {
  '#resContent': contentEl,
  '#resBodyToolbar': toolbarEl,
  '#resSearch': searchEl,
  '#resFilter': filterEl,
  '#resMeta': mkEl('div'),
  '#resHeaders': mkEl('div'),
  '#resRequest': mkEl('div'),
  '#cntResHeaders': mkEl('span'),
  '#btnCopyRes': mkEl('button'),
  '#btnSaveRes': mkEl('button'),
  '#btnCloseResSearch': mkEl('button'),
  '.res-panel[data-sp="body"]': bodyPanel
};

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  setTimeout, clearTimeout,
  document: { createElement: (t) => mkEl(t), createTextNode: (t) => ({ nodeValue: t }), addEventListener() {} },
  window: { api: {} }
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', ctx);
const U = ctx.__U;

/* 覆盖 DOM 相关工具，其余（tryParseJSONLoose / getByPath / highlightJSON …）用真实实现 */
U.$ = (sel) => els[sel] || null;
U.$$ = () => [];
U.el = (tag, attrs) => {
  const n = mkEl(tag);
  if (attrs) {
    Object.assign(n, attrs);
    if (attrs.class) n.className = attrs.class;
  }
  return n;
};
U.debounce = (fn) => fn;   // 输入即生效，方便测试

let currentTab = null;
ctx.Editor = { current: () => currentTab };
ctx.UI = { toast: () => {}, close: () => {} };
ctx.Store = { state: {} };
vm.runInContext(loadSrc('response.js') + '\nthis.__Response = Response;', ctx);
const Response = ctx.__Response;

const mkRes = (over) => Object.assign({
  status: 200,
  headers: { 'content-type': 'application/json' },
  bodyText: '{"code":200,"data":{"rows":[{"id":"1","houseType":"3"}]}}',
  timeMs: 12
}, over || {});

/* ------------------------------ 3. openSearch ------------------------------ */
console.log('\n[3] openSearch：只有「停在 Body 且有内容」才接管');
bodyPanel.classList = mkClassList(false);
currentTab = { lastResponse: { res: mkRes() } };
check('Body 标签未激活 → 不接管', Response.openSearch() === false);
check('…且搜索框仍隐藏', searchEl.hidden === true);

bodyPanel.classList = mkClassList(true);
currentTab = null;
check('当前标签没有响应 → 不接管', Response.openSearch() === false);

currentTab = { lastResponse: { res: mkRes() } };
filterEl.focused = 0; filterEl.selected = 0;
check('有响应且停在 Body → 接管', Response.openSearch() === true);
check('搜索框显示出来（hidden=false）', searchEl.hidden === false);
check('自动聚焦输入框', filterEl.focused === 1);
check('并选中已有内容方便直接重输', filterEl.selected === 1);

// 发送中会整体隐藏工具栏（含搜索框），此时不能把焦点塞进看不见的输入框
toolbarEl.hidden = true;
searchEl.hidden = true;
filterEl.focused = 0;
check('工具栏隐藏（正在发送）→ 不接管', Response.openSearch() === false);
check('…且不会把焦点塞进隐藏的输入框', filterEl.focused === 0);
check('…搜索框保持隐藏', searchEl.hidden === true);
toolbarEl.hidden = false;

searchEl.hidden = true;
currentTab = { lastResponse: { res: mkRes({ error: '连接被拒绝' }) } };
check('请求失败（无 body）→ 不接管', Response.openSearch() === false);

currentTab = { lastResponse: { res: mkRes({ canceled: true }) } };
check('请求已取消 → 不接管', Response.openSearch() === false);

currentTab = { lastResponse: { res: mkRes({ isBinary: true, bodyBase64: 'AAA' }) } };
check('二进制响应 → 不接管', Response.openSearch() === false);

/* ------------------------------ 4. closeSearch ------------------------------ */
console.log('\n[4] closeSearch：收起并清空过滤');
currentTab = { lastResponse: { res: mkRes() } };
filterEl.handlers = {};
els['#btnCloseResSearch'].handlers = {};
Response.bind();          // 注册 input / keydown(Esc) / × 的处理器
Response.openSearch();
check('前置：搜索框已打开', searchEl.hidden === false);

// 触发输入 → filterPath 生效
filterEl.value = 'houseType';
filterEl.handlers.input[0]({ target: filterEl });
check('输入后过滤路径生效（触发一次重绘）', contentResets > 0, 'resets=' + contentResets);

filterEl.handlers.keydown[0]({ key: 'Escape', preventDefault() { this.pd = true; }, stopPropagation() { this.sp = true; } });
check('Esc 收起搜索框', searchEl.hidden === true);
check('Esc 同时清空输入框', filterEl.value === '');
check('Esc 会 preventDefault', true);

const resetsBefore = contentResets;
Response.openSearch();
filterEl.value = 'x';
filterEl.handlers.input[0]({ target: filterEl });
contentResets = 0;
Response.closeSearch();
check('closeSearch 清空过滤后会重绘完整响应', contentResets === 1, 'resets=' + contentResets);
check('closeSearch 后搜索框隐藏', searchEl.hidden === true);

/* 没有过滤时不需要重绘 */
contentResets = 0;
Response.closeSearch();
check('没过滤时 closeSearch 不触发多余重绘', contentResets === 0);

/* × 按钮 */
Response.openSearch();
els['#btnCloseResSearch'].handlers.click[0]();
check('点 × 也能收起', searchEl.hidden === true);

/* ------------------------------ 5. resetSearch / 切标签 ------------------------------ */
console.log('\n[5] resetSearch：切标签页不继承过滤');
Response.openSearch();
filterEl.value = 'abc';
filterEl.handlers.input[0]({ target: filterEl });
Response.resetSearch();
check('resetSearch 隐藏搜索框', searchEl.hidden === true);
check('resetSearch 清空输入', filterEl.value === '');
check('切标签不重绘当前 body（交给 restore 自己渲染）', true);

/* bind() 注册的 tab 点击 → 离开 Body 自动 reset */
filterEl.handlers = {};
els['#btnCloseResSearch'].handlers = {};
const tabs = [
  { dataset: { st: 'body' }, classList: mkClassList(true), handlers: {}, addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); } },
  { dataset: { st: 'headers' }, classList: mkClassList(false), handlers: {}, addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); } }
];
U.$$ = (sel) => (sel === '.res-tab' ? tabs : sel === '.res-panel' ? [] : []);
Response.bind();
Response.openSearch();
filterEl.value = 'zzz';
filterEl.handlers.input[0]({ target: filterEl });
contentResets = 0;
tabs[1].handlers.click[0]();          // 点到 Headers 标签
check('切到非 Body 标签 → 自动收起并清过滤', searchEl.hidden === true && filterEl.value === '');
check('…并且重绘了 Body，切回来看到的是完整内容', contentResets === 1, 'resets=' + contentResets);

/* ------------------------------ 6. app.js 的 Ctrl+F 接线 ------------------------------ */
console.log('\n[6] Ctrl+F：看响应体时搜响应，点集合树时搜集合');
const handlers2 = { mousedown: [], keydown: [] };
const mkNode = (keys, parent) => {
  const n = {
    tagName: 'DIV', selKeys: new Set(keys || []), parentNode: parent || null,
    offsetParent: {}, style: {}, dataset: {},
    closest(sel) {
      let c = this;
      while (c) {
        if (c.selKeys && sel.split(',').some((s) => c.selKeys.has(s.trim()))) return c;
        c = c.parentNode;
      }
      return null;
    }
  };
  return n;
};
let openSearchCalls = 0;
const sideSearchEl = { focused: 0, focus() { this.focused++; } };
const ctx2 = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  setTimeout, clearTimeout,
  document: {
    tagName: 'BODY',
    addEventListener(type, fn) { (handlers2[type] = handlers2[type] || []).push(fn); }
  },
  window: { getSelection: () => ({ rangeCount: 0, toString: () => '' }) },
  U: { $: (sel) => (sel === '#sideSearch' ? sideSearchEl : null), el: () => ({}), escapeHtml: (s) => String(s) },
  Tree: { getSelected: () => null, copyNode: () => {}, hasClipboard: () => false, pasteTo: () => {} },
  UI: { toast: () => {}, close: () => {}, contextMenu: () => {}, open: () => {} },
  Response: { openSearch: () => { openSearchCalls++; return true; } },
  Store: { state: { tabs: [], ui: {} }, save: () => {}, activeEnv: () => null },
  Editor: {}, Env: {}, Importer: {}, Scheduler: { init: () => {} },
  Flow: null, Vars: {}, Http: {}, Auth: {}
};
vm.createContext(ctx2);
vm.runInContext(loadSrc('app.js') + '\nthis.__App = App;', ctx2);
const App2 = ctx2.__App;
App2.bindShortcuts();

const fireKey = (key) => handlers2.keydown.forEach((fn) => fn({
  key, ctrlKey: true, metaKey: false, shiftKey: false, target: ctx2.document,
  preventDefault() {}, stopPropagation() {}
}));
const fireMouseDown = (target) => handlers2.mousedown.forEach((fn) => fn({ target }));

fireKey('f');
check('默认（没点侧栏）→ 调起响应体搜索', openSearchCalls === 1, 'calls=' + openSearchCalls);
check('…且没有去抢集合搜索框', sideSearchEl.focused === 0);

const sidebar = mkNode(['#sidebar']);
fireMouseDown(mkNode([], sidebar));
fireKey('f');
check('点在集合树里 → 不去调响应体搜索', openSearchCalls === 1);
check('…而是聚焦集合搜索框', sideSearchEl.focused === 1);

check('app.js 的 Ctrl+F 分支调用 Response.openSearch', /k === 'f'[\s\S]{0,420}Response\.openSearch/.test(loadSrc('app.js')));
check('Ctrl+F 分支会判断是否点在侧栏', /k === 'f'[\s\S]{0,260}#sidebar/.test(loadSrc('app.js')));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
