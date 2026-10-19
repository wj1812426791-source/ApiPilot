/* 请求 Body 内查找（Ctrl+F）测试
   用场景：在请求编辑区的 Body 里按 Ctrl+F，应该在这个 Body 里查找，
   而不是跳到左侧「搜索…」（集合/接口搜索）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, 'src', 'css', 'app.css'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

/* editor.js 顶层没有副作用，函数内的依赖不调用就不会被求值 */
const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  setTimeout, clearTimeout,
  document: {}, navigator: {}, window: { api: {} }
};
vm.createContext(ctx);
vm.runInContext(loadSrc('editor.js') + '\nthis.__Editor = Editor;', ctx);
const Editor = ctx.__Editor;

console.log('\n[1] findHitsInText：不区分大小写的全部命中位置');
check('返回所有命中位置', JSON.stringify(Editor.findHitsInText('aXaXa', 'a')) === '[0,2,4]');
check('大小写不敏感', JSON.stringify(Editor.findHitsInText('HouseType housetype', 'housetype')) === '[0,10]');
check('空关键字 → 空数组', Editor.findHitsInText('abc', '').length === 0);
check('没命中 → 空数组', Editor.findHitsInText('abc', 'zzz').length === 0);
check('不重叠匹配（aaaa 找 aa → 0,2）', JSON.stringify(Editor.findHitsInText('aaaa', 'aa')) === '[0,2]');
check('正则元字符当普通字符（a.b.c 找 .）', JSON.stringify(Editor.findHitsInText('a.b.c', '.')) === '[1,3]');
check('换行/中文也能找', Editor.findHitsInText('第1行\n"房间类型"\n第3行', '房间类型').length === 1);
check('null/undefined 不报错', Editor.findHitsInText(null, 'a').length === 0 && Editor.findHitsInText(undefined, 'a').length === 0);
check('数字/对象输入被转成字符串处理', Editor.findHitsInText(12345, '34').length === 1);

console.log('\n[2] 源码接线');
const editorSrc = loadSrc('editor.js');
const appSrc = loadSrc('app.js');
check('editor.js 有 Body 查找条', editorSrc.includes("id: 'bodyFindBar'"));
check('查找条插在 #bodyRaw 里（跟随 raw 模式显隐）', /const host = U\.\$\('#bodyRaw'\);[\s\S]{0,80}insertBefore\(bar, host\.firstChild\)/.test(editorSrc));
check('导出了 openBodyFind / closeBodyFind / findHitsInText',
  editorSrc.includes('openBodyFind, closeBodyFind, findHitsInText'));
check('非 raw 模式时 openBodyFind 返回 false（用 hidden 判断）',
  /const host = U\.\$\('#bodyRaw'\);[\s\S]{0,140}host\.hidden\) return false/.test(editorSrc));
check('Enter / Shift+Enter 上下跳', /e\.key === 'Enter'[\s\S]{0,80}stepBodyFind\(e\.shiftKey \? -1 : 1\)/.test(editorSrc));
check('Esc 关闭并 stopPropagation（别关弹窗）',
  /e\.key === 'Escape'[\s\S]{0,60}e\.stopPropagation\(\);[\s\S]{0,40}closeBodyFind\(\)/.test(editorSrc));
check('查找时不抢焦点（避免继续打字打到 textarea）', editorSrc.includes('raw.setSelectionRange'));
check('显示 第几处/共几处', editorSrc.includes('${bodyFindIdx + 1}/${bodyFindHits.length}'));

check('app.js 的 Ctrl+F 先判断请求 Body', /k === 'f'[\s\S]{0,600}Editor\.openBodyFind/.test(appSrc));
check('焦点在 rawBody 上也走 Body 查找', /e\.target\.id === 'rawBody'/.test(appSrc));
check('Ctrl+F 三分流顺序：请求 Body → 响应体 → 集合',
  appSrc.indexOf('Editor.openBodyFind') < appSrc.indexOf('Response.openSearch')
  && appSrc.indexOf('Response.openSearch') < appSrc.lastIndexOf("U.$('#sideSearch').focus()"));

console.log('\n[3] 样式');
check('有 .body-find 样式', cssSrc.includes('.body-find {'));
check('hidden 时确实不显示（flex 会盖掉 hidden，需要显式规则）', cssSrc.includes('.body-find[hidden] { display: none; }'));
check('命中数 / 预览片段有样式', cssSrc.includes('.body-find-info') && cssSrc.includes('.body-find-preview'));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
