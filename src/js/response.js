/* =========================================================================
   response.js - 响应渲染
   ========================================================================= */
const Response = (() => {

  let viewMode = 'pretty';
  let filterPath = '';

  function show(res, meta, tab) {
    if (tab) tab.lastResponse = { res, meta, at: Date.now() };
    render(res, meta);
  }

  function restore(tab) {
    if (tab && tab.lastResponse) {
      render(tab.lastResponse.res, tab.lastResponse.meta);
    } else {
      U.$('#resMeta').innerHTML = '';
      U.$('#resBodyToolbar').hidden = true;
      U.$('#resContent').innerHTML = '<div class="res-placeholder"><p>点击「发送」查看响应</p></div>';
      U.$('#resHeaders').innerHTML = '';
      U.$('#resRequest').innerHTML = '';
      U.$('#cntResHeaders').textContent = '';
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
      let value = parsed.value;
      if (filterPath) {
        const picked = U.getByPath(value, filterPath);
        if (picked === undefined) {
          content.appendChild(U.el('div', { class: 'res-placeholder' }, [U.el('p', { text: `路径 ${filterPath} 没有匹配到内容` })]));
          return;
        }
        value = picked;
      }
      content.appendChild(U.el('pre', { class: 'code', html: U.highlightJSON(value) }));
      return;
    }

    const ct = (res.headers['content-type'] || '').toLowerCase();
    if (ct.includes('xml') || ct.includes('html')) {
      content.appendChild(U.el('pre', { class: 'code', text: U.formatXML(text) }));
      return;
    }
    content.appendChild(U.el('pre', { class: 'code', text }));
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
    box.innerHTML = '';
    const p = res.requestPreview;
    if (!p) {
      box.innerHTML = '<div class="res-placeholder"><p>没有请求快照</p></div>';
      return;
    }
    const lines = [];
    lines.push(`${p.method} ${p.url}`);
    lines.push('');
    for (const [k, v] of Object.entries(p.headers || {})) lines.push(`${k}: ${v}`);
    if (p.bodyPreview) { lines.push(''); lines.push(p.bodyPreview); }

    if (meta.injected) {
      box.appendChild(U.el('div', {
        style: 'margin-bottom:10px;padding:8px 11px;border-radius:5px;background:#fff1ec;border:1px solid #ffd4c4;font-size:12px;color:#8a4021',
        text: meta.injected.where === 'query'
          ? `Token 已注入到 URL 参数 ${meta.injected.name}`
          : `Token 已注入到请求头 ${meta.injected.name}`
      }));
    }
    if (res.redirects && res.redirects.length) {
      const rd = U.el('div', { style: 'margin-bottom:10px;font-size:12px;color:#5c5c5c' });
      rd.appendChild(U.el('div', { style: 'font-weight:600;margin-bottom:4px', text: '重定向链路' }));
      for (const r of res.redirects) {
        rd.appendChild(U.el('div', { style: 'font-family:var(--mono);font-size:11.5px', text: `${r.status}  ${r.from} → ${r.to}` }));
      }
      box.appendChild(rd);
    }
    box.appendChild(U.el('pre', { class: 'code', text: lines.join('\n') }));
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

  return { show, restore, bind };
})();
