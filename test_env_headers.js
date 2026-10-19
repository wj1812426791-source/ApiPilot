/* 轻量 Node 测试：环境 Header（自动携带 + 与请求 Header 的优先级 + 登录接口也带） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

const sent = [];
const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, Boolean, RegExp, Map, Set,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  document: {}, navigator: {},
  window: {
    api: {
      send: async (cfg) => {
        sent.push(cfg);
        return { status: 200, statusText: 'OK', headers: {}, setCookie: [], bodyText: '{"data":{"token":"TK1"}}', timeMs: 5 };
      }
    }
  }
};
vm.createContext(context);

context.Store = {
  state: { globals: [], environments: [] },
  activeEnv: () => null,
  save: () => {},
  DEFAULT_LOGIN: () => ({}),
  DEFAULT_TOKEN: () => ({ value: '', acquiredAt: 0, expiresAt: 0, raw: '' })
};
context.App = { refreshTokenChip: () => {} };

vm.runInContext(loadSrc('util.js'), context);
vm.runInContext(loadSrc('vars.js') + '\nthis.__Vars = Vars;', context);
context.Auth = { injectInto: () => null };   // build() 只在 login.enabled 时调用
vm.runInContext(loadSrc('http.js') + '\nthis.__Http = Http;', context);
vm.runInContext(loadSrc('auth.js') + '\nthis.__Auth = Auth;', context);

const Http = context.__Http;
const Auth = context.__Auth;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

const mkReq = (headers) => ({
  url: '{{baseUrl}}/api/a', method: 'GET', headers: headers || [],
  params: [], pathVars: [], body: { mode: 'none' },
  auth: { type: 'inherit' }, settings: {}
});

const mkEnv = (headers, loginHeaders) => ({
  id: 'e1', name: '测试环境',
  variables: [{ key: 'baseUrl', value: 'http://x.y', enabled: true }],
  headers,
  login: { enabled: true, method: 'POST', url: '{{baseUrl}}/login', headers: loginHeaders || [], tokenPath: 'data.token', ttlSeconds: 0, injectTo: 'header' },
  token: { value: '', acquiredAt: 0, expiresAt: 0, raw: '' }
});

console.log('Http.build：环境 Header 自动携带');
const env = mkEnv([
  { key: 'x-current-project', value: 'P1', enabled: true },
  { key: 'X-Off', value: 'no', enabled: false },
  { key: 'X-Var', value: '{{baseUrl}}', enabled: true },
  { key: '', value: '空 key 忽略', enabled: true }
]);
const built1 = Http.build(mkReq([{ key: 'X-Req', value: 'r', enabled: true }]), env);
const h1 = built1.config.headers;
check('环境 Header 出现在请求头里', h1['x-current-project'] === 'P1');
check('禁用的环境 Header 不携带', h1['X-Off'] === undefined);
check('环境 Header 值支持 {{变量}}', h1['X-Var'] === 'http://x.y');
check('空 key 的环境 Header 被忽略', h1[''] === undefined);
check('请求自身的 Header 保留', h1['X-Req'] === 'r');
check('notes 提示来自环境自动携带', built1.notes.some((n) => n.includes('x-current-project') && n.includes('自动携带')));

console.log('\nHttp.build：请求 Header 覆盖同名环境 Header');
const built2 = Http.build(mkReq([{ key: 'x-current-project', value: 'OVERRIDE', enabled: true }]), env);
check('同名时以请求为准', built2.config.headers['x-current-project'] === 'OVERRIDE');
const built3 = Http.build(mkReq([]), { ...env, headers: undefined });
check('环境无 headers 字段不报错', built3.config.headers['x-current-project'] === undefined);

console.log('\nAuth.doLogin：登录请求也带环境 Header');
(async () => {
  sent.length = 0;
  const envLogin = mkEnv(
    [{ key: 'x-current-project', value: 'P2', enabled: true }, { key: 'x-env-only', value: 'E', enabled: true }],
    [{ key: 'Content-Type', value: 'application/json', enabled: true }]
  );
  await Auth.login(envLogin);
  const lh = sent[0] && sent[0].headers;
  check('登录请求带上环境 Header', !!lh && lh['x-current-project'] === 'P2');
  check('登录请求带上另一个环境 Header', !!lh && lh['x-env-only'] === 'E');
  check('登录自有 Header 保留', !!lh && lh['Content-Type'] === 'application/json');

  sent.length = 0;
  const envLogin2 = mkEnv(
    [{ key: 'x-current-project', value: 'P2', enabled: true }],
    [{ key: 'x-current-project', value: 'LOGIN-WINS', enabled: true }]
  );
  await Auth.login(envLogin2);
  check('登录自有 Header 覆盖同名环境 Header', sent[0].headers['x-current-project'] === 'LOGIN-WINS');

  console.log('\nHttp.build：Header 名大小写不敏感');
  const caseEnv = mkEnv([{ key: 'x-current-project', value: 'ENV', enabled: true }]);
  const builtC = Http.build(mkReq([{ key: 'X-Current-Project', value: 'REQ', enabled: true }]), caseEnv);
  const cKeys = Object.keys(builtC.config.headers).filter((k) => k.toLowerCase() === 'x-current-project');
  check('大小写不同也只保留一个头（不会重复发）', cKeys.length === 1, cKeys.join(','));
  check('…且以请求自己的值为准', builtC.config.headers[cKeys[0]] === 'REQ');
  check('…被请求覆盖后不再声称「环境自动携带」', !builtC.notes.some((n) => n.includes('x-current-project')));

  const builtD = Http.build(mkReq([]), caseEnv);
  const dKeys = Object.keys(builtD.config.headers).filter((k) => k.toLowerCase() === 'x-current-project');
  check('没被覆盖时仍只保留一个头（保持原大小写）',
    dKeys.length === 1 && builtD.config.headers[dKeys[0]] === 'ENV', dKeys.join(','));
  check('…并正常提示来自环境', builtD.notes.some((n) => n.includes('自动携带')));

  console.log('\n源码就位检查');
  const envCode = loadSrc('env.js');
  const storeCode = loadSrc('store.js');
  const httpCode = loadSrc('http.js');
  const authCode = loadSrc('auth.js');
  const editorCode = loadSrc('editor.js');
  const importerCode = loadSrc('importer.js');
  check('env.js 已移除「全局变量」区块', !envCode.includes('全局变量（所有环境共用）'));
  check('env.js 新增「环境 Header」区块', envCode.includes('环境 Header（该环境的所有请求自动携带'));
  check('store.js 新环境带 headers', storeCode.includes('headers: [],'));
  check('store.js 载入时迁移 headers', storeCode.includes('Array.isArray(e.headers) ? e.headers : []'));
  check('http.js 使用 env.headers', httpCode.includes('env.headers'));
  check('auth.js 登录合并 env.headers', authCode.includes('env.headers || []'));
  check('editor.js 预览区展示环境 Header', editorCode.includes('rows.push({ k, v: Vars.resolve(h.value'));
  check('importer.js 导出环境含 headers', importerCode.includes('headers: env.headers || []'));

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
