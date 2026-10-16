/* 轻量 Node 测试：单请求导出（Postman 结构）+ 取消发送/导出的代码就位检查 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');
const loadRoot = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, RegExp, Map, Set,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  document: {}, window: {}
};
vm.createContext(context);

context.Store = {
  state: { globals: [], environments: [], collections: [] },
  activeEnv: () => null,
  newRequest: (name) => ({
    id: 'req_x', type: 'request', name, method: 'GET', url: '',
    params: [], pathVars: [], headers: [],
    body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] },
    auth: { type: 'inherit' }, settings: { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 }
  }),
  newCollection: (name) => ({ id: 'col_x', type: 'collection', name, items: [] }),
  newFolder: (name) => ({ id: 'fld_x', type: 'folder', name, items: [] })
};

vm.runInContext(loadSrc('util.js'), context);
vm.runInContext(loadSrc('importer.js') + '\nthis.__Importer = Importer;', context);
const Importer = context.__Importer;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

console.log('单请求导出（Postman v2.1 结构）');
const req = {
  id: 'req_1', type: 'request', name: '获取详情', method: 'POST', url: 'http://api.test/item',
  params: [{ key: 'id', value: '5', enabled: true }],
  pathVars: [],
  headers: [{ key: 'X-Test', value: 'a', enabled: true }],
  body: { mode: 'raw', raw: '{"a":1}', rawType: 'application/json', formdata: [], urlencoded: [] },
  auth: { type: 'bearer', bearer: 'T' },
  settings: { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 }
};
const pm = Importer.toPostman({ id: 'col_tmp', name: '获取详情', items: [req] });
check('info.name 为请求名', pm.info.name === '获取详情');
check('仅含 1 个 item', Array.isArray(pm.item) && pm.item.length === 1);
check('item[0].name 正确', pm.item[0].name === '获取详情');
check('method 保留', pm.item[0].request.method === 'POST');
check('url.raw 保留', String(pm.item[0].request.url.raw).includes('http://api.test/item'));
check('query 保留', !!(pm.item[0].request.url.query && pm.item[0].request.url.query[0].key === 'id'));
check('header 保留', pm.item[0].request.header.some((h) => h.key === 'X-Test'));
check('body raw 保留', !!(pm.item[0].request.body && pm.item[0].request.body.raw === '{"a":1}'));
check('bearer 认证保留', !!(pm.item[0].request.auth && pm.item[0].request.auth.type === 'bearer'));

console.log('\ncURL 解析回归');
const curl = Importer.fromCurl("curl -X POST 'http://api.test/login' -H 'Content-Type: application/json' -d '{\"u\":\"a\"}'");
check('cURL method=POST', curl && curl.method === 'POST');
check('cURL body raw 正确', curl && curl.body.mode === 'raw' && curl.body.raw === '{"u":"a"}');

console.log('\n取消发送 / 导出 代码就位检查');
const mainCode = loadRoot('main.js');
const httpCode = loadSrc('http.js');
const preloadCode = loadRoot('preload.js');
const importerCode = loadSrc('importer.js');
const editorCode = loadSrc('editor.js');
const treeCode = loadSrc('tree.js');

check('main.js 跟踪进行中请求 activeRequests', mainCode.includes('const activeRequests = new Map()'));
check('main.js 提供 http:cancel', mainCode.includes("ipcMain.handle('http:cancel'"));
check('main.js 取消时标记 canceled', mainCode.includes('canceled: true'));
check('main.js http:send 传入 reqId', mainCode.includes('config && config.reqId'));
check('preload 暴露 api.cancel', preloadCode.includes('cancel: (reqId) =>'));
check('http.js send 透传 reqId', httpCode.includes('if (reqId) built.config.reqId = reqId'));
check('editor.js 发送中可取消', editorCode.includes('async function cancelSend()'));
check('editor.js 处理 canceled 结果', editorCode.includes('res.canceled'));
check('editor.js 发送按钮切换为取消', editorCode.includes("btn.classList.add('sending')"));
check('importer 导出 exportRequest', importerCode.includes('async function exportRequest'));
check('importer 支持导入 _apipilotRequest', importerCode.includes('_apipilotRequest'));
check('tree 请求菜单含「导出请求…」', treeCode.includes('导出请求…'));

console.log('\nBody Ctrl+A 作用范围检查');
// 「点过 Body 面板空白处 / 响应体后 Ctrl+A 只选该块」已统一到 app.js（App.textZoneFor → selectAllInZone）
check('app.js 统一处理文本区 Ctrl+A（Body 面板 / 响应体）', loadSrc('app.js').includes('selectAllInZone'));
check('editor.js 不再重复注册 doc 级 Ctrl+A', !editorCode.includes('bodyRegionActive'));
check('editor.js rawBody 拦截 Ctrl+A', editorCode.includes("e.key.toLowerCase() === 'a'"));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
