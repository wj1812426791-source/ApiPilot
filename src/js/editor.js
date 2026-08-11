/* =========================================================================
   editor.js - 请求编辑器 + 标签页管理
   ========================================================================= */
const Editor = (() => {

  let suppressSync = false;

  /* ==================================================================
     标签页
     ================================================================== */
  function current() {
    return Store.state.tabs.find((t) => t.id === Store.state.activeTabId) || null;
  }
  const currentReq = () => { const t = current(); return t ? t.draft : null; };
  const currentRefId = () => { const t = current(); return t ? t.refId : null; };

  function openRequest(refId) {
    const node = Store.findRequest(refId);
    if (!node) return;
    const exist = Store.state.tabs.find((t) => t.refId === refId);
    if (exist) {
      Store.state.activeTabId = exist.id;
    } else {
      const tab = { id: U.uid('tab'), refId, draft: U.clone(node), dirty: false };
      Store.state.tabs.push(tab);
      Store.state.activeTabId = tab.id;
    }
    Store.save();
    renderTabs();
    renderCurrent();
    Tree.render();
  }

  function newTab(seed) {
    const draft = seed || Store.newRequest('未命名请求');
    const tab = { id: U.uid('tab'), refId: null, draft, dirty: true };
    Store.state.tabs.push(tab);
    Store.state.activeTabId = tab.id;
    Store.save();
    renderTabs();
    renderCurrent();
  }

  function openFromHistory(h) {
    const req = Store.newRequest(h.name || h.url);
    req.method = h.method;
    const parts = U.splitUrl(h.url || '');
    req.url = parts.base;
    req.params = U.parseQuery(parts.query);
    if (h.snapshot) Object.assign(req, U.clone(h.snapshot), { id: req.id });
    newTab(req);
  }

  async function closeTab(tabId, { silent = false } = {}) {
    const idx = Store.state.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const tab = Store.state.tabs[idx];
    if (tab.dirty && !silent) {
      const ok = await UI.confirm(`「${tab.draft.name}」还没保存，确定关闭吗？`,
        { title: '未保存的修改', okText: '直接关闭', danger: true });
      if (!ok) return;
    }
    Store.state.tabs.splice(idx, 1);
    if (Store.state.activeTabId === tabId) {
      const next = Store.state.tabs[idx] || Store.state.tabs[idx - 1];
      Store.state.activeTabId = next ? next.id : null;
    }
    Store.save();
    renderTabs();
    renderCurrent();
    if (Flow && Flow.renderCurrent) Flow.renderCurrent();
    Tree.render();
  }

  function closeTabsByRef(rootId, ids) {
    const set = new Set(ids || [rootId]);
    Store.state.tabs = Store.state.tabs.filter((t) => !t.refId || !set.has(t.refId));
    if (!Store.state.tabs.some((t) => t.id === Store.state.activeTabId)) {
      Store.state.activeTabId = Store.state.tabs.length ? Store.state.tabs[0].id : null;
    }
    renderTabs();
    renderCurrent();
  }

  function renderTabs() {
    const box = U.$('#tabs');
    box.innerHTML = '';
    for (const tab of Store.state.tabs) {
      const active = tab.id === Store.state.activeTabId;
      const isFlow = !!tab.flowId;
      const title = isFlow ? tab.draft.name : (tab.draft.url || tab.draft.name);
      const node = U.el('div', {
        class: 'tab' + (active ? ' active' : ''),
        title: title,
        onClick: () => { Store.state.activeTabId = tab.id; Store.save(); renderTabs(); renderCurrent(); Flow && Flow.renderCurrent && Flow.renderCurrent(); Tree.render(); },
        onMousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }
      }, [
        isFlow
          ? U.el('span', { class: 'tab-method flow-icon', text: '流程' })
          : U.el('span', { class: 'tab-method ' + U.methodClass(tab.draft.method), text: tab.draft.method }),
        U.el('span', { class: 'tab-title', text: tab.draft.name || '未命名' }),
        tab.dirty ? U.el('span', { class: 'tab-dirty', title: '未保存' }) : null,
        U.el('button', {
          class: 'tab-close', text: '×',
          onClick: (e) => { e.stopPropagation(); closeTab(tab.id); }
        })
      ]);
      box.appendChild(node);
    }
  }

  function markDirty() {
    const t = current();
    if (!t) return;
    if (!t.dirty) { t.dirty = true; renderTabs(); }
    Store.save();
  }

  /* ==================================================================
     KV 表格
     ================================================================== */
  function renderKV(container, list, opts, onChange) {
    const o = Object.assign({ desc: true, fileType: false, kPlaceholder: '键', vPlaceholder: '值' }, opts || {});
    container.innerHTML = '';

    const head = U.el('div', { class: 'kv-head' }, [
      U.el('div', { class: 'kv-check' }),
      U.el('div', { class: 'kv-k', text: 'KEY' }),
      U.el('div', { class: 'kv-v', text: 'VALUE' }),
      o.desc ? U.el('div', { class: 'kv-d', text: '说明' }) : null,
      U.el('div', { class: 'kv-x' })
    ]);
    container.appendChild(head);

    const commit = () => { onChange(list); };

    const buildRow = (item, index, isPlaceholder) => {
      const row = U.el('div', { class: 'kv-row' + (isPlaceholder ? ' placeholder' : '') });

      const chk = U.el('input', { type: 'checkbox' });
      chk.checked = item.enabled !== false;
      chk.disabled = isPlaceholder;
      chk.addEventListener('change', () => { item.enabled = chk.checked; commit(); });
      row.appendChild(U.el('div', { class: 'kv-check' }, [chk]));

      const mkInput = (field, ph) => {
        const inp = U.el('input', { type: 'text', value: item[field] ?? '', placeholder: ph, spellcheck: 'false' });
        inp.addEventListener('input', () => {
          item[field] = inp.value;
          if (isPlaceholder && (item.key || item.value)) {
            item.enabled = true;
            list.push(item);
            commit();
            rerender(true, field, inp.selectionStart);
          } else {
            commit();
          }
        });
        return inp;
      };

      row.appendChild(U.el('div', { class: 'kv-k' }, [mkInput('key', o.kPlaceholder)]));

      const vCell = U.el('div', { class: 'kv-v', style: 'display:flex;align-items:center' });
      if (o.fileType && item.type === 'file') {
        vCell.appendChild(U.el('span', {
          style: 'flex:1;padding:0 9px;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5c5c5c',
          text: item.src || '未选择文件', title: item.src || ''
        }));
        vCell.appendChild(U.el('button', {
          class: 'kv-file-btn', text: '选择文件',
          onClick: async () => {
            const r = await window.api.openDialog({ properties: ['openFile'] });
            if (r.ok) { item.src = r.path; commit(); rerender(); }
          }
        }));
      } else {
        vCell.appendChild(mkInput('value', o.vPlaceholder));
      }
      if (o.fileType) {
        const sel = U.el('select', { class: 'kv-type-select' }, [
          U.el('option', { value: 'text', text: 'Text' }),
          U.el('option', { value: 'file', text: 'File' })
        ]);
        sel.value = item.type || 'text';
        sel.addEventListener('change', () => { item.type = sel.value; commit(); rerender(); });
        vCell.appendChild(sel);
      }
      row.appendChild(vCell);

      if (o.desc) row.appendChild(U.el('div', { class: 'kv-d' }, [mkInput('desc', '说明')]));

      row.appendChild(U.el('div', { class: 'kv-x' }, [
        isPlaceholder ? U.el('span') : U.el('button', {
          class: 'kv-del', text: '×', title: '删除这一行',
          onClick: () => { list.splice(index, 1); commit(); rerender(); }
        })
      ]));

      return row;
    };

    list.forEach((item, i) => container.appendChild(buildRow(item, i, false)));
    const ph = { key: '', value: '', desc: '', enabled: true, type: 'text' };
    container.appendChild(buildRow(ph, -1, true));

    function rerender(focusLast, field, caret) {
      renderKV(container, list, o, onChange);
      if (focusLast) {
        const rows = container.querySelectorAll('.kv-row');
        const target = rows[list.length - 1];
        if (target) {
          const sel = field === 'value' ? '.kv-v input' : field === 'desc' ? '.kv-d input' : '.kv-k input';
          const inp = target.querySelector(sel);
          if (inp) { inp.focus(); if (caret != null) inp.setSelectionRange(caret, caret); }
        }
      }
    }
  }

  /* ==================================================================
     渲染当前请求
     ================================================================== */
  function renderCurrent() {
    const tab = current();
    const isFlowTab = tab && tab.flowId;
    const req = currentReq();
    U.$('#welcome').hidden = !!(req || isFlowTab);
    U.$('#reqArea').hidden = !req;
    U.$('#flowArea').hidden = !isFlowTab;
    if (isFlowTab) { if (typeof Scheduler !== 'undefined') Scheduler.showLog(null); return; }
    if (!req) { if (typeof Scheduler !== 'undefined') Scheduler.showLog(null); return; }

    suppressSync = true;
    U.$('#methodSelect').value = req.method || 'GET';
    U.$('#urlInput').value = req.url || '';
    syncUrlHighlight();
    suppressSync = false;

    renderParams();
    renderHeaders();
    renderAuth();
    renderBody();
    renderSettings();
    updateCounts();
    Response.restore(current());
    if (typeof Scheduler !== 'undefined') Scheduler.showLog(req);
  }

  function updateCounts() {
    const req = currentReq();
    if (!req) return;
    const n = (arr) => (arr || []).filter((i) => i.enabled !== false && i.key).length;
    const set = (id, v) => { U.$(id).textContent = v ? String(v) : ''; };
    set('#cntParams', n(req.params) + n(req.pathVars));
    set('#cntHeaders', n(req.headers));
    const b = req.body || {};
    set('#cntBody', b.mode && b.mode !== 'none' ? '●' : '');
    const authOn = req.auth && req.auth.type !== 'none';
    set('#cntAuth', authOn ? '●' : '');
  }

  /* --------------------------- URL ↔ Params --------------------------- */
  function syncUrlHighlight() {
    const input = U.$('#urlInput');
    const hl = U.$('#urlHighlight');
    hl.innerHTML = Vars.highlightHtml(input.value, Store.activeEnv());
    hl.scrollLeft = input.scrollLeft;
  }

  function onUrlInput() {
    if (suppressSync) return;
    const req = currentReq();
    if (!req) return;
    const raw = U.$('#urlInput').value;
    const parts = U.splitUrl(raw);
    req.url = parts.base + (parts.hash || '');

    // query → params 表（保留已有行的说明与勾选状态）
    const parsed = U.parseQuery(parts.query);
    const old = req.params || [];
    req.params = parsed.map((p) => {
      const prev = old.find((x) => x.key === p.key);
      return { key: p.key, value: p.value, desc: prev ? prev.desc : '', enabled: prev ? prev.enabled !== false : true };
    });
    // 保留被禁用的旧参数（它们不在 URL 里）
    for (const o of old) {
      if (o.enabled === false && o.key && !req.params.some((p) => p.key === o.key)) req.params.push(o);
    }

    detectPathVars(req);
    renderParams();
    updateCounts();
    syncUrlHighlight();
    markDirty();
  }

  function syncParamsToUrl() {
    const req = currentReq();
    if (!req) return;
    const q = U.buildQuery(req.params);
    const base = U.splitUrl(req.url || '').base;
    const full = base + (q ? '?' + q : '');
    suppressSync = true;
    U.$('#urlInput').value = full;
    suppressSync = false;
    syncUrlHighlight();
  }

  function detectPathVars(req) {
    const found = [...(req.url || '').matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
    const uniq = [...new Set(found)];
    const old = req.pathVars || [];
    req.pathVars = uniq.map((k) => {
      const prev = old.find((x) => x.key === k);
      return { key: k, value: prev ? prev.value : '', desc: prev ? prev.desc : '', enabled: true };
    });
  }

  function renderParams() {
    const req = currentReq();
    renderKV(U.$('#kvParams'), req.params, { kPlaceholder: '参数名', vPlaceholder: '参数值' }, () => {
      syncParamsToUrl();
      updateCounts();
      markDirty();
    });
    renderKV(U.$('#kvPathVars'), req.pathVars, { kPlaceholder: '变量名', vPlaceholder: '值' }, () => {
      updateCounts();
      markDirty();
    });
  }

  function renderHeaders() {
    const req = currentReq();
    renderKV(U.$('#kvHeaders'), req.headers, { kPlaceholder: 'Header 名', vPlaceholder: 'Header 值' }, () => {
      updateCounts();
      renderAutoHeaders();
      markDirty();
    });
    renderAutoHeaders();
  }

  function renderAutoHeaders() {
    const req = currentReq();
    const env = Store.activeEnv();
    const box = U.$('#autoHeaders');
    box.innerHTML = '';
    const rows = [];

    if (req.auth && req.auth.type === 'inherit' && env && env.login && env.login.enabled) {
      const st = Auth.status(env);
      const name = env.login.headerName || 'Authorization';
      const preview = st.token
        ? (env.login.prefix || '') + st.token.slice(0, 24) + (st.token.length > 24 ? '…' : '')
        : '（发送时自动登录获取）';
      if (env.login.injectTo === 'query') {
        rows.push({ k: `?${env.login.queryName || 'token'}`, v: preview, injected: true });
      } else {
        rows.push({ k: name, v: preview, injected: true });
      }
    }
    rows.push({ k: 'User-Agent', v: 'ApiPilot/1.0.0' });
    rows.push({ k: 'Accept', v: '*/*' });
    rows.push({ k: 'Accept-Encoding', v: 'gzip, deflate, br' });
    if ((req.settings || {}).useCookieJar !== false) rows.push({ k: 'Cookie', v: '（自动带上已保存的 Cookie）' });
    const b = req.body || {};
    if (b.mode === 'raw') rows.push({ k: 'Content-Type', v: b.rawType || 'application/json' });
    else if (b.mode === 'urlencoded') rows.push({ k: 'Content-Type', v: 'application/x-www-form-urlencoded' });
    else if (b.mode === 'formdata') rows.push({ k: 'Content-Type', v: 'multipart/form-data; boundary=…' });

    for (const r of rows) {
      box.appendChild(U.el('div', { class: 'auto-h-row' + (r.injected ? ' injected' : '') }, [
        U.el('b', { text: r.k }),
        U.el('span', { text: r.v })
      ]));
    }
  }

  /* --------------------------- Auth --------------------------- */
  function renderAuth() {
    const req = currentReq();
    const auth = req.auth || (req.auth = { type: 'inherit' });
    U.$('#authType').value = auth.type || 'inherit';

    const box = U.$('#authFields');
    const note = U.$('#authNote');
    box.innerHTML = '';
    note.innerHTML = '';

    const field = (label, key, type = 'text', full = false, placeholder = '') => {
      const inp = U.el('input', { class: 'input mono', type, value: auth[key] || '', placeholder, spellcheck: 'false' });
      inp.addEventListener('input', () => { auth[key] = inp.value; markDirty(); renderAutoHeaders(); });
      return U.el('label', { class: 'field' + (full ? ' full' : '') }, [
        U.el('span', { class: 'field-label', text: label }), inp
      ]);
    };

    if (auth.type === 'inherit') {
      const env = Store.activeEnv();
      if (!env) {
        note.innerHTML = '当前没有选中环境。';
      } else if (!env.login || !env.login.enabled) {
        note.innerHTML = `环境「${U.escapeHtml(env.name)}」还没有开启登录动作。<br>
          点右上角齿轮 → 选中环境 → <b>登录与 Token</b> 标签页，配好登录接口后，这里就会自动带上 Token。`;
      } else {
        const st = Auth.status(env);
        const inject = env.login.injectTo === 'query'
          ? `URL 参数 <code>${U.escapeHtml(env.login.queryName || 'token')}</code>`
          : `请求头 <code>${U.escapeHtml(env.login.headerName || 'Authorization')}</code>`;
        note.innerHTML = `发送时会自动把环境「${U.escapeHtml(env.name)}」的 Token 注入到 ${inject}，
          前缀 <code>${U.escapeHtml(env.login.prefix || '(无)')}</code>。<br>
          当前状态：<b>${U.escapeHtml(st.text)}</b>。Token 不存在或已过期时会先自动登录，
          请求返回 <code>${U.escapeHtml(env.login.reloginStatus || '401,403')}</code> 时会重登并自动重发一次。`;
      }
    } else if (auth.type === 'bearer') {
      box.appendChild(field('Token', 'bearer', 'text', true, '可直接写 {{token}} 引用环境 Token'));
      note.innerHTML = '会生成请求头 <code>Authorization: Bearer &lt;Token&gt;</code>。';
    } else if (auth.type === 'basic') {
      box.appendChild(field('用户名', 'username'));
      box.appendChild(field('密码', 'password', 'password'));
      note.innerHTML = '会生成请求头 <code>Authorization: Basic base64(用户名:密码)</code>。';
    } else if (auth.type === 'apikey') {
      box.appendChild(field('Key', 'apiKey', 'text', false, '如 X-Api-Key'));
      box.appendChild(field('Value', 'apiValue'));
      const sel = U.el('select', { class: 'input' }, [
        U.el('option', { value: 'header', text: '放在 Header' }),
        U.el('option', { value: 'query', text: '放在 URL 参数' })
      ]);
      sel.value = auth.apiIn || 'header';
      sel.addEventListener('change', () => { auth.apiIn = sel.value; markDirty(); renderAutoHeaders(); });
      box.appendChild(U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '位置' }), sel]));
    } else {
      note.innerHTML = '这个请求不带任何认证信息。';
    }
  }

  /* --------------------------- Body --------------------------- */
  function renderBody() {
    const req = currentReq();
    const b = req.body || (req.body = { mode: 'none', raw: '', rawType: 'application/json', formdata: [], urlencoded: [] });

    U.$$('input[name=bodyMode]').forEach((r) => { r.checked = r.value === (b.mode || 'none'); });
    U.$('#rawType').value = b.rawType || 'application/json';
    U.$('#rawBody').value = b.raw || '';

    U.$('#bodyNone').hidden = b.mode !== 'none';
    U.$('#bodyFormData').hidden = b.mode !== 'formdata';
    U.$('#bodyUrlEncoded').hidden = b.mode !== 'urlencoded';
    U.$('#bodyRaw').hidden = b.mode !== 'raw';
    U.$('#rawType').style.display = b.mode === 'raw' ? '' : 'none';
    U.$('#btnFormatBody').style.display = b.mode === 'raw' ? '' : 'none';

    if (b.mode === 'formdata') {
      renderKV(U.$('#kvFormData'), b.formdata, { fileType: true, desc: false }, () => { updateCounts(); markDirty(); });
    } else if (b.mode === 'urlencoded') {
      renderKV(U.$('#kvUrlEncoded'), b.urlencoded, { desc: false }, () => { updateCounts(); markDirty(); });
    }
    renderAutoHeaders();
  }

  function renderSettings() {
    const req = currentReq();
    const s = req.settings || (req.settings = { followRedirect: true, ignoreSSL: true, useCookieJar: true, timeout: 60000 });
    U.$('#setFollowRedirect').checked = s.followRedirect !== false;
    U.$('#setIgnoreSSL').checked = s.ignoreSSL !== false;
    U.$('#setUseCookie').checked = s.useCookieJar !== false;
    U.$('#setTimeout').value = s.timeout || 60000;
  }

  /* ==================================================================
     保存
     ================================================================== */
  async function save() {
    const tab = current();
    if (!tab) return;

    if (tab.flowId) {
      const flow = Store.findFlow(tab.flowId);
      if (flow) {
        const keep = flow.id;
        Object.assign(flow, U.clone(tab.draft), { id: keep });
        tab.dirty = false;
        Store.save();
        renderTabs();
        Flow && Flow.renderList && Flow.renderList();
        UI.toast('已保存测试流程', 'ok', 1400);
        return;
      }
    }

    if (tab.refId) {
      const node = Store.findRequest(tab.refId);
      if (node) {
        const keep = node.id;
        Object.assign(node, U.clone(tab.draft), { id: keep });
        tab.dirty = false;
        Store.save();
        renderTabs();
        Tree.render();
        UI.toast('已保存', 'ok', 1400);
        return;
      }
    }
    await saveAs();
  }

  async function saveAs() {
    const tab = current();
    if (!tab) return;
    if (!Store.state.collections.length) {
      const name = await UI.prompt('先建一个集合来放这个请求', '我的集合', { title: '新建集合' });
      if (!name) return;
      Store.state.collections.push(Store.newCollection(name));
    }

    // 目标选择弹窗
    const targets = [];
    for (const col of Store.state.collections) {
      targets.push({ id: col.id, label: col.name, depth: 0, node: col });
      Store.walk(col.items || [], (n, s, i, parent) => {
        if (n.type === 'folder') {
          targets.push({ id: n.id, label: n.name, depth: 1, node: n });
        }
      });
    }

    const nameInput = U.el('input', { class: 'input', type: 'text', value: tab.draft.name || '未命名请求' });
    const sel = U.el('select', { class: 'input' },
      targets.map((t) => U.el('option', { value: t.id, text: '　'.repeat(t.depth) + t.label })));

    const body = U.el('div', {}, [
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '请求名称' }), nameInput]),
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '保存到' }), sel])
    ]);

    const doSave = () => {
      const target = targets.find((t) => t.id === sel.value);
      if (!target) return;
      tab.draft.name = nameInput.value.trim() || '未命名请求';
      const node = U.clone(tab.draft);
      node.id = U.uid('req');
      node.type = 'request';
      target.node.items = target.node.items || [];
      target.node.items.push(node);
      target.node.expanded = true;
      tab.refId = node.id;
      tab.dirty = false;
      UI.close();
      Store.save();
      renderTabs();
      Tree.render();
      UI.toast('已保存到「' + target.label + '」', 'ok', 1600);
    };

    UI.open({
      title: '保存请求', size: 'sm', body,
      footer: U.el('div', { style: 'display:flex;gap:9px' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', { class: 'btn primary', text: '保存', onClick: doSave })
      ]),
      onMount: () => setTimeout(() => { nameInput.focus(); nameInput.select(); }, 30)
    });
  }

  /* ==================================================================
     发送
     ================================================================== */
  let sending = false;

  async function send() {
    const tab = current();
    const req = currentReq();
    if (!req || sending) return;

    const btn = U.$('#btnSend');
    sending = true;
    btn.disabled = true;
    const originalText = btn.textContent;

    const stageText = {
      'logging-in': '登录中',
      'sending': '发送中',
      'relogin': '重新登录'
    };
    btn.innerHTML = '<span class="spin"></span>';

    const started = Date.now();
    try {
      const { res, meta, config } = await Http.send(req, {
        onStage: (s) => {
          if (stageText[s]) btn.innerHTML = `<span class="spin"></span> ${stageText[s]}`;
        }
      });

      Response.show(res, meta, tab);

      if (meta.loginError) {
        UI.toast('自动登录失败：' + meta.loginError, 'err', 5000);
      } else if (meta.reloggedIn) {
        UI.toast('Token 已自动刷新', 'ok', 2000);
      }

      Store.pushHistory({
        name: req.name,
        method: req.method,
        url: (config && config.url) || req.url,
        status: res.status || 0,
        timeMs: res.timeMs || (Date.now() - started),
        snapshot: {
          method: req.method, url: req.url, params: req.params, headers: req.headers,
          body: req.body, auth: req.auth, settings: req.settings, name: req.name
        }
      });
      Tree.renderHistory();
      App.refreshTokenChip();
    } catch (e) {
      Response.show({ error: e.message || String(e) }, {}, tab);
    } finally {
      sending = false;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  /* ==================================================================
     事件绑定
     ================================================================== */
  function bind() {
    U.$('#methodSelect').addEventListener('change', (e) => {
      const req = currentReq();
      if (!req) return;
      req.method = e.target.value;
      markDirty();
      renderTabs();
      renderAutoHeaders();
    });

    const urlInput = U.$('#urlInput');
    urlInput.addEventListener('input', onUrlInput);
    urlInput.addEventListener('scroll', () => { U.$('#urlHighlight').scrollLeft = urlInput.scrollLeft; });
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });

    U.$('#btnSend').addEventListener('click', send);
    U.$('#btnSave').addEventListener('click', save);

    U.$$('.req-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        U.$$('.req-tab').forEach((b) => b.classList.toggle('active', b === btn));
        U.$$('.req-panel').forEach((p) => p.classList.toggle('active', p.dataset.rp === btn.dataset.rt));
        if (btn.dataset.rt === 'headers') renderAutoHeaders();
        if (btn.dataset.rt === 'auth') renderAuth();
      });
    });

    U.$$('input[name=bodyMode]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const req = currentReq();
        if (!req) return;
        req.body.mode = radio.value;
        renderBody();
        updateCounts();
        markDirty();
      });
    });

    U.$('#rawType').addEventListener('change', (e) => {
      const req = currentReq();
      if (!req) return;
      req.body.rawType = e.target.value;
      renderAutoHeaders();
      markDirty();
    });

    U.$('#rawBody').addEventListener('input', (e) => {
      const req = currentReq();
      if (!req) return;
      req.body.raw = e.target.value;
      updateCounts();
      markDirty();
    });

    U.$('#rawBody').addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input'));
      }
    });

    U.$('#btnFormatBody').addEventListener('click', () => {
      const req = currentReq();
      if (!req) return;
      const parsed = U.tryParseJSON(req.body.raw || '');
      if (!parsed.ok) {
        // 含变量的 JSON 先做占位再格式化
        const masked = (req.body.raw || '').replace(/\{\{([^}]+)\}\}/g, '__VAR_$1__');
        const p2 = U.tryParseJSON(masked);
        if (p2.ok) {
          const out = JSON.stringify(p2.value, null, 2).replace(/__VAR_([^"_]+)__/g, '{{$1}}');
          req.body.raw = out;
          U.$('#rawBody').value = out;
          markDirty();
          return;
        }
        UI.toast('不是合法 JSON，无法美化：' + (parsed.error || ''), 'warn', 3200);
        return;
      }
      const out = JSON.stringify(parsed.value, null, 2);
      req.body.raw = out;
      U.$('#rawBody').value = out;
      markDirty();
    });

    const bindSetting = (id, key, isNum) => {
      U.$(id).addEventListener('change', (e) => {
        const req = currentReq();
        if (!req) return;
        req.settings[key] = isNum ? Number(e.target.value) : e.target.checked;
        renderAutoHeaders();
        markDirty();
      });
    };
    bindSetting('#setFollowRedirect', 'followRedirect');
    bindSetting('#setIgnoreSSL', 'ignoreSSL');
    bindSetting('#setUseCookie', 'useCookieJar');
    bindSetting('#setTimeout', 'timeout', true);

    U.$('#btnNewTab').addEventListener('click', () => newTab());
    U.$('#btnWelcomeNew').addEventListener('click', () => newTab());
  }

  return {
    bind, renderKV, renderTabs, renderCurrent, renderAuth, renderAutoHeaders, syncUrlHighlight,
    openRequest, openFromHistory, newTab, closeTab, closeTabsByRef,
    current, currentReq, currentRefId, save, saveAs, send, markDirty, updateCounts
  };
})();
