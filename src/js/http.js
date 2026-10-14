/* =========================================================================
   http.js - 请求组装与发送（含 Token 自动注入、401 自动重登重试）
   ========================================================================= */
const Http = (() => {

  /** 收集一段文本里用到的 {{变量}}，并给出解析结果（用于「实际发出」面板核对） */
  function collectVars(rawParts, env, ctx) {
    const map = Vars.scope(env);
    const rows = [];
    const seen = new Set();
    for (const raw of rawParts) {
      if (typeof raw !== 'string' || raw.indexOf('{{') < 0) continue;
      const re = new RegExp(Vars.VAR_RE.source, 'g');
      let m;
      while ((m = re.exec(raw)) !== null) {
        const name = m[1].trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);

        if (name.startsWith('$')) {
          const sv = Vars.resolveStepValue(name, ctx);
          if (sv !== undefined) { rows.push({ name, value: String(sv), scope: '流程步骤' }); continue; }
          // 可能是内置动态变量（$timestamp / $guid …）
          const d = Vars.resolveDetail(m[0], env, ctx);
          rows.push({
            name,
            value: d.missing.length ? null : d.text,
            scope: d.missing.length ? '未定义' : '动态'
          });
          continue;
        }
        if (map.has(name)) { rows.push({ name, value: String(map.get(name)), scope: '变量' }); continue; }
        const d = Vars.resolveDetail(m[0], env, ctx);
        rows.push({
          name,
          value: d.missing.length ? null : d.text,
          scope: d.missing.length ? '未定义' : '动态'
        });
      }
    }
    return rows;
  }

  /** 把请求模型编译成主进程能发的 config */
  function build(req, env, ctx) {
    const holder = { url: '' };
    const notes = [];

    // 1) URL：基础地址 + 路径变量 + query
    let base = Vars.resolve(req.url || '', env, ctx).trim();
    const parts = U.splitUrl(base);
    base = parts.base;

    for (const pv of req.pathVars || []) {
      if (!pv.key) continue;
      const val = encodeURIComponent(Vars.resolve(pv.value || '', env, ctx));
      base = base.replace(new RegExp(':' + pv.key + '(?![\\w-])', 'g'), val);
    }

    const paramItems = (req.params || []).map((p) => ({
      key: Vars.resolve(p.key, env, ctx),
      value: Vars.resolve(p.value ?? '', env, ctx),
      enabled: p.enabled
    }));

    // URL 里自带的 query（变量展开出来的、或导入时残留的）要保留。
    // 同名 key 以 Params 表为准，避免编辑器双向同步时出现重复参数。
    const declared = new Set(paramItems.filter((p) => p.key).map((p) => p.key));
    const inlineItems = U.parseQuery(parts.query).filter((p) => !declared.has(p.key));

    const query = U.buildQuery(inlineItems.concat(paramItems));
    holder.url = base + (query ? '?' + query : '') + (parts.hash || '');

    if (holder.url && !/^https?:\/\//i.test(holder.url)) {
      holder.url = 'http://' + holder.url.replace(/^\/+/, '');
    }

    // 2) Headers：先铺「环境 Header」（该环境所有请求自动携带），再用请求自己的 Header 覆盖
    const headers = {};
    const envHeaderNames = [];
    if (env && Array.isArray(env.headers)) {
      for (const h of env.headers) {
        if (h.enabled === false || !h.key) continue;
        const k = Vars.resolve(h.key, env, ctx);
        if (!k) continue;
        headers[k] = Vars.resolve(h.value ?? '', env, ctx);
        envHeaderNames.push(k);
      }
    }
    for (const h of req.headers || []) {
      if (h.enabled === false || !h.key) continue;
      headers[Vars.resolve(h.key, env, ctx)] = Vars.resolve(h.value ?? '', env, ctx);
    }
    for (const k of envHeaderNames) {
      if (headers[k] !== undefined) notes.push(`${k}: 由环境「${env.name}」自动携带`);
    }

    // 3) 认证
    const auth = req.auth || { type: 'inherit' };
    let injected = null;
    if (auth.type === 'inherit') {
      if (env && env.login && env.login.enabled) {
        injected = Auth.injectInto(env, headers, holder);
        if (injected) notes.push(`${injected.name}: 由环境「${env.name}」自动注入`);
      }
    } else if (auth.type === 'bearer') {
      const t = Vars.resolve(auth.bearer || '', env, ctx);
      if (t) { headers['Authorization'] = 'Bearer ' + t; injected = { where: 'header', name: 'Authorization' }; }
    } else if (auth.type === 'basic') {
      const u = Vars.resolve(auth.username || '', env, ctx);
      const p = Vars.resolve(auth.password || '', env, ctx);
      headers['Authorization'] = 'Basic ' + btoa(unescape(encodeURIComponent(`${u}:${p}`)));
      injected = { where: 'header', name: 'Authorization' };
    } else if (auth.type === 'apikey') {
      const k = Vars.resolve(auth.apiKey || '', env, ctx);
      const v = Vars.resolve(auth.apiValue || '', env, ctx);
      if (k) {
        if (auth.apiIn === 'query') {
          holder.url += (holder.url.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
        } else {
          headers[k] = v;
        }
        injected = { where: auth.apiIn || 'header', name: k };
      }
    }

    // 4) Body
    const b = req.body || { mode: 'none' };
    let body = { mode: 'none' };
    if (b.mode === 'raw') {
      body = { mode: 'raw', text: Vars.resolve(b.raw || '', env, ctx), contentType: b.rawType || 'application/json' };
    } else if (b.mode === 'urlencoded') {
      body = { mode: 'urlencoded', items: Vars.resolveItems(b.urlencoded, env, ctx) };
    } else if (b.mode === 'formdata') {
      body = {
        mode: 'formdata',
        items: (b.formdata || []).filter((i) => i.enabled !== false && i.key).map((i) => ({
          key: Vars.resolve(i.key, env, ctx),
          value: Vars.resolve(i.value || '', env, ctx),
          type: i.type || 'text',
          src: i.src
        }))
      };
    }

    // 5) 变量使用清单（「实际发出」面板用来核对有没有漏/错，未解析到的会标红）
    const rawParts = [
      req.url || '',
      ...(req.pathVars || []).map((p) => p.value || ''),
      ...(req.params || []).flatMap((p) => [p.key || '', p.value || '']),
      ...(env && Array.isArray(env.headers) ? env.headers.flatMap((h) => [h.key || '', h.value || '']) : []),
      ...(req.headers || []).flatMap((h) => [h.key || '', h.value || '']),
      b.raw || '',
      ...(b.urlencoded || []).flatMap((i) => [i.key || '', i.value || '', i.src || '']),
      ...(b.formdata || []).flatMap((i) => [i.key || '', i.value || '', i.src || '']),
      (auth.bearer || '') + (auth.apiKey || '') + (auth.apiValue || '') + (auth.username || '') + (auth.password || '')
    ];
    const vars = collectVars(rawParts, env, ctx);
    const missing = vars.filter((v) => v.value === null).map((v) => v.name);

    const st = req.settings || {};
    return {
      config: {
        url: holder.url,
        method: req.method || 'GET',
        headers,
        body,
        followRedirect: st.followRedirect !== false,
        ignoreSSL: st.ignoreSSL !== false,
        useCookieJar: st.useCookieJar !== false,
        timeout: Number(st.timeout) || 60000
      },
      injected,
      notes,
      vars,
      missing
    };
  }

  /** 发送（自动处理 Token） */
  async function send(req, { onStage, onBuilt, env, ctx, reqId } = {}) {
    const activeEnv = env !== undefined ? env : Store.activeEnv();
    const stage = (s) => { if (onStage) onStage(s); };
    const emitBuilt = (b) => { if (onBuilt) { try { onBuilt(b); } catch (_) { /* 回调异常不影响发送 */ } } };
    const meta = { reloggedIn: false, loginError: null, injected: null };

    // 校验 URL
    if (!(req.url || '').trim()) {
      return { res: { error: '请先填写请求 URL' }, meta };
    }

    // 阶段 1：确保 Token 可用
    const needsToken = activeEnv && activeEnv.login && activeEnv.login.enabled && (req.auth || {}).type === 'inherit';
    if (needsToken && !Auth.isValid(activeEnv)) {
      stage('logging-in');
      const lr = await Auth.ensureToken(activeEnv);
      if (!lr.ok && !lr.skipped) {
        meta.loginError = lr.error;
      } else if (lr.ok && !lr.cached && !lr.skipped) {
        meta.reloggedIn = true;
      }
    }

    // 阶段 2：正式发送
    stage('sending');
    let built = build(req, activeEnv, ctx);
    if (reqId) built.config.reqId = reqId;   // 供主进程取消用
    meta.injected = built.injected;
    emitBuilt(built);                        // 发包前先让界面展示「实际发出」
    let res = await window.api.send(built.config);
    res.finalUrl = built.config.url;

    // 阶段 3：认证失效 → 重登一次 → 重发
    if (!res.error && needsToken && Auth.shouldRelogin(activeEnv, res)) {
      stage('relogin');
      const lr = await Auth.login(activeEnv);
      if (lr.ok) {
        meta.reloggedIn = true;
        built = build(req, activeEnv, ctx);
        if (reqId) built.config.reqId = reqId;
        meta.injected = built.injected;
        emitBuilt(built);
        const retry = await window.api.send(built.config);
        retry.finalUrl = built.config.url;
        retry.retriedAfterRelogin = true;
        res = retry;
        App.refreshTokenChip();
      } else {
        meta.loginError = lr.error;
      }
    }

    stage('done');
    return { res, meta, config: built.config, vars: built.vars, missing: built.missing, notes: built.notes };
  }

  return { build, send, collectVars };
})();
