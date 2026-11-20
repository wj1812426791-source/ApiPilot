/* 取消发送：卡在「自动登录」阶段也必须能取消
   背景：登录请求以前不带 reqId，主进程没有句柄 → 点取消无效，按钮永远停在「取消中…」。 */
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

let calls = [];
let loginBehavior = 'ok';

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  parseInt, setTimeout, clearTimeout, document: {}, navigator: {},
  window: {
    api: {
      send: async (cfg) => {
        calls.push(cfg);
        if (String(cfg.url).includes('/login')) {
          if (loginBehavior === 'canceled') return { error: '请求已取消', canceled: true, timeMs: 5 };
          if (loginBehavior === 'fail') return { error: '连接被拒绝' };
          return {
            status: 200, statusText: 'OK', headers: {},
            bodyText: '{"data":{"token":"T-1"}}', timeMs: 10
          };
        }
        return { status: 200, statusText: 'OK', headers: {}, bodyText: '{"ok":1}', timeMs: 20 };
      }
    }
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U=U;', ctx); ctx.U = ctx.__U;
vm.runInContext(loadSrc('store.js') + '\nthis.__Store=Store;', ctx); ctx.Store = ctx.__Store;
vm.runInContext(loadSrc('vars.js') + '\nthis.__Vars=Vars;', ctx); ctx.Vars = ctx.__Vars;
ctx.App = { refreshTokenChip() {} };
vm.runInContext(loadSrc('auth.js') + '\nthis.__Auth=Auth;', ctx); ctx.Auth = ctx.__Auth;
vm.runInContext(loadSrc('http.js') + '\nthis.__Http=Http;', ctx);
const Store = ctx.Store;
const Auth = ctx.__Auth;
const Http = ctx.__Http;

const mkEnv = () => {
  const env = Store.newEnvironment('测试环境');
  env.variables = [
    { key: 'baseUrl', value: 'http://x.y', enabled: true },
    { key: 'account', value: 'u', enabled: true },
    { key: 'password', value: 'p', enabled: true }
  ];
  env.login = Object.assign(Store.DEFAULT_LOGIN(), {
    enabled: true, url: '{{baseUrl}}/login',
    bodyRaw: '{"account":"{{account}}","password":"{{password}}"}',
    tokenPath: 'data.token', ttlSeconds: 3600
  });
  env.token = { value: '', acquiredAt: 0, expiresAt: 0, raw: '' };
  env.headers = [];
  return env;
};
const mkReq = () => {
  const r = Store.newRequest('业务请求');
  r.url = '{{baseUrl}}/api/list';
  r.params = [{ key: 'page', value: '1', enabled: true }];
  return r;
};

(async () => {
  console.log('\n[1] 登录请求带同一个 reqId');
  let env = mkEnv();
  Store.state.environments = [env];
  Store.state.activeEnvId = env.id;
  calls = []; loginBehavior = 'ok';
  await Http.send(mkReq(), { reqId: 'req-abc' });
  check('登录请求发出了', calls.length >= 1 && String(calls[0].url).includes('/login'));
  check('登录请求带 reqId', calls[0].reqId === 'req-abc', String(calls[0].reqId));
  check('业务请求也带同一个 reqId', calls[1] && calls[1].reqId === 'req-abc', calls[1] && String(calls[1].reqId));

  console.log('\n[2] 登录阶段被取消 → 整个请求中止');
  env = mkEnv();
  Store.state.environments = [env];
  Store.state.activeEnvId = env.id;
  calls = []; loginBehavior = 'canceled';
  const out = await Http.send(mkReq(), { reqId: 'req-cancel' });
  check('返回 res.canceled = true', !!(out.res && out.res.canceled === true), JSON.stringify(out.res));
  check('错误信息为「请求已取消」', out.res && out.res.error === '请求已取消', out.res && out.res.error);
  check('没有继续发业务请求（只调用了登录）', calls.length === 1, 'calls=' + calls.length);
  check('没有写入 token', !env.token.value, env.token.value);
  check('不会误报登录失败（loginError 为空）', out.meta && !out.meta.loginError, out.meta && out.meta.loginError);

  console.log('\n[3] ensureToken / login 透传 reqId');
  env = mkEnv();
  Store.state.environments = [env];
  calls = []; loginBehavior = 'ok';
  await Auth.ensureToken(env, { reqId: 'r-ensure' });
  check('ensureToken 把 reqId 传到登录请求', calls[0] && calls[0].reqId === 'r-ensure', calls[0] && String(calls[0].reqId));

  env = mkEnv();
  calls = []; loginBehavior = 'canceled';
  const lr = await Auth.login(env, { reqId: 'r-login' });
  check('login 返回 canceled 标记', lr.ok === false && lr.canceled === true, JSON.stringify(lr).slice(0, 120));

  console.log('\n[4] 普通登录失败仍然照旧（不误判成取消）');
  env = mkEnv();
  Store.state.environments = [env];
  calls = []; loginBehavior = 'fail';
  const lr2 = await Auth.login(env);
  check('失败时 canceled 不为 true', lr2.ok === false && !lr2.canceled, JSON.stringify(lr2).slice(0, 120));

  console.log('\n[5] 源码接线');
  const authSrc = loadSrc('auth.js');
  const httpSrc = loadSrc('http.js');
  const editorSrc = loadSrc('editor.js');
  check('登录请求带 reqId', /reqId: opts\.reqId/.test(authSrc));
  check('登录失败结果带 canceled', /canceled: !!res\.canceled/.test(authSrc));
  check('ensureToken 接收 reqId', /async function ensureToken\(env, \{ force = false, reqId \} = \{\}\)/.test(authSrc));
  check('Http.send 两处登录都传 reqId',
    (httpSrc.match(/Auth\.(ensureToken|login)\(activeEnv, \{ reqId \}\)/g) || []).length === 2);
  check('登录被取消时提前 return（不再发业务请求）',
    (httpSrc.match(/if \(lr && lr\.canceled\)/g) || []).length === 2);
  check('取消失败时不卡在「取消中…」',
    /if \(!r \|\| !r\.ok\)[\s\S]{0,200}canceling = false/.test(editorSrc));

  console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})();
