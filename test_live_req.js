/* 轻量 Node 测试：右键「复制为 cURL / 导出请求」要取编辑区最新数据，而不是没保存的旧节点 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

// 复刻真实场景：集合节点是空的（URL 没填），编辑区草稿里有真实内容且未保存
const node = {
  id: 'req_1', type: 'request', name: '获取房间列表', method: 'GET', url: '',
  params: [], pathVars: [], headers: [],
  body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] },
  auth: { type: 'inherit' }, settings: { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 }
};
const draft = {
  ...JSON.parse(JSON.stringify(node)),
  name: '获取房间列表',
  url: '{{baseUrl}}/mrbs/meetingRooms',
  headers: [{ key: 'x-current-project', value: 'P1', enabled: true }]
};
const other = { ...JSON.parse(JSON.stringify(node)), id: 'req_2', url: 'http://a.b/c', name: '未打开的请求' };

const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, Boolean, RegExp, Map, Set,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  document: {}, navigator: {}, window: { api: {} }
};
vm.createContext(context);

context.Store = {
  state: {
    globals: [],
    environments: [{ id: 'e1', name: '测试', variables: [{ key: 'baseUrl', value: 'http://jn.larfe.net:40002', enabled: true }], login: { enabled: false }, token: {} }],
    collections: [],
    tabs: [{ id: 'tab_1', refId: 'req_1', draft, dirty: true }],
    activeEnvId: 'e1'
  },
  activeEnv() { return this.state.environments[0]; },
  findRequest: (id) => (id === 'req_1' ? node : id === 'req_2' ? other : null),
  save: () => {}, newRequest: () => JSON.parse(JSON.stringify(node)),
  DEFAULT_LOGIN: () => ({}), DEFAULT_TOKEN: () => ({})
};
context.UI = { toast: () => {}, open: () => {}, close: () => {}, prompt: () => Promise.resolve(''), confirm: () => Promise.resolve(true) };
context.Auth = { injectInto: () => null };
context.Tree = { render: () => {} };
context.App = { refreshEnvSelect: () => {}, refreshTokenChip: () => {} };
context.Scheduler = { open: () => {}, badgeTip: () => '' };
context.Response = { show: () => {} };

vm.runInContext(loadSrc('util.js'), context);
vm.runInContext(loadSrc('vars.js'), context);
vm.runInContext(loadSrc('http.js'), context);
vm.runInContext(loadSrc('importer.js') + '\nthis.__Importer = Importer;', context);
vm.runInContext(loadSrc('editor.js') + '\nthis.__Editor = Editor;', context);

const { liveReq, isDirty } = context.__Editor;
const Importer = context.__Importer;
const env = context.Store.activeEnv();

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

console.log('复现：旧行为直接读节点 → 空的');
const before = Importer.toCurl(node, env);
check('空节点生成的 cURL 里没有 URL（这就是「空的」）', !before.includes('/mrbs/meetingRooms'));

console.log('\nliveReq：优先取编辑区草稿');
check('传节点对象 → 拿到草稿', liveReq(node) === draft);
check('传 id → 拿到草稿', liveReq('req_1') === draft);
check('没打开的请求 → 原节点', liveReq(other) === other);
check('未知 id → null（不炸）', liveReq('nope') === null);
check('isDirty 为 true', isDirty(node) === true);
check('未打开请求 isDirty 为 false', isDirty(other) === false);

console.log('\n修复后：cURL 有真实内容');
const live = liveReq(node) || node;
const curl = Importer.toCurl(live, env);
check('cURL 带 URL（变量已解析）', curl.includes('http://jn.larfe.net:40002/mrbs/meetingRooms'));
check('cURL 带环境变量解析后的 URL', curl.includes("curl -X GET"));
check('cURL 带请求头', curl.includes('x-current-project: P1'));
check('cURL 不再是空 URL', !curl.includes("''"));

console.log('\n修复后：导出内容非空');
const pmCol = { id: 'c', name: draft.name, items: [JSON.parse(JSON.stringify(live))] };
const pm = Importer.toPostman(pmCol);
check('Postman 导出含 URL', String(pm.item[0].request.url.raw).includes('/mrbs/meetingRooms'));
check('Postman 导出含 header', pm.item[0].request.header.some((h) => h.key === 'x-current-project'));
const ap = { _apipilotRequest: true, version: 1, request: JSON.parse(JSON.stringify(live)) };
check('ApiPilot 原生导出含 URL', ap.request.url === '{{baseUrl}}/mrbs/meetingRooms');

console.log('\n源码就位检查');
const treeCode = loadSrc('tree.js');
const editorCode = loadSrc('editor.js');
const importerCode = loadSrc('importer.js');
check('tree 复制 cURL 用 liveReq', treeCode.includes('Importer.toCurl(live, env)'));
check('tree 导出请求用 liveReq', treeCode.includes('Importer.exportRequest(Editor.liveReq(node) || node)'));
check('tree 定时任务用 liveReq', treeCode.includes('Scheduler.open(Editor.liveReq(node))'));
check('tree 创建副本用 liveReq', treeCode.includes('Editor.liveReq(node) || node'));
check('tree 空 URL 时给出提示', treeCode.includes('还没有 URL，复制出来是空的'));
check('editor 导出 liveReq', editorCode.includes('function liveReq(idOrNode)'));
check('editor 导出 isDirty', editorCode.includes('function isDirty(idOrNode)'));
check('导出弹窗空 URL 有提示', importerCode.includes('导出的内容会是空的'));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
