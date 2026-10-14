/* 「实际发出」预览：变量解析清单 + 发包前回调 + 快照归一化 单元测试 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

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
  console, Math, Date, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
  Array, Object, String, Number, RegExp, Map, Set, Promise,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  document: {
    createElement: mkEl, createTextNode: (t) => ({ text: t }),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, body: mkEl()
  },
  navigator: {}, window: { api: {} }
};
vm.createContext(ctx);
const load = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

vm.runInContext(load('src/js/util.js') + '\nthis.__u = U;', ctx);
vm.runInContext(load('src/js/store.js') + '\nthis.__store = Store;', ctx);
vm.runInContext(load('src/js/vars.js') + '\nthis.__vars = Vars;', ctx);
const U = ctx.__u, Store = ctx.__store, Vars = ctx.__vars;
ctx.U = U; ctx.Store = Store; ctx.Vars = Vars;

let sentCount = 0;
let lastSentConfig = null;
let sendDelay = 0;

ctx.Auth = {
  isValid: () => true,
  injectInto: () => null,
  shouldRelogin: () => false,
  ensureToken: async () => ({ ok: true, cached: true }),
  login: async () => ({ ok: true })
};
ctx.App = { refreshTokenChip() { } };
ctx.UI = { toast() { } };
ctx.Editor = { current: () => null };
ctx.window.api.send = async (cfg) => {
  sentCount++;
  lastSentConfig = cfg;
  if (sendDelay) await new Promise((r) => setTimeout(r, sendDelay));
  return { status: 200, headers: {}, bodyText: '{}', timeMs: 5, requestPreview: { method: cfg.method, url: cfg.url, headers: { Host: 'h', ...cfg.headers } } };
};

vm.runInContext(load('src/js/http.js') + '\nthis.__http = Http;', ctx);
vm.runInContext(load('src/js/response.js') + '\nthis.__resp = Response;', ctx);
const Http = ctx.__http, Response = ctx.__resp;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* ------------------------------ 环境与请求 ------------------------------ */
function makeEnv() {
  const env = Store.newEnvironment('测试环境');
  env.variables = [
    { key: 'baseUrl', value: 'http://192.168.2.78:62011', desc: '', enabled: true },
    { key: 'pid', value: 'P-001', desc: '', enabled: true }
  ];
  env.headers = [{ key: 'x-env-auto', value: 'EA', desc: '', enabled: true }];
  env.login.enabled = false;
  Store.state.environments = [env];
  Store.state.globals = [];
  Store.state.activeEnvId = env.id;
  return env;
}

function makeReq() {
  return {
    id: 'req_1', type: 'request', name: '取列表', method: 'POST',
    url: '{{baseUrl}}/api/list?pid={{pid}}&t={{$timestamp}}&bad={{nope}}',
    params: [{ key: 'page', value: '{{pid}}', enabled: true }],
    pathVars: [], headers: [{ key: 'x-current-project', value: '{{pid}}', enabled: true }],
    body: { mode: 'raw', raw: '{"pid":"{{pid}}"}', rawType: 'application/json', formdata: [], urlencoded: [] },
    auth: { type: 'none' },
    settings: {}
  };
}

/* ------------------------------ 1. build 收集变量 ------------------------------ */
console.log('\n[1] build 收集变量解析清单');
const env = makeEnv();
const req = makeReq();
const built = Http.build(req, env);

check('URL 已用环境变量解析', built.config.url.startsWith('http://192.168.2.78:62011/api/list'));
check('URL 里的 {{pid}} 已解析', built.config.url.includes('pid=P-001'));
check('环境 Header 已带上', built.config.headers['x-env-auto'] === 'EA');
check('请求自己的 Header 也解析了变量', built.config.headers['x-current-project'] === 'P-001');
check('body 里的变量已解析', built.config.body.text === '{"pid":"P-001"}');

const names = built.vars.map((v) => v.name);
check('变量清单含 baseUrl', names.includes('baseUrl'));
check('变量清单含 pid', names.includes('pid'));
check('变量清单含动态变量 $timestamp', names.includes('$timestamp'));
check('变量清单含未定义的 nope', names.includes('nope'));
check('同名变量只记一条（pid 出现多次）', names.filter((n) => n === 'pid').length === 1);

const byName = (n) => built.vars.find((v) => v.name === n);
check('baseUrl 记下了解析后的值', byName('baseUrl').value === 'http://192.168.2.78:62011');
check('baseUrl 归类为「变量」', byName('baseUrl').scope === '变量');
check('$timestamp 归类为「动态」', byName('$timestamp').scope === '动态');
check('$timestamp 拿到真实值', /^\d{10}$/.test(byName('$timestamp').value));
check('nope 值为 null', byName('nope').value === null);
check('nope 归类为「未定义」', byName('nope').scope === '未定义');
check('missing 列表含 nope', built.missing.includes('nope'));
check('missing 不含已解析的 baseUrl', !built.missing.includes('baseUrl'));

/* ------------------------------ 2. onBuilt 在发包前触发 ------------------------------ */
console.log('\n[2] onBuilt 回调在真正发包之前触发');
let builtSnap = null;
let builtAt = 0;
let sentAt = 0;
sentCount = 0;

ctx.window.api.send = async (cfg) => {
  sentAt = Date.now();
  sentCount++;
  return { status: 200, headers: {}, bodyText: '{}', requestPreview: { method: cfg.method, url: cfg.url, headers: cfg.headers } };
};

(async () => {
  const r = await Http.send(makeReq(), {
    env,
    onBuilt: (b) => { builtSnap = b; builtAt = Date.now(); }
  });

  check('onBuilt 被调用', !!builtSnap);
  check('onBuilt 先于发包（时间顺序正确）', builtAt <= sentAt);
  check('onBuilt 拿到的 URL 已解析', builtSnap.config.url.includes('192.168.2.78:62011'));
  check('onBuilt 拿到的 missing 里有 nope', builtSnap.missing.includes('nope'));
  check('send 返回值也带回 vars/missing', r.vars && r.missing && r.missing.includes('nope'));
  check('请求正常发出', sentCount === 1 && r.res.status === 200);

  /* ------------------------------ 3. 401 重登后重发：onBuilt 再来一次 ------------------------------ */
  console.log('\n[3] 401 重登重发时 onBuilt 会再次触发（拿到重发的新快照）');
  let builtTimes = 0;
  let lastBuiltUrl = '';
  sentCount = 0;
  let first = true;
  env.login.enabled = true;                 // 继承式认证 + 开启登录，才会走自动重登
  const req2 = makeReq();
  req2.auth = { type: 'inherit' };
  ctx.Auth = {
    isValid: () => true,
    injectInto: () => ({ where: 'header', name: 'Authorization' }),
    shouldRelogin: () => first,
    ensureToken: async () => ({ ok: true, cached: true }),
    login: async () => { first = false; return { ok: true }; }
  };
  ctx.window.api.send = async (cfg) => {
    sentCount++;
    if (sentCount === 1) return { status: 401, headers: {}, bodyText: '', requestPreview: { headers: cfg.headers } };
    return { status: 200, headers: {}, bodyText: '{}', requestPreview: { headers: cfg.headers } };
  };
  const r3 = await Http.send(req2, {
    env,
    onBuilt: (b) => { builtTimes++; lastBuiltUrl = b.config.url; }
  });
  check('重登重发时 onBuilt 触发了 2 次', builtTimes === 2);
  check('重发确实发生了（共 2 次发包）', sentCount === 2);
  check('重发后返回 200', r3.res.status === 200);
  check('onBuilt 拿到的仍是解析后的完整 URL', lastBuiltUrl.includes('/api/list'));

  /* ------------------------------ 4. Response 快照归一化 ------------------------------ */
  console.log('\n[4] Response.normalizeSent / bodyPreviewText');
  const snap = Response.normalizeSent({
    config: { method: 'put', url: 'http://a/b', headers: { A: '1' }, body: { mode: 'raw', text: 'x' } },
    notes: ['A: 由环境「x」自动携带'], injected: { where: 'header', name: 'Authorization' },
    vars: [{ name: 'k', value: 'v', scope: '变量' }], missing: ['zz']
  });
  check('method 原样带出', snap.method === 'put');
  check('url 保留', snap.url === 'http://a/b');
  check('headers 保留', snap.headers.A === '1');
  check('missing 保留', snap.missing.length === 1);
  check('injected 保留', snap.injected.name === 'Authorization');
  check('有 at 时间戳', typeof snap.at === 'number' && snap.at > 0);
  check('normalizeSent(null) 返回 null', Response.normalizeSent(null) === null);

  check('raw body 预览', Response.bodyPreviewText({ mode: 'raw', text: '{"a":1}' }) === '{"a":1}');
  check('urlencoded body 预览', Response.bodyPreviewText({ mode: 'urlencoded', items: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }] }) === 'a=1&b=2');
  check('formdata body 预览按行', Response.bodyPreviewText({ mode: 'formdata', items: [{ key: 'a', value: '1' }] }) === 'a=1');
  check('none body 预览为空', Response.bodyPreviewText({ mode: 'none' }) === '');
  check('body 缺失时不报错', Response.bodyPreviewText(null) === '');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
