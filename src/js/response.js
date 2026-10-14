/* =========================================================================
   response.js - 响应渲染
   ========================================================================= */
const Response = (() => {

  let viewMode = 'pretty';
  let filterPath = '';

  // 「实际发出」快照（变量解析之后的真实请求），以及发送中的计时器
  let currentSent = null;
  let sendingAt = 0;
  let sendingTimer = null;

  function normalizeSent(built) {
    if (!built) return null;
    const cfg = built.config || {};
    return {
      method: cfg.method || 'GET',
      url: cfg.url || '',
      headers: cfg.headers || {},
      body: cfg.body || { mode: 'none' },
      notes: built.notes || [],
      injected: built.injected || null,
      vars: built.vars || [],
      missing: built.missing || [],
      at: Date.now()
    };
  }

  function bodyPreviewText(body) {
    const b = body || { mode: 'none' };
    if (b.mode === 'raw') return b.text || '';
    if (b.mode === 'urlencoded') {
      return (b.items || []).map((i) => `${encodeURIComponent(i.key || '')}=${encodeURIComponent(i.value ?? '')}`).join('&');
    }
    if (b.mode === 'formdata') {
      return (b.items || []).map((i) => `${i.key}=${i.value}${i.type === 'file' ? ' (文件)' : ''}`).join('\n');
    }
    return '';
  }

  /** 发送中：先在响应区把「实际发出」摊开，避免不知道发了什么 */
  function showSending(tab, built) {
    const snap = normalizeSent(built);
    if (!snap) return;
    currentSent = snap;
    if (tab) tab.lastSent = snap;
    sendingAt = snap.at;

    const toolbar = U.$('#resBodyToolbar');
    if (toolbar) toolbar.hidden = true;

    renderMetaSending();
    renderSendingBody();
    renderRequest(null, {});   // 「实际发出」标签页同步填好
    startTimer();
  }

  function startTimer() {
    stopTimer();
    sendingTimer = setInterval(() => {
      const el = U.$('#sendingElapsed');
      if (!el) return;
      el.textContent = ((Date.now() - sendingAt) / 1000).toFixed(1) + 's';
    }, 100);
  }

  function stopTimer() {
    if (sendingTimer) { clearInterval(sendingTimer); sendingTimer = null; }
  }

  function endSending() { stopTimer(); }

  function renderMetaSending() {
    const box = U.$('#resMeta');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(U.el('span', { class: 'm-item st-3', html: '<span class="spin"></span> <b>发送中…</b>' }));
    const env = Store.activeEnv();
    if (env) box.appendChild(U.el('span', { class: 'm-item', html: `环境 <b>${U.escapeHtml(env.name)}</b>` }));
    box.appendChild(U.el('span', { class: 'm-item', html: `已用 <b id="sendingElapsed">0.0s</b>` }));
  }

  function renderSendingBody() {
    const content = U.$('#resContent');
    if (!content) return;
    content.innerHTML = '';
    const s = currentSent;
    if (!s) return;

    const box = U.el('div', { class: 'sending-box' });
    box.appendChild(U.el('div', { class: 'sending-head' }, [
      U.el('span', { class: 'spin' }),
      U.el('b', { text: '正在发送，下面是本次真正发出的内容' }),
      U.el('span', { class: 'muted-sm', text: '（变量已解析 · 右上角可「取消」）' })
    ]));

    box.appendChild(sentSummaryNode(s, { compact: true }));

    box.appendChild(U.el('div', { class: 'sr-hint' },
      [U.el('span', { text: '想看完整细节（含自动携带的环境 Header / Token 注入），点右上角「实际发出」标签。' })]));

    content.appendChild(box);
  }

  /** 「实际发出」的通用摘要节点 */
  function sentSummaryNode(s, { compact = false } = {}) {
    const wrap = U.el('div', { class: 'sr-wrap' });

    // 1) 未解析到的变量 → 醒目的红色警告
    if (s.missing && s.missing.length) {
      wrap.appendChild(U.el('div', { class: 'sr-warn' }, [
        U.el('b', { text: '⚠ 有变量没解析出来：' }),
        U.el('span', { text: s.missing.map((n) => `{{${n}}}`).join('、') }),
        U.el('div', { class: 'sr-warn-sub', text: '这些位置会被原样发出去，检查一下环境变量名是否写错、或该环境里是否漏配。' })
      ]));
    }

    // 2) 方法 + 完整 URL
    const line = U.el('div', { class: 'sr-line' }, [
      U.el('span', { class: 'node-method ' + U.methodClass(s.method), text: s.method }),
      U.el('span', { class: 'sr-url', text: s.url || '(空 URL)' })
    ]);
    wrap.appendChild(line);

    // 3) 请求头
    const hk = Object.keys(s.headers || {});
    wrap.appendChild(U.el('div', { class: 'sr-cap', text: `请求头（${hk.length}）` }));
    if (!hk.length) {
      wrap.appendChild(U.el('div', { class: 'sr-empty', text: '没有请求头' }));
    } else if (compact) {
      const mini = U.el('table', { class: 'h-table' });
      for (const k of hk.sort()) mini.appendChild(U.el('tr', {}, [
        U.el('td', { text: k }), U.el('td', { text: String(s.headers[k]) })
      ]));
      wrap.appendChild(mini);
    } else {
      const table = U.el('table', { class: 'h-table' });
      const injectedName = s.injected ? s.injected.name : null;
      for (const k of hk.sort()) {
        const isInjected = injectedName && k.toLowerCase() === String(injectedName).toLowerCase();
        const fromEnv = (s.notes || []).some((n) => n.startsWith(k + ':'));
        table.appendChild(U.el('tr', {}, [
          U.el('td', {}, [
            U.el('span', { text: k }),
            isInjected ? U.el('span', { class: 'sr-tag token', text: 'Token 注入' }) : null,
            fromEnv ? U.el('span', { class: 'sr-tag env', text: '环境自动携带' }) : null
          ]),
          U.el('td', { text: String(s.headers[k]) })
        ]));
      }
      wrap.appendChild(table);
    }

    // 4) 变量解析对照
    if (!compact && s.vars && s.vars.length) {
      wrap.appendChild(U.el('div', { class: 'sr-cap', text: `变量解析（${s.vars.length}）` }));
      const vt = U.el('table', { class: 'h-table' });
      for (const v of s.vars) {
        vt.appendChild(U.el('tr', {}, [
          U.el('td', {}, [
            U.el('span', { class: 'sr-var', text: `{{${v.name}}}` }),
            U.el('span', { class: 'sr-tag ' + (v.value === null ? 'bad' : v.scope === '流程步骤' ? 'flow' : 'var'), text: v.scope })
          ]),
          v.value === null
            ? U.el('td', { class: 'sr-miss', text: '未定义（会原样发出）' })
            : U.el('td', { text: v.value })
        ]));
      }
      wrap.appendChild(vt);
    }

    // 5) 请求体
    const bp = bodyPreviewText(s.body);
    wrap.appendChild(U.el('div', { class: 'sr-cap', text: `请求体（${s.body.mode === 'none' ? '无' : s.body.mode}）` }));
    if (!bp) {
      wrap.appendChild(U.el('div', { class: 'sr-empty', text: '没有请求体' }));
    } else if (compact) {
      wrap.appendChild(U.el('pre', { class: 'code sr-body', text: bp.length > 2000 ? bp.slice(0, 2000) + '\n…（已截断，切「实际发出」看全部）' : bp }));
    } else {
      const isJson = (s.body.contentType || '').includes('json') || (() => { try { JSON.parse(bp); return true; } catch (_) { return false; } })();
      wrap.appendChild(U.el('pre', { class: 'code', html: isJson && bp.length < 200000 ? U.highlightJSON(JSON.parse(bp)) : U.escapeHtml(bp) }));
    }

    return wrap;
  }

  function show(res, meta, tab) {
    if (tab) {
      tab.lastResponse = { res, meta, at: Date.now() };
      currentSent = tab.lastSent || null;
    } else {
      currentSent = null;
    }
    render(res, meta);
  }

  function restore(tab) {
    currentSent = (tab && tab.lastSent) || null;
    if (tab && tab.lastResponse) {
      render(tab.lastResponse.res, tab.lastResponse.meta);
    } else {
      U.$('#resMeta').innerHTML = '';
      U.$('#resBodyToolbar').hidden = true;
      U.$('#resContent').innerHTML = '<div class="res-placeholder"><p>点击「发送」查看响应</p></div>';
      U.$('#resHeaders').innerHTML = '';
      U.$('#resRequest').innerHTML = '';
      U.$('#cntResHeaders').textContent = '';
      renderRequest(null, {});
    }
  }

  function render(res, meta) {
    meta = meta || {};
    renderMeta(res, meta);
    renderBody(res);
    renderHeaders(res);
    renderRequest(res, meta);
  }

  function renderMeta(res, meta) {
    const box = U.$('#resMeta');
    box.innerHTML = '';
    if (res.canceled) {
      box.appendChild(U.el('span', { class: 'm-item st-4', html: `<b>已取消</b>` }));
      if (res.timeMs) box.appendChild(U.el('span', { class: 'm-item', html: `耗时 <b>${U.fmtTime(res.timeMs)}</b>` }));
      return;
    }
    if (res.error) {
      box.appendChild(U.el('span', { class: 'm-item st-5', html: `<b>请求失败</b>` }));
      if (res.timeMs) box.appendChild(U.el('span', { class: 'm-item', html: `耗时 <b>${U.fmtTime(res.timeMs)}</b>` }));
      return;
    }
    const cls = 'st-' + String(res.status || 0).charAt(0);
    box.appendChild(U.el('span', { class: 'm-item ' + cls, html: `<b>${res.status} ${U.escapeHtml(res.statusText || '')}</b>` }));
    box.appendChild(U.el('span', { class: 'm-item', html: `耗时 <b>${U.fmtTime(res.timeMs)}</b>` }));
    box.appendChild(U.el('span', { class: 'm-item', html: `大小 <b>${U.fmtBytes(res.decodedSize ?? res.size)}</b>` }));
    if (res.redirects && res.redirects.length) {
      box.appendChild(U.el('span', { class: 'm-item', html: `重定向 <b>${res.redirects.length}</b> 次` }));
    }
    if (meta.reloggedIn) {
      box.appendChild(U.el('span', { class: 'relogin-tag', text: res.retriedAfterRelogin ? '已重登并重发' : 'Token 已刷新' }));
    }
  }

  function renderBody(res) {
    const content = U.$('#resContent');
    const toolbar = U.$('#resBodyToolbar');
    content.innerHTML = '';

    if (res.canceled) {
      toolbar.hidden = true;
      content.appendChild(U.el('div', { class: 'res-placeholder' }, [
        U.el('p', { text: '请求已取消（可重新点「发送」再试）' })
      ]));
      return;
    }

    if (res.error) {
      toolbar.hidden = true;
      content.appendChild(U.el('div', { class: 'err-box' }, [
        U.el('b', { text: '请求发送失败' }),
        U.el('div', { text: res.error }),
        res.code ? U.el('div', { style: 'margin-top:6px;opacity:.75', text: '错误码：' + res.code }) : null
      ]));
      return;
    }

    toolbar.hidden = false;
    U.$$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));

    if (res.isBinary) {
      const ct = res.headers['content-type'] || '';
      if (ct.startsWith('image/')) {
        content.appendChild(U.el('img', { class: 'preview-img', src: `data:${ct};base64,${res.bodyBase64}` }));
      } else {
        content.appendChild(U.el('div', { class: 'res-placeholder' },
          [U.el('p', { text: `二进制响应（${ct || '未知类型'}），共 ${U.fmtBytes(res.size)}，可点右上角「保存」下载。` })]));
      }
      return;
    }

    let text = res.bodyText || '';
    if (!text) {
      content.appendChild(U.el('div', { class: 'res-placeholder' }, [U.el('p', { text: '响应体为空' })]));
      return;
    }

    if (viewMode === 'raw') {
      content.appendChild(U.el('pre', { class: 'code', text }));
      return;
    }

    if (viewMode === 'preview') {
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (ct.includes('html')) {
        const iframe = U.el('iframe', { class: 'preview-frame', sandbox: '' });
        content.appendChild(iframe);
        iframe.srcdoc = text;
        return;
      }
      content.appendChild(U.el('div', { class: 'res-placeholder' }, [U.el('p', { text: '这个响应没有可视化预览，切到 Pretty 或 Raw 查看。' })]));
      return;
    }

    // Pretty
    const parsed = U.tryParseJSON(text);
    if (parsed.ok) {
      if (filterPath) {
        // 1) 先按精确路径查（如 data.list.0.name）→ 只显示该子树
        const picked = U.getByPath(parsed.value, filterPath);
        if (picked !== undefined) {
          content.appendChild(U.el('pre', { class: 'code', html: U.highlightJSON(picked) }));
          return;
        }
        // 2) 不是精确路径 → 退化成模糊查询（键名/值包含关键字即命中）
        renderFuzzyHits(content, fuzzyFind(parsed.value, filterPath), filterPath);
        return;
      }
      content.appendChild(U.el('pre', { class: 'code', html: U.highlightJSON(parsed.value) }));
      return;
    }

    // 非 JSON：按「包含关键字的行」模糊过滤
    const ct = (res.headers['content-type'] || '').toLowerCase();
    const raw = (ct.includes('xml') || ct.includes('html')) ? U.formatXML(text) : text;
    if (filterPath) {
      const q = filterPath.toLowerCase();
      const hitLines = String(raw).split('\n').filter((l) => l.toLowerCase().includes(q));
      if (hitLines.length) {
        content.appendChild(U.el('div', { class: 'fuzzy-head' }, [
          U.el('b', { text: `包含「${filterPath}」的行` }),
          U.el('span', { class: 'fuzzy-sub', text: ` 共 ${hitLines.length} 行` })
        ]));
        content.appendChild(U.el('pre', { class: 'code', text: hitLines.join('\n') }));
        return;
      }
    }
    content.appendChild(U.el('pre', { class: 'code', text: raw }));
  }

  /* ==================================================================
     Body 模糊查询：键名 / 值包含关键字即命中（不区分大小写）
     ================================================================== */
  const FUZZY_LIMIT = 300;

  function fuzzyFind(root, query) {
    const q = String(query || '').toLowerCase();
    const hits = [];
    if (!q) return hits;
    const seen = new Set();

    const push = (p, value) => {
      if (hits.length >= FUZZY_LIMIT || !p || seen.has(p)) return;
      seen.add(p);
      hits.push({ path: p, value });
    };

    const walkNode = (node, path) => {
      if (hits.length >= FUZZY_LIMIT || node === null || node === undefined) return;
      if (Array.isArray(node)) {
        node.forEach((v, i) => walkNode(v, path ? `${path}.${i}` : String(i)));
        return;
      }
      if (typeof node === 'object') {
        for (const k of Object.keys(node)) {
          const p = path ? `${path}.${k}` : k;
          // 键名命中，或完整路径命中（支持输入 list.0.name 这种片段路径）
          if (k.toLowerCase().includes(q) || p.toLowerCase().includes(q)) push(p, node[k]);
          walkNode(node[k], p);
        }
        return;
      }
      if (String(node).toLowerCase().includes(q)) push(path, node);
    };

    walkNode(root, '');
    return hits;
  }

  function previewValue(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return `[数组 · ${v.length} 项]`;
    if (typeof v === 'object') return `{对象 · ${Object.keys(v).length} 个字段}`;
    const s = String(v);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  }

  function highlightQuery(text, query) {
    const esc = U.escapeHtml(text);
    const q = U.escapeHtml(String(query || ''));
    if (!q) return esc;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return esc.replace(re, (m) => `<mark>${m}</mark>`);
  }

  function renderFuzzyHits(content, hits, query) {
    if (!hits.length) {
      content.appendChild(U.el('div', { class: 'res-placeholder' }, [
        U.el('p', { text: `没有匹配「${query}」的内容（精确路径和模糊匹配都没命中）` })
      ]));
      return;
    }
    content.appendChild(U.el('div', { class: 'fuzzy-head' }, [
      U.el('b', { text: `模糊匹配「${query}」` }),
      U.el('span', { class: 'fuzzy-sub', text: ` 共 ${hits.length} 处 · 点路径可精确定位` })
    ]));

    const list = U.el('div', { class: 'fuzzy-list' });
    for (const h of hits) {
      const row = U.el('div', { class: 'fuzzy-row', title: '点击定位到该路径' }, [
        U.el('span', { class: 'fuzzy-path', html: highlightQuery(h.path, query) }),
        U.el('span', { class: 'fuzzy-val', text: previewValue(h.value) })
      ]);
      row.addEventListener('click', () => {
        filterPath = h.path;
        const inp = U.$('#resFilter');
        if (inp) inp.value = h.path;
        const res = currentRes();
        if (res) renderBody(res);
      });
      list.appendChild(row);
    }
    content.appendChild(list);

    if (hits.length >= FUZZY_LIMIT) {
      content.appendChild(U.el('div', { class: 'fuzzy-more', text: `只显示前 ${FUZZY_LIMIT} 处，输入更精确的关键字可缩小范围` }));
    }
  }

  function renderHeaders(res) {
    const box = U.$('#resHeaders');
    box.innerHTML = '';
    const h = res.headers || {};
    const keys = Object.keys(h);
    U.$('#cntResHeaders').textContent = keys.length ? String(keys.length) : '';
    if (!keys.length) {
      box.innerHTML = '<div class="res-placeholder"><p>没有响应头</p></div>';
      return;
    }
    const table = U.el('table', { class: 'h-table' });
    for (const k of keys.sort()) {
      const v = Array.isArray(h[k]) ? h[k].join('\n') : h[k];
      table.appendChild(U.el('tr', {}, [
        U.el('td', { text: k }),
        U.el('td', { text: String(v) })
      ]));
    }
    box.appendChild(table);
  }

  function renderRequest(res, meta) {
    const box = U.$('#resRequest');
    if (!box) return;
    box.innerHTML = '';
    res = res || {};
    meta = meta || {};

    // 没有本次构建快照（例如从历史打开）时，退回主进程给的请求预览
    if (!currentSent) {
      const p = res.requestPreview;
      if (!p) {
        box.innerHTML = '<div class="res-placeholder"><p>还没有「实际发出」的记录，点「发送」后这里会显示变量解析后的真实请求。</p></div>';
        return;
      }
      const lines = [`${p.method} ${p.url}`, ''];
      for (const [k, v] of Object.entries(p.headers || {})) lines.push(`${k}: ${v}`);
      if (p.bodyPreview) { lines.push(''); lines.push(p.bodyPreview); }
      box.appendChild(U.el('pre', { class: 'code', text: lines.join('\n') }));
      return;
    }

    const s = currentSent;
    box.appendChild(U.el('div', { class: 'sr-head' }, [
      U.el('b', { text: '本次实际发出' }),
      U.el('span', { class: 'muted-sm', text: ' · ' + U.fmtDateTime(s.at) })
    ]));

    box.appendChild(sentSummaryNode(s));

    // 真正发出去时客户端自动补充的头（Host / Content-Length 等）
    const wire = (res.requestPreview && res.requestPreview.headers) || null;
    if (wire) {
      const extra = Object.keys(wire).filter((k) => !(k in s.headers));
      if (extra.length) {
        box.appendChild(U.el('div', { class: 'sr-cap', text: '客户端自动补充' }));
        const t = U.el('table', { class: 'h-table' });
        for (const k of extra.sort()) {
          t.appendChild(U.el('tr', {}, [U.el('td', { text: k }), U.el('td', { text: String(wire[k]) })]));
        }
        box.appendChild(t);
      }
    }

    if (s.injected) {
      box.appendChild(U.el('div', {
        style: 'margin:12px 0 0;padding:8px 11px;border-radius:5px;background:#fff1ec;border:1px solid #ffd4c4;font-size:12px;color:#8a4021',
        text: s.injected.where === 'query'
          ? `Token 已注入到 URL 参数 ${s.injected.name}`
          : `Token 已注入到请求头 ${s.injected.name}`
      }));
    }
    if (res.redirects && res.redirects.length) {
      const rd = U.el('div', { style: 'margin:12px 0 0;font-size:12px;color:#5c5c5c' });
      rd.appendChild(U.el('div', { style: 'font-weight:600;margin-bottom:4px', text: '重定向链路' }));
      for (const r of res.redirects) {
        rd.appendChild(U.el('div', { style: 'font-family:var(--mono);font-size:11.5px', text: `${r.status}  ${r.from} → ${r.to}` }));
      }
      box.appendChild(rd);
    }
  }

  function currentRes() {
    const tab = Editor.current();
    return tab && tab.lastResponse ? tab.lastResponse.res : null;
  }

  function bind() {
    U.$$('.res-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        U.$$('.res-tab').forEach((b) => b.classList.toggle('active', b === btn));
        U.$$('.res-panel').forEach((p) => p.classList.toggle('active', p.dataset.sp === btn.dataset.st));
      });
    });

    U.$$('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.view;
        const res = currentRes();
        if (res) renderBody(res);
      });
    });

    U.$('#resFilter').addEventListener('input', U.debounce((e) => {
      filterPath = e.target.value.trim();
      const res = currentRes();
      if (res) renderBody(res);
    }, 220));

    U.$('#btnCopyRes').addEventListener('click', async () => {
      const res = currentRes();
      if (!res) return;
      await U.copy(res.bodyText || res.error || '');
      UI.toast('响应内容已复制', 'ok', 1400);
    });

    U.$('#btnSaveRes').addEventListener('click', async () => {
      const res = currentRes();
      if (!res) return;
      const ct = (res.headers && res.headers['content-type']) || '';
      const ext = ct.includes('json') ? 'json' : ct.includes('html') ? 'html'
        : ct.includes('xml') ? 'xml' : ct.startsWith('image/') ? ct.split('/')[1].split(';')[0] : 'txt';
      const r = await window.api.saveDialog({
        defaultPath: `response-${Date.now()}.${ext}`,
        content: res.isBinary ? res.bodyBase64 : (res.bodyText || ''),
        base64: !!res.isBinary
      });
      if (r.ok) UI.toast('已保存到 ' + r.path, 'ok', 2600);
    });
  }

  return {
    show, restore, bind, showSending, endSending,
    fuzzyFind, previewValue, normalizeSent, bodyPreviewText
  };
})();
