/* 地址栏复制完整 URL（含查询参数）
   场景：地址栏只显示 base（参数在下面表格里），Ctrl+A Ctrl+C 得到的 URL 会丢参数，
   贴到浏览器里就 404。现在「全选复制」会自动补上启用中的 params。 */
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
  parseInt, setTimeout, clearTimeout, document: {}, navigator: {}, window: { api: {} },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U=U;', ctx); ctx.U = ctx.__U;
vm.runInContext(loadSrc('store.js') + '\nthis.__Store=Store;', ctx); ctx.Store = ctx.__Store;
vm.runInContext(loadSrc('vars.js') + '\nthis.__Vars=Vars;', ctx); ctx.Vars = ctx.__Vars;
vm.runInContext(loadSrc('auth.js') + '\nthis.__Auth=Auth;', ctx); ctx.Auth = ctx.__Auth;
vm.runInContext(loadSrc('http.js') + '\nthis.__Http=Http;', ctx); ctx.Http = ctx.__Http;
vm.runInContext(loadSrc('editor.js') + '\nthis.__Editor=Editor;', ctx);
const Store = ctx.Store;
const Editor = ctx.__Editor;

Store.state.environments = [{
  id: 'e1', name: '测试环境',
  variables: [
    { key: 'baseUrl', value: 'http://x.y', enabled: true },
    { key: 'pid', value: 'P-9', enabled: true }
  ],
  headers: [], login: { enabled: false }, token: { value: '' }
}];
Store.state.activeEnvId = 'e1';

const mkReq = (url, params) => {
  const r = Store.newRequest('t');
  r.url = url;
  r.params = params || [];
  return r;
};

console.log('\n[1] fullUrlOf：完整 URL');
check('只拼启用中的参数（禁用的不发）',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/user/page', [
    { key: 'pageNum', value: '1', enabled: true },
    { key: 'pageSize', value: '10', enabled: true },
    { key: 'off', value: 'x', enabled: false }
  ])) === 'http://x.y/api/user/page?pageNum=1&pageSize=10',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/user/page', [
    { key: 'pageNum', value: '1', enabled: true },
    { key: 'pageSize', value: '10', enabled: true },
    { key: 'off', value: 'x', enabled: false }
  ])));

check('没有参数 → 原样（不带问号）',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/user/page')) === 'http://x.y/api/user/page');

check('变量被解析（URL 和参数值里都可以）',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/user/{{pid}}', [
    { key: 'proj', value: '{{pid}}', enabled: true }
  ])) === 'http://x.y/api/user/P-9?proj=P-9',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/user/{{pid}}', [{ key: 'proj', value: '{{pid}}', enabled: true }])));

check('URL 自带的 query 不会丢',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/a?keep=yes', [
    { key: 'page', value: '2', enabled: true }
  ])) === 'http://x.y/api/a?keep=yes&page=2',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/api/a?keep=yes', [{ key: 'page', value: '2', enabled: true }])));

check('参数值做 URL 编码',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/a', [
    { key: 'q', value: 'a b&c', enabled: true }
  ])) === 'http://x.y/a?q=a%20b%26c',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/a', [{ key: 'q', value: 'a b&c', enabled: true }])));

check('空 key 的参数被忽略',
  Editor.fullUrlOf(mkReq('{{baseUrl}}/a', [{ key: '', value: 'x', enabled: true }])) === 'http://x.y/a');

check('null 请求不崩', Editor.fullUrlOf(null) === '');

/* ------------------------------ 2. 源码接线 ------------------------------ */
console.log('\n[2] 地址栏 Ctrl+C 接线');
const src = loadSrc('editor.js');
check('地址栏 keydown 里处理 Ctrl+C',
  /function onUrlKeydown[\s\S]{0,1200}e\.key\.toLowerCase\(\) === 'c'/.test(src));
check('只在「全选整个地址」时才补参数',
  /selectionStart === 0 && input\.selectionEnd === input\.value\.length/.test(src));
check('内容已经一致时不做拦截（局部选中走原生复制）',
  /full && full !== input\.value[\s\S]{0,80}e\.preventDefault\(\)/.test(src));
check('复制后给提示', src.includes('已复制完整 URL（含查询参数）'));
check('剪贴板失败不抛未处理异常', src.includes('U.copy(full).catch('));
check('导出了 fullUrlOf', src.includes('fullUrlOf,'));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
