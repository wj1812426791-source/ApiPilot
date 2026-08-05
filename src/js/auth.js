/* =========================================================================
   auth.js - 环境登录 / Token 获取、缓存、过期判断、自动重登
   这是 ApiPilot 相对 Postman 的核心增强：
   每个环境挂一个"登录动作"，Token 自动获取、自动保存、过期自动重登。
   ========================================================================= */
const Auth = (() => {

  /** 提前 30 秒视为过期，避免踩边界 */
  const EXPIRE_SKEW_MS = 30 * 1000;

  /** 同一环境的并发登录只发一次请求 */
  const pending = new Map(); // envId -> Promise

  /* ------------------------------------------------------------------
     Token 状态
     ------------------------------------------------------------------ */
  function status(env) {
    if (!env) return { state: 'none', text: '无环境', cls: '' };
    const login = env.login || {};
    const token = env.token || {};

    if (!login.enabled) {
      return {
        state: 'disabled',
        text: token.value ? 'Token 已保存（登录未启用）' : '未配置登录',
        cls: ''
      };
    }
    if (!token.value) {
      return { state: 'none', text: '未登录', cls: 'warn' };
    }
    if (token.expiresAt && Date.now() + EXPIRE_SKEW_MS >= token.expiresAt) {
      return { state: 'expired', text: 'Token 已过期', cls: 'bad', token: token.value };
    }
    const remain = token.expiresAt ? U.fmtRelative(token.expiresAt) : '不过期';
    return {
      state: 'valid',
      text: token.expiresAt ? `Token 有效 · ${remain}失效` : 'Token 有效 · 不过期',
      cls: 'ok',
      token: token.value
    };
  }

  const isValid = (env) => status(env).state === 'valid';

  /* ------------------------------------------------------------------
     从响应中提取 token
     tokenPath 支持：
       data.token          普通 JSON 路径
       data.list[0].token  带下标
       header:Authorization 从响应头取
       cookie:JSESSIONID    从 Set-Cookie 取
       留空                 自动探测常见字段
     ------------------------------------------------------------------ */
  const COMMON_TOKEN_KEYS = [
    'token', 'access_token', 'accesstoken', 'authorization',
    'jwt', 'id_token', 'idtoken', 'ticket', 'sessionid', 'auth_token'
  ];

  function extractToken(res, tokenPath) {
    const path = (tokenPath || '').trim();

    if (path.toLowerCase().startsWith('header:')) {
      const name = path.slice(7).trim().toLowerCase();
      const raw = res.headers ? res.headers[name] : '';
      const val = Array.isArray(raw) ? raw[0] : raw;
      return { value: val ? String(val) : '', from: `响应头 ${name}` };
    }

    if (path.toLowerCase().startsWith('cookie:')) {
      const name = path.slice(7).trim();
      const list = res.setCookie || [];
      for (const c of list) {
        const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(c);
        if (m) return { value: m[1], from: `Cookie ${name}` };
      }
      return { value: '', from: `Cookie ${name}` };
    }

    const parsed = U.tryParseJSON(res.bodyText || '');
    if (!parsed.ok) {
      // 非 JSON：整个响应体当 token（有些老系统直接返回一串）
      const raw = (res.bodyText || '').trim();
      if (!path && raw && raw.length < 4096 && !/[\s<>]/.test(raw)) {
        return { value: raw, from: '响应体全文' };
      }
      return { value: '', from: '', error: '响应不是合法 JSON，无法按路径提取' };
    }

    if (path) {
      const v = U.getByPath(parsed.value, path);
      if (v === undefined || v === null || v === '') {
        return { value: '', from: path, error: `响应中找不到路径 ${path}` };
      }
      return { value: String(v), from: path };
    }

    const hit = U.findDeep(parsed.value, COMMON_TOKEN_KEYS);
    if (hit) return { value: hit.value, from: `自动识别 ${hit.path}` };
    return { value: '', from: '', error: '未能自动识别 token 字段，请手动填写提取路径' };
  }

  /** 计算过期时间戳 */
  function calcExpiresAt(res, login) {
    const now = Date.now();
    const path = (login.expirePath || '').trim();
    if (path) {
      const parsed = U.tryParseJSON(res.bodyText || '');
      if (parsed.ok) {
        const raw = U.getByPath(parsed.value, path);
        if (raw !== undefined && raw !== null && raw !== '') {
          const unit = login.expireUnit || 'seconds';
          if (unit === 'seconds') return now + Number(raw) * 1000;
          if (unit === 'ms') return now + Number(raw);
          if (unit === 'timestamp') return Number(raw) * 1000;
          if (unit === 'timestampMs') return Number(raw);
          if (unit === 'datetime') {
            const t = new Date(raw).getTime();
            if (t) return t;
          }
        }
      }
    }
    const ttl = Number(login.ttlSeconds);
    if (ttl > 0) return now + ttl * 1000;
    return 0; // 0 = 不过期
  }

  /* ------------------------------------------------------------------
     执行登录
     ------------------------------------------------------------------ */
  async function doLogin(env) {
    const login = env.login || {};
    const url = Vars.resolve(login.url || '', env);
    if (!url) return { ok: false, error: '登录 URL 为空，请先在环境里配置' };

    const missing = Vars.check(login.url || '', env);
    if (missing.length) {
      return { ok: false, error: `登录 URL 里有未定义的变量：{{${missing.join('}}、{{')}}}` };
    }

    const headers = {};
    for (const h of Vars.resolveItems(login.headers, env)) {
      if (h.key) headers[h.key] = h.value;
    }

    let body = { mode: 'none' };
    if (login.bodyMode === 'raw') {
      body = {
        mode: 'raw',
        text: Vars.resolve(login.bodyRaw || '', env),
        contentType: 'application/json'
      };
    } else if (login.bodyMode === 'urlencoded') {
      body = { mode: 'urlencoded', items: Vars.resolveItems(login.bodyItems, env) };
    } else if (login.bodyMode === 'formdata') {
      body = {
        mode: 'formdata',
        items: (login.bodyItems || [])
          .filter((i) => i.enabled !== false && i.key)
          .map((i) => ({
            key: Vars.resolve(i.key, env),
            value: Vars.resolve(i.value || '', env),
            type: i.type || 'text',
            src: i.src
          }))
      };
    }

    const res = await window.api.send({
      url,
      method: login.method || 'POST',
      headers,
      body,
      ignoreSSL: login.ignoreSSL !== false,
      useCookieJar: login.useCookieJar !== false,
      followRedirect: true,
      timeout: 30000
    });

    if (res.error) return { ok: false, error: res.error, res };
    if (res.status >= 400) {
      return {
        ok: false,
        error: `登录接口返回 ${res.status} ${res.statusText || ''}`,
        res
      };
    }

    const ext = extractToken(res, login.tokenPath);
    if (!ext.value) {
      return { ok: false, error: ext.error || '未提取到 Token', res };
    }

    const expiresAt = calcExpiresAt(res, login);
    env.token = {
      value: ext.value,
      acquiredAt: Date.now(),
      expiresAt,
      raw: (res.bodyText || '').slice(0, 4000),
      from: ext.from
    };
    Store.save();

    return { ok: true, token: ext.value, from: ext.from, expiresAt, res };
  }

  /** 带并发去重的登录 */
  function login(env) {
    if (!env) return Promise.resolve({ ok: false, error: '没有选中环境' });
    if (pending.has(env.id)) return pending.get(env.id);
    const p = doLogin(env).finally(() => pending.delete(env.id));
    pending.set(env.id, p);
    return p;
  }

  /** 确保 token 可用：无效则自动登录 */
  async function ensureToken(env, { force = false } = {}) {
    if (!env || !env.login || !env.login.enabled) return { ok: true, skipped: true };
    if (!force && isValid(env)) return { ok: true, cached: true };
    const r = await login(env);
    if (r.ok) {
      App.refreshTokenChip();
    }
    return r;
  }

  function clearToken(env) {
    if (!env) return;
    env.token = Store.DEFAULT_TOKEN();
    Store.save();
    App.refreshTokenChip();
  }

  /* ------------------------------------------------------------------
     把 token 注入到请求上
     ------------------------------------------------------------------ */
  function injectInto(env, headers, urlHolder) {
    if (!env || !env.token || !env.token.value) return null;
    const login = env.login || {};
    const token = env.token.value;

    if (login.injectTo === 'query') {
      const name = login.queryName || 'token';
      const sep = urlHolder.url.includes('?') ? '&' : '?';
      urlHolder.url += `${sep}${encodeURIComponent(name)}=${encodeURIComponent(token)}`;
      return { where: 'query', name, value: token };
    }

    const name = login.headerName || 'Authorization';
    const exists = Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
    if (exists) return null; // 请求自己写了同名头，尊重用户
    const value = (login.prefix || '') + token;
    headers[name] = value;
    return { where: 'header', name, value };
  }

  /** 判断某个响应是否意味着"登录失效"，需要重登 */
  function shouldRelogin(env, res) {
    const login = env && env.login;
    if (!login || !login.enabled || !login.autoRelogin) return false;

    const codes = String(login.reloginStatus || '401,403')
      .split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    if (codes.includes(res.status)) return true;

    const match = (login.reloginBodyMatch || '').trim();
    if (match && res.bodyText) {
      // 支持 "code=401" 形式，或直接的关键字包含
      const eq = match.match(/^([\w.[\]$]+)\s*(?:==?|=)\s*(.+)$/);
      if (eq) {
        const parsed = U.tryParseJSON(res.bodyText);
        if (parsed.ok) {
          const v = U.getByPath(parsed.value, eq[1].trim());
          if (v !== undefined && String(v) === eq[2].trim().replace(/^["']|["']$/g, '')) return true;
        }
      } else if (res.bodyText.includes(match)) {
        return true;
      }
    }
    return false;
  }

  return {
    status, isValid, login, ensureToken, clearToken,
    injectInto, shouldRelogin, extractToken, calcExpiresAt, COMMON_TOKEN_KEYS
  };
})();
