/* 轻量 Node 测试：弹窗支持嵌套叠加
   场景：环境管理弹窗里点「新建环境」→ 不该把环境管理弹窗顶掉，确定后仍留在原弹窗 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

/* ------------------------- 极简 DOM 桩 ------------------------- */
let elSeq = 0;
function makeEl(tag) {
  const el = {
    __id: ++elSeq,
    tagName: String(tag || 'div').toUpperCase(),
    children: [], parentNode: null,
    style: {}, dataset: {}, attrs: {},
    className: '', id: '', value: '', type: '',
    hidden: false, checked: false, disabled: false,
    listeners: {},
    classList: { add() { }, remove() { }, toggle() { } },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) {
      this.attrs[k] = v;
      if (k === 'class') this.className = v;
      if (k === 'id') this.id = v;
      if (k === 'hidden') this.hidden = true;
      if (k === 'value' || k === 'type' || k === 'placeholder' || k === 'title') this[k] = v;
    },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector(sel) { return find(this, sel)[0] || null; },
    querySelectorAll(sel) { return find(this, sel); },
    getBoundingClientRect() { return { width: 300, height: 200, left: 0, top: 0 }; },
    focus() { }, select() { }
  };
  let _text = '', _html = '';
  Object.defineProperty(el, 'textContent', {
    get() { return _text || this.children.map((c) => c.textContent).join(''); },
    set(v) { _text = String(v); this.children.length = 0; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); this.children.length = 0; }
  });
  return el;
}

function matches(node, sel) {
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel.startsWith('.')) return String(node.className).split(/\s+/).includes(sel.slice(1));
  return node.tagName === sel.toUpperCase();
}
function find(node, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); }
  };
  walk(node);
  return out;
}
/** node 是否在 ancestor 子树内（沿 parentNode 上溯） */
function isInside(node, ancestor) {
  let n = node;
  while (n) { if (n === ancestor) return true; n = n.parentNode; }
  return false;
}
function fire(node, type, evt) {
  const e = evt || {};
  (node.listeners[type] || []).forEach((fn) => fn(e));
  return e;
}
/** 模拟冒泡：元素处理器没 stopPropagation 时继续派发给 document */
function fireKey(node, evt) {
  const e = evt || {};
  e.__stopped = false;
  const sp = e.stopPropagation;
  e.stopPropagation = () => { e.__stopped = true; if (sp) sp(); };
  (node.listeners.keydown || []).forEach((fn) => fn(e));
  if (!e.__stopped) (docListeners.keydown || []).forEach((fn) => fn(e));
  return e;
}

const modalRoot = makeEl('div'); modalRoot.id = 'modalRoot';
const ctxMenu = makeEl('div'); ctxMenu.id = 'ctxMenu';
const toastWrap = makeEl('div'); toastWrap.id = 'toastWrap';
const docListeners = {};
const documentStub = {
  body: makeEl('body'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => { const n = makeEl('#text'); n.textContent = t; return n; },
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
  querySelector(sel) {
    if (sel === '#modalRoot') return modalRoot;
    if (sel === '#ctxMenu') return ctxMenu;
    if (sel === '#toastWrap') return toastWrap;
    return makeEl('div');
  },
  querySelectorAll: () => []
};

const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, Boolean, RegExp, Map, Set,
  encodeURIComponent, decodeURIComponent, unescape, setTimeout, clearTimeout, Promise,
  document: documentStub, navigator: {},
  window: { innerWidth: 1200, innerHeight: 800 }
};
vm.createContext(context);
vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', context);
vm.runInContext(loadSrc('modal.js') + '\nthis.__UI = UI;', context);
const U = context.__U;
const UI = context.__UI;

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

(async () => {
  /* =====================================================================
     核心场景：环境管理 → 新建环境 → 确定后仍在环境管理里
     ===================================================================== */
  console.log('\n[1] 环境管理里新建环境（用户报的那个 bug）');

  let bottomClosed = 0;
  const envBody = U.el('div', { class: 'env-layout' });
  UI.open({
    title: '环境管理', size: 'lg', body: envBody,
    onClose: () => { bottomClosed++; }
  });
  const firstLayer = modalRoot.children[0];

  check('环境管理打开：depth=1', UI.depth() === 1, 'depth=' + UI.depth());
  check('modal-root 可见', modalRoot.hidden === false);

  const promptP = UI.prompt('环境名称', '新环境', { title: '新建环境' });

  check('弹出「新建环境」后 depth=2', UI.depth() === 2, 'depth=' + UI.depth());
  check('两层同时存在（不再替换掉下面那层）', modalRoot.children.length === 2, '层数=' + modalRoot.children.length);
  check('环境管理那层还在 DOM 里（还是同一个节点）', modalRoot.children[0] === firstLayer);
  check('环境管理的内容仍挂着', isInside(envBody, firstLayer));
  check('下层弹窗没有被触发关闭', bottomClosed === 0);

  const promptLayer = modalRoot.children[1];
  const promptInput = find(promptLayer, 'INPUT')[0];
  promptInput.value = '我的新环境';
  const okBtn = find(promptLayer, 'BUTTON').find((b) => b.textContent.trim() === '确定');
  check('找得到「确定」按钮', !!okBtn);
  fire(okBtn, 'click');

  const name = await promptP;
  check('输入框返回新环境名', name === '我的新环境', 'name=' + name);
  check('确定后弹出层消失：depth=1', UI.depth() === 1, 'depth=' + UI.depth());
  check('确定后只剩环境管理这一层', modalRoot.children.length === 1);
  check('确定后仍是原来那层节点', modalRoot.children[0] === firstLayer);
  check('确定后环境管理仍可见（没被关掉）', modalRoot.hidden === false);
  check('确定后环境管理内容仍在 DOM 里', isInside(envBody, firstLayer));
  check('确定后没有误触发下层 onClose', bottomClosed === 0);

  /* =====================================================================
     Esc 在输入框里只关输入框，不会连下层一起关
     ===================================================================== */
  console.log('\n[2] 输入框里按 Esc');

  const p2 = UI.prompt('环境名称', 'x', { title: '新建环境' });
  const layer2 = modalRoot.children[1];
  const input2 = find(layer2, 'INPUT')[0];
  const evt = fireKey(input2, { key: 'Escape' });

  check('Esc 被 stopPropagation（不会冒泡到 document）', evt.__stopped === true);
  const name2 = await p2;
  check('Esc 取消返回 null', name2 === null, 'name=' + name2);
  check('Esc 后 depth=1（环境管理还在）', UI.depth() === 1, 'depth=' + UI.depth());
  check('Esc 后没有误关下层', bottomClosed === 0);
  check('Esc 后环境管理内容仍在', isInside(envBody, modalRoot.children[0]));

  /* =====================================================================
     Esc（焦点不在输入框）关掉最上面一层
     ===================================================================== */
  console.log('\n[3] 普通 Esc / 关闭行为');

  let closed1 = 0;
  const hA = UI.open({ title: 'A', body: U.el('div'), onClose: () => { closed1++; } });
  fireKey(U.el('div'), { key: 'Escape' });
  check('Esc 关掉最上面一层', UI.depth() === 1, 'depth=' + UI.depth());
  check('被关的那层 onClose 有触发', closed1 === 1);
  check('下面那层还在', isInside(envBody, modalRoot.children[0]));
  void hA;

  check('A 被 Esc 关掉后只剩环境管理：depth=1', UI.depth() === 1, 'depth=' + UI.depth());
  check('环境管理仍开着，onClose 未触发', bottomClosed === 0);

  UI.close();
  check('关掉最后一层：depth=0', UI.depth() === 0);
  check('关掉最后一层后隐藏 modal-root', modalRoot.hidden === true);
  check('关掉最后一层后 DOM 清空', modalRoot.children.length === 0);
  check('环境管理 onClose 触发一次', bottomClosed === 1);
  check('空栈再 close 不报错', (() => { try { UI.close(); return UI.depth() === 0; } catch (_) { return false; } })());

  /* =====================================================================
     关闭指定层 / closeAll / replace
     ===================================================================== */
  console.log('\n[4] 指定层关闭 / closeAll / replace');

  let aClosed = 0, bClosed = 0;
  const hBottom = UI.open({ title: 'A', body: U.el('div', { class: 'body-a' }), onClose: () => { aClosed++; } });
  const hTop = UI.open({ title: 'B', body: U.el('div', { class: 'body-b' }), onClose: () => { bClosed++; } });
  check('叠了两层：depth=2', UI.depth() === 2);

  hBottom.close();                            // 关下层（不是栈顶）
  check('关指定层只移除那一层：depth=1', UI.depth() === 1, 'depth=' + UI.depth());
  check('指定层的 onClose 触发', aClosed === 1);
  check('栈顶那层没被误关（onClose 未触发）', bClosed === 0);
  check('留在 DOM 里的是 B', find(hTop.modal, 'H3')[0].textContent === 'B');
  check('B 仍在 modal-root 里', isInside(hTop.modal, modalRoot.children[0]));

  UI.open({ title: 'C', size: 'sm', body: U.el('div') });
  check('再叠一层：depth=2', UI.depth() === 2);
  UI.closeAll();
  check('closeAll 清空：depth=0', UI.depth() === 0);
  check('closeAll 后隐藏且 DOM 清空', modalRoot.hidden === true && modalRoot.children.length === 0);

  let repClosed = 0;
  UI.open({ title: '环境管理', body: U.el('div'), onClose: () => { repClosed++; } });
  UI.open({ title: '环境管理', body: U.el('div'), replace: true });
  check('replace：不叠加（depth=1）', UI.depth() === 1, 'depth=' + UI.depth());
  check('replace：DOM 里也只有一层', modalRoot.children.length === 1);
  check('replace：旧的那层被关掉', repClosed === 1);
  UI.closeAll();

  /* =====================================================================
     源码 / 接线检查
     ===================================================================== */
  console.log('\n[5] 源码接线检查');

  const modalCode = loadSrc('modal.js');
  const css = fs.readFileSync(path.join(__dirname, 'src', 'css', 'app.css'), 'utf8');
  const envCode = loadSrc('env.js');

  check('modal.js 不再用 holder.innerHTML 清空（那是替换式弹窗的根因）', !modalCode.includes("holder.innerHTML = ''"));
  check('modal.js 每层用 .modal-layer 承载', modalCode.includes("class: 'modal-layer'"));
  check('modal.js close 支持指定层', modalCode.includes('function close(entry)'));
  check('modal.js 暴露 depth / closeAll', modalCode.includes('closeAll, depth'));
  check('modal.js 关闭按钮关自己那层', modalCode.includes('closeBtn.addEventListener'));
  check('modal.js open 支持 replace', modalCode.includes('replace = false'));
  check('css 定义 .modal-layer', css.includes('.modal-layer {'));
  check('css 对叠加层加淡遮罩', css.includes('.modal-layer ~ .modal-layer'));
  check('css 有入场动画', css.includes('@keyframes modalIn'));

  check('环境管理是顶层入口（replace）', envCode.includes("title: '环境管理', size: 'lg', body: layout, replace: true"));
  check('环境管理新建后仍重绘自身', envCode.includes('selectedId = env.id;') && envCode.includes('reRender();'));
  check('app 设置弹窗用 replace', loadSrc('app.js').includes("title: '设置与信息', size: 'md', body, replace: true"));
  check('定时任务弹窗用 replace', loadSrc('scheduler.js').includes('replace: true'));
  const impCode = loadSrc('importer.js');
  check('importer 顶层弹窗用 replace（导入/导出各一处）',
    (impCode.match(/replace: true/g) || []).length === 2,
    '出现 ' + (impCode.match(/replace: true/g) || []).length + ' 次');
  check('「导出环境」不用 replace（它是在环境管理弹窗里点的）',
    !/title: '导出请求'[\s\S]{0,40}replace/.test(impCode));

  console.log('\n' + '='.repeat(46));
  console.log(`弹窗嵌套叠加：${passed} 通过 / ${failed} 失败`);
  console.log('='.repeat(46));
  process.exit(failed ? 1 : 0);
})();
