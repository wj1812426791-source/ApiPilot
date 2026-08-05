/* =========================================================================
   importer.js - Postman 集合导入导出 / cURL 互转
   ========================================================================= */
const Importer = (() => {

  /* ==================================================================
     Postman Collection v2.1 → ApiPilot
     ================================================================== */
  function fromPostman(json) {
    const info = json.info || {};
    const col = Store.newCollection(info.name || '导入的集合');
    col.description = typeof info.description === 'string' ? info.description : '';
    col.items = (json.item || []).map(convertItem).filter(Boolean);
    return col;
  }

  function convertItem(item) {
    if (!item) return null;
    if (Array.isArray(item.item)) {
      const folder = Store.newFolder(item.name || '文件夹');
      folder.items = item.item.map(convertItem).filter(Boolean);
      return folder;
    }
    if (!item.request) return null;

    const r = item.request;
    const req = Store.newRequest(item.name || '未命名请求');
    req.method = (typeof r === 'string' ? 'GET' : r.method) || 'GET';

    const rawUrl = typeof r === 'string' ? r
      : (typeof r.url === 'string' ? r.url : (r.url && r.url.raw) || '');
    const parts = U.splitUrl(rawUrl);
    req.url = parts.base;

    // query
    if (r.url && Array.isArray(r.url.query) && r.url.query.length) {
      req.params = r.url.query.map((q) => ({
        key: q.key || '', value: q.value || '', desc: q.description || '', enabled: !q.disabled
      }));
    } else {
      req.params = U.parseQuery(parts.query);
    }

    // path variables
    if (r.url && Array.isArray(r.url.variable)) {
      req.pathVars = r.url.variable.map((v) => ({
        key: v.key || '', value: v.value || '', desc: v.description || '', enabled: true
      }));
    }

    // headers
    const hs = (typeof r === 'string' ? [] : r.header) || [];
    req.headers = (Array.isArray(hs) ? hs : []).map((h) => ({
      key: h.key || '', value: h.value || '', desc: h.description || '', enabled: !h.disabled
    }));

    // body
    const b = (typeof r === 'string' ? null : r.body) || null;
    if (b && b.mode) {
      if (b.mode === 'raw') {
        req.body.mode = 'raw';
        req.body.raw = b.raw || '';
        const lang = b.options && b.options.raw && b.options.raw.language;
        req.body.rawType = lang === 'json' ? 'application/json'
          : lang === 'xml' ? 'application/xml'
            : lang === 'html' ? 'text/html'
              : lang === 'javascript' ? 'application/javascript' : 'text/plain';
      } else if (b.mode === 'urlencoded') {
        req.body.mode = 'urlencoded';
        req.body.urlencoded = (b.urlencoded || []).map((i) => ({
          key: i.key || '', value: i.value || '', enabled: !i.disabled
        }));
      } else if (b.mode === 'formdata') {
        req.body.mode = 'formdata';
        req.body.formdata = (b.formdata || []).map((i) => ({
          key: i.key || '', value: i.value || '', type: i.type || 'text', src: i.src || '', enabled: !i.disabled
        }));
      }
    }

    // auth
    if (r.auth && r.auth.type) {
      const t = r.auth.type;
      const pick = (arr, key) => {
        const hit = (arr || []).find((x) => x.key === key);
        return hit ? hit.value : '';
      };
      if (t === 'bearer') {
        req.auth = { type: 'bearer', bearer: pick(r.auth.bearer, 'token') };
      } else if (t === 'basic') {
        req.auth = { type: 'basic', username: pick(r.auth.basic, 'username'), password: pick(r.auth.basic, 'password') };
      } else if (t === 'apikey') {
        req.auth = {
          type: 'apikey',
          apiKey: pick(r.auth.apikey, 'key'),
          apiValue: pick(r.auth.apikey, 'value'),
          apiIn: pick(r.auth.apikey, 'in') === 'query' ? 'query' : 'header'
        };
      } else if (t === 'noauth') {
        req.auth = { type: 'none' };
      }
    }
    return req;
  }

  /* ==================================================================
     ApiPilot → Postman Collection v2.1
     ================================================================== */
  function toPostman(col) {
    const conv = (node) => {
      if (node.type !== 'request') {
        return { name: node.name, item: (node.items || []).map(conv) };
      }
      const base = U.splitUrl(node.url || '').base;
      const query = (node.params || []).map((p) => ({
        key: p.key, value: p.value, description: p.desc || undefined, disabled: p.enabled === false || undefined
      }));
      const qs = U.buildQuery(node.params);
      const raw = base + (qs ? '?' + qs : '');

      const request = {
        method: node.method || 'GET',
        header: (node.headers || []).map((h) => ({
          key: h.key, value: h.value, description: h.desc || undefined, disabled: h.enabled === false || undefined
        })),
        url: { raw, host: [base], query: query.length ? query : undefined }
      };

      const b = node.body || {};
      if (b.mode === 'raw' && b.raw) {
        const lang = (b.rawType || '').includes('json') ? 'json'
          : (b.rawType || '').includes('xml') ? 'xml'
            : (b.rawType || '').includes('html') ? 'html' : 'text';
        request.body = { mode: 'raw', raw: b.raw, options: { raw: { language: lang } } };
      } else if (b.mode === 'urlencoded') {
        request.body = {
          mode: 'urlencoded',
          urlencoded: (b.urlencoded || []).map((i) => ({ key: i.key, value: i.value, disabled: i.enabled === false || undefined }))
        };
      } else if (b.mode === 'formdata') {
        request.body = {
          mode: 'formdata',
          formdata: (b.formdata || []).map((i) => ({
            key: i.key, value: i.type === 'file' ? undefined : i.value,
            src: i.type === 'file' ? i.src : undefined, type: i.type || 'text',
            disabled: i.enabled === false || undefined
          }))
        };
      }

      const a = node.auth || {};
      if (a.type === 'bearer') request.auth = { type: 'bearer', bearer: [{ key: 'token', value: a.bearer, type: 'string' }] };
      else if (a.type === 'basic') {
        request.auth = {
          type: 'basic',
          basic: [{ key: 'username', value: a.username, type: 'string' }, { key: 'password', value: a.password, type: 'string' }]
        };
      } else if (a.type === 'apikey') {
        request.auth = {
          type: 'apikey',
          apikey: [{ key: 'key', value: a.apiKey }, { key: 'value', value: a.apiValue }, { key: 'in', value: a.apiIn || 'header' }]
        };
      } else if (a.type === 'none') request.auth = { type: 'noauth' };

      return { name: node.name, request };
    };

    return {
      info: {
        _postman_id: col.id,
        name: col.name,
        description: col.description || '',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: (col.items || []).map(conv)
    };
  }

  /* ==================================================================
     cURL
     ================================================================== */
  function fromCurl(text) {
    const req = Store.newRequest('cURL 导入');
    let s = text.replace(/\\\r?\n/g, ' ').replace(/[\r\n]+/g, ' ').trim();
    if (!/^curl\b/i.test(s)) return null;
    s = s.replace(/^curl\s+/i, '');

    const tokens = [];
    const re = /'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      tokens.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]);
    }

    let bodyParts = [];
    let explicitMethod = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-X' || t === '--request') { explicitMethod = (tokens[++i] || '').toUpperCase(); }
      else if (t === '-H' || t === '--header') {
        const h = tokens[++i] || '';
        const idx = h.indexOf(':');
        if (idx > 0) req.headers.push({ key: h.slice(0, idx).trim(), value: h.slice(idx + 1).trim(), desc: '', enabled: true });
      } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-urlencode') {
        bodyParts.push(tokens[++i] || '');
      } else if (t === '-F' || t === '--form') {
        const f = tokens[++i] || '';
        const idx = f.indexOf('=');
        req.body.mode = 'formdata';
        if (idx > 0) {
          const k = f.slice(0, idx);
          const v = f.slice(idx + 1);
          req.body.formdata.push(v.startsWith('@')
            ? { key: k, value: '', type: 'file', src: v.slice(1), enabled: true }
            : { key: k, value: v, type: 'text', enabled: true });
        }
      } else if (t === '-u' || t === '--user') {
        const cred = (tokens[++i] || '').split(':');
        req.auth = { type: 'basic', username: cred[0] || '', password: cred.slice(1).join(':') };
      } else if (t === '-k' || t === '--insecure') {
        req.settings.ignoreSSL = true;
      } else if (t === '-L' || t === '--location') {
        req.settings.followRedirect = true;
      } else if (t.startsWith('-')) {
        // 其他参数忽略；带值的跳过下一个
        if (['-o', '--output', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--connect-timeout', '-m', '--max-time'].includes(t)) i++;
      } else if (!req.url) {
        req.url = t;
      }
    }

    if (bodyParts.length) {
      const raw = bodyParts.join('&');
      const ct = (req.headers.find((h) => h.key.toLowerCase() === 'content-type') || {}).value || '';
      if (ct.includes('x-www-form-urlencoded') || (!ct && /^[^{[]/.test(raw) && raw.includes('='))) {
        req.body.mode = 'urlencoded';
        req.body.urlencoded = U.parseQuery(raw).map((p) => ({ key: p.key, value: p.value, enabled: true }));
      } else {
        req.body.mode = 'raw';
        req.body.raw = raw;
        req.body.rawType = ct || 'application/json';
      }
    }

    req.method = explicitMethod || (req.body.mode !== 'none' ? 'POST' : 'GET');

    const parts = U.splitUrl(req.url || '');
    req.url = parts.base;
    req.params = U.parseQuery(parts.query);
    req.name = (() => {
      try { return new URL(parts.base).pathname.split('/').filter(Boolean).pop() || parts.base; }
      catch (e) { return parts.base.slice(0, 40) || 'cURL 导入'; }
    })();
    return req;
  }

  function toCurl(req, env) {
    const built = Http.build(req, env);
    const c = built.config;
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const lines = [`curl -X ${c.method} ${q(c.url)}`];
    for (const [k, v] of Object.entries(c.headers || {})) lines.push(`  -H ${q(k + ': ' + v)}`);
    const b = c.body || {};
    if (b.mode === 'raw' && b.text) lines.push(`  -d ${q(b.text)}`);
    else if (b.mode === 'urlencoded') {
      const s = (b.items || []).map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value)}`).join('&');
      if (s) lines.push(`  -d ${q(s)}`);
    } else if (b.mode === 'formdata') {
      for (const i of b.items || []) {
        lines.push(i.type === 'file' ? `  -F ${q(i.key + '=@' + (i.src || ''))}` : `  -F ${q(i.key + '=' + i.value)}`);
      }
    }
    if (c.ignoreSSL) lines.push('  -k');
    if (c.followRedirect) lines.push('  -L');
    return lines.join(' \\\n');
  }

  /* ==================================================================
     入口
     ================================================================== */
  async function importDialog() {
    const ta = U.el('textarea', {
      class: 'input mono', rows: 10, spellcheck: 'false',
      placeholder: '把 Postman 集合 JSON 或者一条 cURL 命令粘贴到这里\n\n例如：\ncurl -X POST \'http://api.test/login\' -H \'Content-Type: application/json\' -d \'{"u":"a"}\''
    });

    const doImport = (text) => {
      const t = (text || '').trim();
      if (!t) { UI.toast('内容为空', 'warn'); return; }

      if (/^curl\b/i.test(t)) {
        const req = fromCurl(t);
        if (!req) { UI.toast('cURL 解析失败', 'err'); return; }
        UI.close();
        Editor.newTab(req);
        UI.toast('cURL 已导入为新请求', 'ok');
        return;
      }

      let json;
      try { json = JSON.parse(t); }
      catch (e) { UI.toast('不是合法 JSON，也不是 cURL：' + e.message, 'err', 4000); return; }

      // ApiPilot 自己的导出包（含环境与登录配置）
      if (json && json._apipilot) {
        tryImportApiPilotBundle(json);
        Tree.render();
        App.refreshEnvSelect();
        UI.close();
        UI.toast('导入完成（含环境与登录配置）', 'ok', 3000);
        return;
      }

      // 支持一次导入多个集合（Postman 备份格式）
      const list = Array.isArray(json) ? json : (json.collections || [json]);
      let count = 0;
      for (const item of list) {
        if (!item || (!item.item && !item.info)) continue;
        const col = fromPostman(item);
        Store.state.collections.push(col);
        count += countRequests(col);
      }
      if (!count && !list.length) { UI.toast('没识别出集合内容', 'warn'); return; }

      // 一并导入环境变量
      if (json.values && json.name) {
        const env = Store.newEnvironment(json.name);
        env.variables = json.values.map((v) => ({
          key: v.key, value: v.value, desc: '', enabled: v.enabled !== false
        }));
        Store.state.environments.push(env);
        UI.toast(`已导入环境「${json.name}」`, 'ok');
      }

      Store.save();
      Tree.render();
      App.refreshEnvSelect();
      UI.close();
      UI.toast(`导入完成，共 ${count} 个请求`, 'ok', 3000);
    };

    UI.open({
      title: '导入', size: 'md',
      body: U.el('div', {}, [
        U.el('div', { class: 'panel-caption', text: '支持：Postman Collection v2.1 JSON、Postman 环境 JSON、cURL 命令' }),
        ta
      ]),
      footer: U.el('div', { style: 'display:flex;gap:9px;width:100%' }, [
        U.el('button', {
          class: 'btn', text: '从文件选择…',
          onClick: async () => {
            const r = await window.api.openDialog({
              properties: ['openFile'], readAsText: true,
              filters: [{ name: 'JSON', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }]
            });
            if (r.ok) doImport(r.content);
          }
        }),
        U.el('div', { style: 'flex:1' }),
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', { class: 'btn primary', text: '导入', onClick: () => doImport(ta.value) })
      ]),
      onMount: () => setTimeout(() => ta.focus(), 30)
    });
  }

  function countRequests(col) {
    let n = 0;
    Store.walk([col], (x) => { if (x.type === 'request') n++; });
    return n;
  }

  async function exportCollection(col) {
    const data = toPostman(col);
    const r = await window.api.saveDialog({
      defaultPath: `${col.name.replace(/[\\/:*?"<>|]/g, '_')}.postman_collection.json`,
      content: JSON.stringify(data, null, 2)
    });
    if (r.ok) UI.toast('已导出到 ' + r.path, 'ok', 3000);
  }

  async function exportDialog() {
    if (!Store.state.collections.length) { UI.toast('还没有集合可以导出', 'warn'); return; }

    const list = U.el('div');
    const checks = [];
    for (const col of Store.state.collections) {
      const cb = U.el('input', { type: 'checkbox' });
      cb.checked = true;
      checks.push({ cb, col });
      list.appendChild(U.el('label', { class: 'switch-row' }, [
        cb, U.el('span', { text: `${col.name}（${countRequests(col)} 个请求）` })
      ]));
    }

    const envCb = U.el('input', { type: 'checkbox' });
    envCb.checked = true;

    UI.open({
      title: '导出', size: 'sm',
      body: U.el('div', {}, [
        U.el('div', { class: 'panel-caption', text: '选择要导出的集合（Postman v2.1 格式）' }),
        list,
        U.el('div', { class: 'panel-caption mt', text: '其他' }),
        U.el('label', { class: 'switch-row' }, [envCb, U.el('span', { text: '同时导出环境与登录配置（含 Token）' })])
      ]),
      footer: U.el('div', { style: 'display:flex;gap:9px' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', {
          class: 'btn primary', text: '导出',
          onClick: async () => {
            const picked = checks.filter((c) => c.cb.checked).map((c) => c.col);
            if (!picked.length) { UI.toast('至少选一个集合', 'warn'); return; }
            const payload = picked.length === 1 && !envCb.checked
              ? toPostman(picked[0])
              : {
                _apipilot: true,
                exportedAt: new Date().toISOString(),
                collections: picked.map(toPostman),
                environments: envCb.checked ? Store.state.environments : undefined,
                globals: envCb.checked ? Store.state.globals : undefined
              };
            const r = await window.api.saveDialog({
              defaultPath: picked.length === 1
                ? `${picked[0].name.replace(/[\\/:*?"<>|]/g, '_')}.postman_collection.json`
                : `apipilot-export-${new Date().toISOString().slice(0, 10)}.json`,
              content: JSON.stringify(payload, null, 2)
            });
            UI.close();
            if (r.ok) UI.toast('已导出到 ' + r.path, 'ok', 3000);
          }
        })
      ])
    });
  }

  /** 导入 ApiPilot 自己的导出包 */
  function tryImportApiPilotBundle(json) {
    if (!json || !json._apipilot) return false;
    for (const c of json.collections || []) Store.state.collections.push(fromPostman(c));
    for (const e of json.environments || []) {
      e.id = U.uid('env');
      Store.state.environments.push(e);
    }
    if (json.globals) Store.state.globals = json.globals;
    Store.save();
    return true;
  }

  return { fromPostman, toPostman, fromCurl, toCurl, importDialog, exportDialog, exportCollection, tryImportApiPilotBundle };
})();
