/* Token 注入默认值测试
   需求：新建环境的 Token 注入默认值 —— 请求头名 `token`、前缀留空（`token: <值>`）。
   同时必须保证：老环境已保存的 headerName / prefix 不会被新默认值覆盖。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');

let storeData = null;

const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, Boolean, RegExp, Map, Set,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  setTimeout, clearTimeout,
  document: {}, navigator: {},
  window: {
    api: {
      loadStore: async () => (storeData ? { ok: true, data: storeData } : { ok: true, data: null }),
      saveStore: async () => ({ ok: true })
    }
  }
};
vm.createContext(context);

vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', context);
vm.runInContext(loadSrc('vars.js') + '\nthis.__Vars = Vars;', context);

/* store.js 需要 window.api / U；其余模块给它空壳，避免顶层引用报错 */
context.App = { refreshTokenChip: () => {}, refreshEnvSelect: () => {} };
context.Http = { build: () => ({ config: {}, injected: null, notes: [] }), send: async () => ({}) };
vm.runInContext(loadSrc('store.js') + '\nthis.__Store = Store;', context);
vm.runInContext(loadSrc('auth.js') + '\nthis.__Auth = Auth;', context);

const Store = context.__Store;
const Auth = context.__Auth;

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

(async () => {
  /* -------------------- 1. 新建环境默认值 -------------------- */
  console.log('\n[1] 新建环境的 Token 注入默认值');
  const d = Store.DEFAULT_LOGIN();
  check("DEFAULT_LOGIN.headerName === 'token'", d.headerName === 'token', d.headerName);
  check("DEFAULT_LOGIN.prefix === '' （默认为空）", d.prefix === '', JSON.stringify(d.prefix));

  const env = Store.newEnvironment('测试新建环境');
  check('newEnvironment 继承默认 headerName=token', env.login.headerName === 'token', env.login.headerName);
  check('newEnvironment 继承默认 prefix 为空', env.login.prefix === '', JSON.stringify(env.login.prefix));
  check('两者不一致才会出问题：login 与 DEFAULT_LOGIN 同步', env.login.headerName === d.headerName && env.login.prefix === d.prefix);

  /* -------------------- 2. 老数据不被覆盖 -------------------- */
  console.log('\n[2] 载入老数据：已保存的值必须原样保留');
  storeData = {
    collections: [],
    environments: [
      {
        id: 'env_old', name: '老环境（之前配过 Authorization）',
        variables: [], headers: [],
        login: { enabled: true, tokenPath: 'data.token', headerName: 'Authorization', prefix: 'Bearer ' },
        token: { value: 'OLD_TOKEN', acquiredAt: 1, expiresAt: 0, raw: '' }
      },
      {
        id: 'env_partial', name: '老环境（缺 headerName 字段）',
        variables: [], headers: [],
        login: { enabled: true, tokenPath: 'data.token' },
        token: { value: '', acquiredAt: 0, expiresAt: 0, raw: '' }
      }
    ],
    activeEnvId: 'env_old'
  };
  await Store.load();

  const old = Store.state.environments[0];
  check('老环境 headerName 仍是 Authorization', old.login.headerName === 'Authorization', old.login.headerName);
  check('老环境 prefix 仍是 "Bearer "', old.login.prefix === 'Bearer ', JSON.stringify(old.login.prefix));
  check('老环境其它字段照常补齐（tokenPath）', old.login.tokenPath === 'data.token');
  check('老环境 token 值未被清空', old.token.value === 'OLD_TOKEN', old.token.value);

  const partial = Store.state.environments[1];
  check('缺 headerName 的老环境兜底为 token', partial.login.headerName === 'token', partial.login.headerName);
  check('缺 prefix 的老环境兜底为空', partial.login.prefix === '', JSON.stringify(partial.login.prefix));

  /* -------------------- 3. 实际注入值 -------------------- */
  console.log('\n[3] 注入到请求头时的真实值');
  const mkEnv = (prefix, headerName) => ({
    name: 'E', token: { value: 'ABC123' },
    login: { injectTo: 'header', headerName, prefix }
  });

  let headers = {};
  let injected = Auth.injectInto(mkEnv('', 'token'), headers, { url: 'http://x/a' });
  check('前缀为空 → token: ABC123（原样，不带 Bearer）', headers.token === 'ABC123', headers.token);
  check('注入结果标注 header 名 token', injected && injected.name === 'token', injected && injected.name);

  headers = {};
  Auth.injectInto(mkEnv('Bearer ', 'Authorization'), headers, { url: 'http://x/a' });
  check('显式配了 Bearer 前缀时照旧拼接', headers.Authorization === 'Bearer ABC123', headers.Authorization);

  headers = {};
  Auth.injectInto(mkEnv('', 'token'), headers, { url: 'http://x/a' });
  check('前缀为空时不产生多余空格', headers.token === 'ABC123', JSON.stringify(headers.token));

  headers = { token: 'USER_SET' };
  const skip = Auth.injectInto(mkEnv('', 'token'), headers, { url: 'http://x/a' });
  check('请求自己写了同名头则尊重用户（不覆盖）', headers.token === 'USER_SET' && skip === null, headers.token);

  /* -------------------- 4. 源码兜底一致性 -------------------- */
  console.log('\n[4] 源码里不再残留 Authorization 兜底');
  const files = ['auth.js', 'editor.js', 'env.js', 'store.js'];
  for (const f of files) {
    const code = loadSrc(f);
    check(f + " 不含 || 'Authorization' 兜底", !/\|\|\s*'Authorization'/.test(code));
  }
  check("store.js 默认 headerName 为 token", /headerName:\s*'token'/.test(loadSrc('store.js')));
  check('store.js 默认 prefix 为空串', /prefix:\s*''/.test(loadSrc('store.js')));
  check('env.js 界面兜底为 token', loadSrc('env.js').includes("login.headerName || 'token'"));
  check("env.js 前缀 placeholder 不再伪装成默认值 'Bearer '",
    !loadSrc('env.js').includes("placeholder: 'Bearer '"));

  console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})();
