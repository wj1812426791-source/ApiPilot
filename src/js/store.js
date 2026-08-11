/* =========================================================================
   store.js - 全局状态与持久化
   ========================================================================= */
const Store = (() => {

  const DEFAULT_LOGIN = () => ({
    enabled: false,
    method: 'POST',
    url: '{{baseUrl}}/login',
    headers: [{ key: 'Content-Type', value: 'application/json', desc: '', enabled: true }],
    bodyMode: 'raw',
    bodyRaw: '{\n  "username": "admin",\n  "password": "123456"\n}',
    bodyItems: [],
    tokenPath: 'data.token',
    injectTo: 'header',
    headerName: 'Authorization',
    prefix: 'Bearer ',
    queryName: 'token',
    ttlSeconds: 7200,
    expirePath: '',
    expireUnit: 'seconds',
    autoRelogin: true,
    reloginStatus: '401,403',
    reloginBodyMatch: '',
    ignoreSSL: true,
    useCookieJar: true
  });

  const DEFAULT_TOKEN = () => ({ value: '', acquiredAt: 0, expiresAt: 0, raw: '' });

  function newEnvironment(name = '新环境') {
    return {
      id: U.uid('env'),
      name,
      variables: [
        { key: 'baseUrl', value: 'http://localhost:8080', desc: '服务地址', enabled: true }
      ],
      login: DEFAULT_LOGIN(),
      token: DEFAULT_TOKEN()
    };
  }

  function newRequest(name = '新建请求') {
    return {
      id: U.uid('req'),
      type: 'request',
      name,
      method: 'GET',
      url: '',
      params: [],
      pathVars: [],
      headers: [],
      body: { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] },
      auth: { type: 'inherit', bearer: '', username: '', password: '', apiKey: '', apiValue: '', apiIn: 'header' },
      settings: { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 }
    };
  }

  function newFolder(name = '新建文件夹') {
    return { id: U.uid('fld'), type: 'folder', name, items: [], expanded: true };
  }

  function newCollection(name = '新建集合') {
    return { id: U.uid('col'), type: 'collection', name, items: [], expanded: true, description: '' };
  }

  function newFlow(name = '新建测试流程') {
    return { id: U.uid('flow'), type: 'flow', name, steps: [] };
  }

  function newFlowStep(seed) {
    const step = {
      id: U.uid('step'),
      name: seed && seed.name ? seed.name : '未命名步骤',
      method: seed && seed.method ? seed.method : 'GET',
      url: seed && seed.url ? seed.url : '',
      params: U.clone(seed && seed.params) || [],
      pathVars: U.clone(seed && seed.pathVars) || [],
      headers: U.clone(seed && seed.headers) || [],
      body: U.clone(seed && seed.body) || { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] },
      auth: U.clone(seed && seed.auth) || { type: 'inherit', bearer: '', username: '', password: '', apiKey: '', apiValue: '', apiIn: 'header' },
      settings: U.clone(seed && seed.settings) || { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 }
    };
    return step;
  }

  const state = {
    collections: [],
    environments: [],
    globals: [],
    flows: [],
    activeEnvId: null,
    history: [],
    tabs: [],
    activeTabId: null,
    ui: { sidebarWidth: 264, resHeight: 42, sideTab: 'collections' },
    loaded: false
  };

  let saveTimer = null;
  let saveInFlight = false;

  function serialize() {
    return {
      version: 1,
      collections: state.collections,
      environments: state.environments,
      globals: state.globals,
      flows: state.flows,
      activeEnvId: state.activeEnvId,
      history: state.history.slice(0, 200),
      ui: state.ui,
      openTabs: state.tabs.map((t) => ({
        id: t.id, refId: t.refId, flowId: t.flowId, draft: t.draft, dirty: t.dirty
      })),
      activeTabId: state.activeTabId
    };
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (saveInFlight) { save(); return; }
      saveInFlight = true;
      try {
        const res = await window.api.saveStore(serialize());
        if (!res.ok) console.error('保存失败:', res.error);
      } catch (e) {
        console.error('保存异常:', e);
      } finally {
        saveInFlight = false;
      }
    }, 400);
  }

  async function load() {
    const res = await window.api.loadStore();
    const data = res && res.ok ? res.data : null;

    if (data) {
      state.collections = data.collections || [];
      state.environments = (data.environments || []).map((e) => ({
        ...e,
        login: { ...DEFAULT_LOGIN(), ...(e.login || {}) },
        token: { ...DEFAULT_TOKEN(), ...(e.token || {}) }
      }));
      state.globals = data.globals || [];
      state.flows = data.flows || [];
      state.activeEnvId = data.activeEnvId || null;
      state.history = data.history || [];
      state.ui = { ...state.ui, ...(data.ui || {}) };
      state.tabs = (data.openTabs || []).map((t) => ({
        id: t.id || U.uid('tab'),
        refId: t.refId || null,
        flowId: t.flowId || null,
        draft: t.draft,
        dirty: !!t.dirty
      }));
      state.activeTabId = data.activeTabId || (state.tabs[0] ? state.tabs[0].id : null);
    } else {
      seedDemo();
    }

    if (!state.environments.length) {
      const env = newEnvironment('本地开发');
      state.environments.push(env);
      state.activeEnvId = env.id;
    }
    if (!state.activeEnvId || !state.environments.some((e) => e.id === state.activeEnvId)) {
      state.activeEnvId = state.environments[0].id;
    }
    state.loaded = true;
  }

  function seedDemo() {
    const env = newEnvironment('本地开发');
    env.variables = [
      { key: 'baseUrl', value: 'http://localhost:8080', desc: '服务地址', enabled: true },
      { key: 'username', value: 'admin', desc: '登录账号', enabled: true },
      { key: 'password', value: '123456', desc: '登录密码', enabled: true }
    ];
    env.login = {
      ...DEFAULT_LOGIN(),
      enabled: false,
      url: '{{baseUrl}}/login',
      bodyRaw: '{\n  "username": "{{username}}",\n  "password": "{{password}}"\n}'
    };
    state.environments = [env];
    state.activeEnvId = env.id;

    const col = newCollection('示例集合');
    const req = newRequest('获取用户列表');
    req.method = 'GET';
    req.url = '{{baseUrl}}/api/user/list';
    req.params = [{ key: 'pageNum', value: '1', desc: '页码', enabled: true },
      { key: 'pageSize', value: '10', desc: '每页条数', enabled: true }];
    col.items.push(req);
    state.collections = [col];
  }

  /* ------------------------------------------------------------------
     树查找工具
     ------------------------------------------------------------------ */
  function walk(items, fn, parent = null) {
    for (let i = 0; i < items.length; i++) {
      const node = items[i];
      if (fn(node, items, i, parent) === false) return false;
      if (node.items && walk(node.items, fn, node) === false) return false;
    }
    return true;
  }

  function findNode(id) {
    let found = null;
    walk(state.collections, (node, siblings, index, parent) => {
      if (node.id === id) { found = { node, siblings, index, parent }; return false; }
    });
    return found;
  }

  function findRequest(id) {
    const hit = findNode(id);
    return hit && hit.node.type === 'request' ? hit.node : null;
  }

  function findFlow(id) {
    return state.flows.find((f) => f.id === id) || null;
  }

  /** 找到某个请求所属的集合 */
  function findOwnerCollection(id) {
    for (const col of state.collections) {
      let hit = false;
      walk([col], (node) => { if (node.id === id) { hit = true; return false; } });
      if (hit) return col;
    }
    return null;
  }

  function removeNode(id) {
    // 顶层集合
    const ci = state.collections.findIndex((c) => c.id === id);
    if (ci >= 0) return state.collections.splice(ci, 1)[0];
    const hit = findNode(id);
    if (!hit) return null;
    return hit.siblings.splice(hit.index, 1)[0];
  }

  function activeEnv() {
    return state.environments.find((e) => e.id === state.activeEnvId) || null;
  }

  function pushHistory(entry) {
    state.history.unshift({ id: U.uid('h'), at: Date.now(), ...entry });
    if (state.history.length > 200) state.history.length = 200;
    save();
  }

  return {
    state, save, load,
    newRequest, newFolder, newCollection, newEnvironment, newFlow, newFlowStep,
    DEFAULT_LOGIN, DEFAULT_TOKEN,
    walk, findNode, findRequest, findFlow, findOwnerCollection, removeNode,
    activeEnv, pushHistory
  };
})();
