/* =========================================================================
   selftest.js - 端到端自检（只在 --selftest 启动时运行）
   验证：变量解析、登录取 Token、Token 自动注入、过期自动重登、
        401 自动重试、业务码 401 重试、Postman 导入导出、cURL 解析
   ========================================================================= */
const SelfTest = (() => {

  const BASE = 'http://localhost:8899';
  const results = [];

  function check(name, cond, detail) {
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  }

  function makeEnv() {
    const env = Store.newEnvironment('自检环境');
    env.variables = [
      { key: 'baseUrl', value: BASE, desc: '', enabled: true },
      { key: 'username', value: 'admin', desc: '', enabled: true },
      { key: 'password', value: '123456', desc: '', enabled: true }
    ];
    env.login = Object.assign(Store.DEFAULT_LOGIN(), {
      enabled: true,
      method: 'POST',
      url: '{{baseUrl}}/login',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      bodyMode: 'raw',
      bodyRaw: '{"username":"{{username}}","password":"{{password}}"}',
      tokenPath: 'data.token',
      injectTo: 'header',
      headerName: 'Authorization',
      prefix: 'Bearer ',
      ttlSeconds: 60,
      expirePath: 'data.expires_in',
      expireUnit: 'seconds',
      autoRelogin: true,
      reloginStatus: '401,403'
    });
    Store.state.environments = [env];
    Store.state.activeEnvId = env.id;
    return env;
  }

  function makeReq(url, method) {
    const r = Store.newRequest('自检请求');
    r.method = method || 'GET';
    r.url = url;
    return r;
  }

  async function run() {
    console.log('===== ApiPilot 自检开始 =====');
    const env = makeEnv();

    /* 1. 变量解析 */
    check('变量解析 {{baseUrl}}',
      Vars.resolve('{{baseUrl}}/api/user/list', env) === BASE + '/api/user/list',
      Vars.resolve('{{baseUrl}}/api/user/list', env));

    check('未定义变量能被检出',
      Vars.check('{{notExist}}/x', env).includes('notExist'));

    /* 2. JSON 路径 */
    check('路径提取 data.list[0].name',
      U.getByPath({ data: { list: [{ name: 'ok' }] } }, 'data.list[0].name') === 'ok');

    /* 3. 登录拿 Token */
    const lr = await Auth.login(env);
    check('调用登录接口拿到 Token', lr.ok && !!lr.token, lr.ok ? `token=${String(lr.token).slice(0, 22)}…` : lr.error);
    check('Token 提取路径正确', lr.ok && lr.from === 'data.token', lr.from);
    check('过期时间按 expires_in 计算',
      lr.ok && lr.expiresAt > Date.now() + 50000 && lr.expiresAt < Date.now() + 70000,
      lr.expiresAt ? new Date(lr.expiresAt).toLocaleTimeString() : '-');
    check('Token 状态为有效', Auth.status(env).state === 'valid', Auth.status(env).text);

    /* 4. 带 Token 发业务请求 */
    const req1 = makeReq('{{baseUrl}}/api/user/list');
    req1.params = [{ key: 'pageNum', value: '1', enabled: true }, { key: 'pageSize', value: '2', enabled: true }];
    const r1 = await Http.send(req1);
    check('业务请求返回 200', r1.res.status === 200, `status=${r1.res.status} ${r1.res.error || ''}`);
    check('Authorization 头被自动注入',
      !!(r1.res.requestPreview && r1.res.requestPreview.headers &&
        String(r1.res.requestPreview.headers.Authorization || '').startsWith('Bearer mock_')),
      r1.res.requestPreview ? String(r1.res.requestPreview.headers.Authorization || '').slice(0, 30) : '-');
    check('Query 参数正确拼接',
      (r1.res.finalUrl || '').includes('pageNum=1') && (r1.res.finalUrl || '').includes('pageSize=2'),
      r1.res.finalUrl);
    const body1 = U.tryParseJSON(r1.res.bodyText || '');
    check('响应 JSON 可解析且有数据', body1.ok && body1.value.data && body1.value.data.list.length === 2);

    /* 5. 本地判定过期 → 发请求前自动重登 */
    const oldToken = env.token.value;
    env.token.expiresAt = Date.now() - 1000;
    check('篡改后状态判定为已过期', Auth.status(env).state === 'expired', Auth.status(env).text);
    const r2 = await Http.send(makeReq('{{baseUrl}}/api/user/list'));
    check('过期后自动重新登录', r2.meta.reloggedIn === true);
    check('重登后请求成功', r2.res.status === 200, `status=${r2.res.status}`);
    check('拿到的是新 Token', env.token.value !== oldToken);

    /* 6. 服务端返回 401 → 自动重登并重发 */
    env.token.value = 'invalid_token_for_test';
    env.token.expiresAt = Date.now() + 600000; // 本地以为还有效
    const r3 = await Http.send(makeReq('{{baseUrl}}/api/user/list'));
    check('遇到 401 自动重登', r3.meta.reloggedIn === true);
    check('重登后自动重发原请求', r3.res.retriedAfterRelogin === true);
    check('重发后返回 200', r3.res.status === 200, `status=${r3.res.status}`);

    /* 7. 业务码 401（HTTP 恒 200）*/
    env.login.reloginBodyMatch = 'code=401';
    env.token.value = 'invalid_token_again';
    env.token.expiresAt = Date.now() + 600000;
    const r4 = await Http.send(makeReq('{{baseUrl}}/api/soft/profile'));
    const body4 = U.tryParseJSON(r4.res.bodyText || '');
    check('body.code=401 也能触发重登', r4.meta.reloggedIn === true);
    check('重发后业务码为 200', body4.ok && body4.value.code === 200,
      body4.ok ? 'code=' + body4.value.code : r4.res.bodyText);

    /* 8. 不同注入方式：query */
    env.login.injectTo = 'query';
    env.login.queryName = 'access_token';
    await Auth.login(env);
    const built = Http.build(makeReq('{{baseUrl}}/api/echo'), env);
    check('Token 可注入到 URL 参数', built.config.url.includes('access_token=mock_'), built.config.url.slice(0, 80));
    env.login.injectTo = 'header';

    /* 9. 请求体与 Content-Type */
    const reqPost = makeReq('{{baseUrl}}/api/echo', 'POST');
    reqPost.body = { mode: 'raw', raw: '{"a":{{$timestamp}},"u":"{{username}}"}', rawType: 'application/json', formdata: [], urlencoded: [] };
    const r5 = await Http.send(reqPost);
    const echo = U.tryParseJSON(r5.res.bodyText || '');
    check('POST raw JSON 正确送达',
      echo.ok && echo.value.body.includes('"u":"admin"') && /"a":\d{10}/.test(echo.value.body),
      echo.ok ? echo.value.body : '-');
    check('Content-Type 自动补齐',
      echo.ok && String(echo.value.headers['content-type'] || '').includes('application/json'));

    /* 10. urlencoded */
    const reqForm = makeReq('{{baseUrl}}/api/echo', 'POST');
    reqForm.body = { mode: 'urlencoded', raw: '', rawType: '', formdata: [], urlencoded: [{ key: 'k1', value: 'v1', enabled: true }, { key: 'k2', value: '中文', enabled: true }] };
    const r6 = await Http.send(reqForm);
    const echo2 = U.tryParseJSON(r6.res.bodyText || '');
    check('urlencoded 请求体正确',
      echo2.ok && echo2.value.body === 'k1=v1&k2=' + encodeURIComponent('中文'),
      echo2.ok ? echo2.value.body : '-');

    /* 11. 错误处理 */
    const r7 = await Http.send(makeReq('http://127.0.0.1:59999/nope'));
    check('连接失败有明确错误信息', !!r7.res.error, r7.res.error);

    const r8 = await Http.send(makeReq('{{baseUrl}}/api/status?code=500'));
    check('500 响应正常展示', r8.res.status === 500, `status=${r8.res.status}`);

    /* 11b. URL 内联 query 与 Params 表合并（同名以 Params 为准） */
    const reqMix = makeReq('{{baseUrl}}/api/echo?code=1&keep=yes');
    reqMix.params = [{ key: 'code', value: '2', enabled: true }, { key: 'extra', value: 'e', enabled: true }];
    const builtMix = Http.build(reqMix, env);
    check('URL 自带参数不会丢失', builtMix.config.url.includes('keep=yes'), builtMix.config.url);
    check('同名参数以 Params 表为准',
      builtMix.config.url.includes('code=2') && !builtMix.config.url.includes('code=1'), builtMix.config.url);
    check('Params 表新增参数正常拼接', builtMix.config.url.includes('extra=e'), builtMix.config.url);

    /* 12. cURL 解析 */
    const curl = Importer.fromCurl(
      `curl -X POST 'http://api.test/v1/login?a=1' -H 'Content-Type: application/json' -H 'X-Tag: t' -d '{"u":"admin"}' -k`);
    check('cURL 解析出方法与 URL', curl && curl.method === 'POST' && curl.url === 'http://api.test/v1/login');
    check('cURL 解析出 Header', curl && curl.headers.some((h) => h.key === 'X-Tag' && h.value === 't'));
    check('cURL 解析出 Body', curl && curl.body.mode === 'raw' && curl.body.raw === '{"u":"admin"}');
    check('cURL 解析出 Query', curl && curl.params.length === 1 && curl.params[0].key === 'a');

    /* 13. Postman 导入导出往返 */
    const pm = {
      info: { name: '往返测试', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: '目录A',
        item: [{
          name: '查询',
          request: {
            method: 'POST',
            header: [{ key: 'H1', value: 'V1' }],
            url: { raw: 'http://x.com/a?q=1', query: [{ key: 'q', value: '1' }] },
            body: { mode: 'raw', raw: '{"z":1}', options: { raw: { language: 'json' } } }
          }
        }]
      }]
    };
    const col = Importer.fromPostman(pm);
    check('Postman 导入：集合名', col.name === '往返测试');
    check('Postman 导入：目录结构', col.items[0].type === 'folder' && col.items[0].items[0].type === 'request');
    const impReq = col.items[0].items[0];
    check('Postman 导入：方法/URL/Header/Body',
      impReq.method === 'POST' && impReq.url === 'http://x.com/a' &&
      impReq.headers[0].key === 'H1' && impReq.body.raw === '{"z":1}');
    const back = Importer.toPostman(col);
    check('Postman 导出往返一致',
      back.item[0].item[0].request.method === 'POST' &&
      back.item[0].item[0].request.url.raw === 'http://x.com/a?q=1',
      back.item[0].item[0].request.url.raw);

    /* 13b. 环境导入/导出 */
    const sampleEnv = {
      _apipilotEnv: true,
      name: '导入导出测试环境',
      variables: [{ key: 'baseUrl', value: 'http://example.com', desc: '', enabled: true }],
      login: { enabled: true, url: '{{baseUrl}}/login', tokenPath: 'data.token' }
    };
    const prevOpen = window.api.openDialog;
    const stubOpen = (obj) => { window.api.openDialog = async () => ({ ok: true, content: JSON.stringify(obj) }); };
    try {
      stubOpen(sampleEnv);
      const r1 = await Importer.importEnvironmentsFromFile();
      check('环境导入：_apipilotEnv 返回 1 个', r1 && r1.count === 1, r1 ? r1.names.join(',') : 'null');
      const imp1 = Store.state.environments.find((e) => e.name === '导入导出测试环境');
      check('环境导入：已加入环境列表', !!imp1);
      check('环境导入：生成新的唯一 id', imp1 && typeof imp1.id === 'string' && imp1.id.length > 4, imp1 && imp1.id);
      check('环境导入：变量正确导入', imp1 && imp1.variables.length === 1 && imp1.variables[0].value === 'http://example.com');
      check('环境导入：Token 被剥离（不含运行时凭据）', imp1 && imp1.token && imp1.token.value === '');
      check('环境导入：login 默认值兜底', imp1 && imp1.login && imp1.login.injectTo === 'header' && imp1.login.tokenPath === 'data.token');

      // 裸对象
      stubOpen({ name: '裸对象环境', variables: [] });
      const r2 = await Importer.importEnvironmentsFromFile();
      check('环境导入：裸对象可被识别', r2 && r2.count === 1, r2 ? r2.names.join(',') : 'null');

      // 裸数组（多个环境）
      stubOpen([
        { name: '数组环境A', variables: [{ key: 'k', value: 'v' }] },
        { name: '数组环境B', login: { enabled: true } }
      ]);
      const r3 = await Importer.importEnvironmentsFromFile();
      check('环境导入：裸数组批量导入 2 个', r3 && r3.count === 2, r3 ? r3.names.join(',') : 'null');

      // 完整 _apipilot 备份包
      stubOpen({ _apipilot: true, environments: [{ name: '包环境', variables: [] }], collections: [] });
      const r4 = await Importer.importEnvironmentsFromFile();
      check('环境导入：_apipilot 包内的环境可被识别', r4 && r4.count === 1, r4 ? r4.names.join(',') : 'null');

      // 非法内容
      stubOpen({ foo: 'bar' });
      const r5 = await Importer.importEnvironmentsFromFile();
      check('环境导入：非法内容被拒（返回 null）', r5 === null, String(r5));
    } finally {
      window.api.openDialog = prevOpen;
    }

    /* 14. 持久化 */
    Store.save();
    await new Promise((r) => setTimeout(r, 700));
    const loaded = await window.api.loadStore();
    check('数据成功落盘', loaded.ok && loaded.data && loaded.data.environments.length === 1);
    check('Token 一并持久化', loaded.ok && !!loaded.data.environments[0].token.value);

    /* 15. 界面渲染（确认 GUI 真的画出来了，不是靠"没报错"推断） */
    const must = ['.titlebar', '#sidebar', '#tree', '#tabs', '#urlInput',
      '#btnSend', '#reqTabs', '#resArea', '#envSelect', '#tokenChip'];
    const missing = must.filter((s) => !U.$(s));
    check('关键界面元素齐全', missing.length === 0, missing.join(' '));

    Store.state.collections = [Importer.fromPostman(pm)];
    Tree.render();
    const treeRows = U.$$('#tree .node-row');
    check('集合树渲染出节点', treeRows.length >= 3, `节点数=${treeRows.length}`);

    Editor.newTab(makeReq('{{baseUrl}}/api/echo?x=1', 'POST'));
    check('新建标签页并渲染', U.$$('#tabs .tab').length >= 1, `标签数=${U.$$('#tabs .tab').length}`);
    check('URL 写入地址栏', (U.$('#urlInput').value || '').includes('/api/echo'), U.$('#urlInput').value);

    App.refreshEnvSelect();
    check('环境下拉已填充', U.$('#envSelect').options.length >= 1, `选项数=${U.$('#envSelect').options.length}`);
    App.refreshTokenChip();
    const chipText = (U.$('#tokenChipText').textContent || '').trim();
    check('Token 状态芯片有内容', chipText.length > 0, chipText);

    const styled = getComputedStyle(U.$('.titlebar')).backgroundColor;
    check('样式表已生效', styled && styled !== 'rgba(0, 0, 0, 0)', styled);

    /* 16. 定时任务 */
    const schedReq = Store.newRequest('定时测试请求');
    Store.state.collections[0].items.push(schedReq);   // 挂到集合，模拟真实场景
    check('定时任务：无配置时 isActive 为 false', Scheduler.isActive(schedReq) === false);

    Scheduler.open(schedReq);
    check('定时任务：设置弹窗（小）已打开', !U.$('#modalRoot').hidden && !!U.$('#modalRoot .sp-config input'));
    const bgOf = (s) => getComputedStyle(U.$(s)).backgroundColor;
    check('定时任务：弹窗配置区背景不透明', bgOf('#modalRoot .sp-config') !== 'rgba(0, 0, 0, 0)', bgOf('#modalRoot .sp-config'));
    // 响应区「日志」页签
    const logTab = U.$('.res-tab[data-st="schedule"]');
    check('定时任务：响应区存在「日志」页签', !!logTab, logTab && logTab.textContent);
    const logPanel = U.$('.res-panel[data-sp="schedule"]');
    check('定时任务：日志页签面板存在', !!logPanel && !!logPanel.querySelector('#resScheduleLog'));
    check('定时任务：日志面板含清除按钮', !!U.$('#spClearLog'));
    Scheduler.close();

    schedReq.schedule = {
      enabled: true, intervalMin: 5, intervalMs: 300000, durationMs: Infinity,
      startedAt: Date.now(), nextRunAt: Date.now(), lastRunAt: 0, runCount: 0, running: false
    };
    check('定时任务：配置后 isActive 为 true', Scheduler.isActive(schedReq) === true);
    check('定时任务：徽标文案含「定时任务」', Scheduler.badgeTip(schedReq).includes('定时任务'),
      Scheduler.badgeTip(schedReq).replace(/\n/g, ' '));
    Scheduler.cancel(schedReq.id);
    check('定时任务：取消后 isActive 为 false', Scheduler.isActive(schedReq) === false);

    /* 汇总 */
    const failed = results.filter((r) => !r.pass);
    console.log(`===== 自检结束：${results.length - failed.length}/${results.length} 通过 =====`);
    for (const f of failed) console.log('  失败项: ' + f.name + '  ' + f.detail);

    window.api.selftestDone({
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed.map((f) => ({ name: f.name, detail: f.detail }))
    });
  }

  return { run };
})();
