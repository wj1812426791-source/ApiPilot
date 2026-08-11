/* =========================================================================
   util.js - 通用工具
   ========================================================================= */
const U = (() => {

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

  function debounce(fn, ms = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------------------------------------------------------
     按路径取值：支持 a.b.c / a[0].b / data.list.0.name / $.token
     --------------------------------------------------------------- */
  function getByPath(obj, path) {
    if (!path) return undefined;
    let p = String(path).trim();
    if (p.startsWith('$.')) p = p.slice(2);
    else if (p === '$') return obj;
    if (!p) return obj;

    const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const part of parts) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  /** 在对象中深度搜索第一个匹配 key 名的值（用于自动探测 token 字段） */
  function findDeep(obj, keyNames, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    for (const k of Object.keys(obj)) {
      if (keyNames.includes(k.toLowerCase())) {
        const v = obj[k];
        if (typeof v === 'string' && v.length > 4) return { path: k, value: v };
      }
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object') {
        const hit = findDeep(v, keyNames, depth + 1);
        if (hit) return { path: `${k}.${hit.path}`, value: hit.value };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------
     格式化
     --------------------------------------------------------------- */
  function fmtBytes(n) {
    if (!n && n !== 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtTime(ms) {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function fmtDateTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const unit = abs < 60000 ? [Math.round(abs / 1000), '秒']
      : abs < 3600000 ? [Math.round(abs / 60000), '分钟']
        : abs < 86400000 ? [Math.round(abs / 3600000), '小时']
          : [Math.round(abs / 86400000), '天'];
    return diff >= 0 ? `${unit[0]} ${unit[1]}后` : `${unit[0]} ${unit[1]}前`;
  }

  /* ---------------------------------------------------------------
     JSON 美化 + 语法高亮
     --------------------------------------------------------------- */
  function tryParseJSON(text) {
    if (typeof text !== 'string') return { ok: false };
    const t = text.trim();
    if (!t || !/^[[{"]/.test(t) && !/^-?\d/.test(t) && !/^(true|false|null)$/.test(t)) return { ok: false };
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function highlightJSON(value) {
    const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return escapeHtml(json).replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'tok-num';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'tok-key' : 'tok-str';
        else if (/true|false/.test(match)) cls = 'tok-bool';
        else if (/null/.test(match)) cls = 'tok-null';
        return `<span class="${cls}">${match}</span>`;
      });
  }

  function formatXML(xml) {
    let formatted = '';
    let pad = 0;
    xml = xml.replace(/(>)(<)(\/*)/g, '$1\n$2$3');
    for (const node of xml.split('\n')) {
      let indent = 0;
      if (node.match(/^<\/\w/)) pad = Math.max(pad - 1, 0);
      else if (node.match(/^<\w[^>]*[^/]>.*$/)) indent = 1;
      formatted += '  '.repeat(pad) + node + '\n';
      pad += indent;
    }
    return formatted.trim();
  }

  /* ---------------------------------------------------------------
     剪贴板
     --------------------------------------------------------------- */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  }

  /** URL 中的 query 解析 / 组装 */
  function splitUrl(url) {
    const i = url.indexOf('?');
    if (i < 0) return { base: url, query: '', hash: '' };
    let rest = url.slice(i + 1);
    let hash = '';
    const h = rest.indexOf('#');
    if (h >= 0) { hash = rest.slice(h); rest = rest.slice(0, h); }
    return { base: url.slice(0, i), query: rest, hash };
  }

  function parseQuery(qs) {
    if (!qs) return [];
    return qs.split('&').filter(Boolean).map((pair) => {
      const i = pair.indexOf('=');
      const rawK = i < 0 ? pair : pair.slice(0, i);
      const rawV = i < 0 ? '' : pair.slice(i + 1);
      const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (_) { return s; } };
      return { key: dec(rawK), value: dec(rawV), desc: '', enabled: true };
    });
  }

  function buildQuery(items) {
    return (items || [])
      .filter((i) => i.enabled !== false && (i.key || i.value))
      .map((i) => {
        // 保留 {{var}} 不做编码，方便阅读
        const enc = (s) => String(s ?? '').split(/(\{\{[^}]+\}\})/g)
          .map((seg) => (/^\{\{[^}]+\}\}$/.test(seg) ? seg : encodeURIComponent(seg)))
          .join('');
        return `${enc(i.key)}=${enc(i.value)}`;
      })
      .join('&');
  }

  function methodClass(m) {
    return 'm-' + String(m || 'get').toLowerCase();
  }

  /** 笛卡尔积：groups 为二维数组，返回所有组合（每组取一个元素） */
  function cartesian(groups) {
    return groups.reduce((acc, group) => {
      const next = [];
      for (const a of acc) for (const v of group) next.push(a.concat(v));
      return next;
    }, [[]]);
  }

  return {
    $, $$, el, uid, clone, debounce, escapeHtml,
    getByPath, findDeep,
    fmtBytes, fmtTime, fmtDateTime, fmtRelative,
    tryParseJSON, highlightJSON, formatXML,
    copy, splitUrl, parseQuery, buildQuery, methodClass, cartesian
  };
})();
