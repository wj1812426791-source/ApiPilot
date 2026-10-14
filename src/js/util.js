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
     宽松 JSON 解析：容错 BOM / JSONP 包裹 / 防劫持前缀
     --------------------------------------------------------------- */
  function tryParseJSONLoose(text) {
    const rawText = String(text ?? '');
    if (!rawText.trim()) return { ok: false, notes: [] };
    const notes = [];
    let t = rawText.replace(/^\uFEFF/, '').trim();

    // 防 JSON 劫持前缀：while(1); / for(;;); / )]}',
    const guard = /^(?:while\s*\(\s*1\s*\)\s*;|for\s*\(\s*;\s*;\s*\)\s*;|\)\]\}',?)\s*/.exec(t);
    if (guard) { t = t.slice(guard[0].length).trim(); notes.push('已去掉防劫持前缀'); }

    const p1 = tryParseJSON(t);
    if (p1.ok) return { ok: true, value: p1.value, notes };

    // JSONP 包裹：callback({ ... })
    const jsonp = /^[A-Za-z_$][\w$.]*\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/.exec(t);
    if (jsonp) {
      const p2 = tryParseJSON(jsonp[1]);
      if (p2.ok) { notes.push('已去掉 JSONP 回调包裹'); return { ok: true, value: p2.value, notes }; }
    }
    return { ok: false, error: p1.error || '不是合法 JSON', notes };
  }

  /** 把 {{变量}} 换成不含特殊字符的序号占位，解析完再还原（变量名可含 _ . - 等任意字符） */
  function maskVars(text) {
    const names = [];
    const masked = String(text ?? '').replace(/\{\{([^}]+)\}\}/g, (_m, n) => {
      names.push(String(n).trim());
      return '__APV' + (names.length - 1) + '__';
    });
    return { masked, names };
  }

  function unmaskVars(text, names) {
    if (!names || !names.length) return String(text ?? '');
    return String(text ?? '').replace(/__APV(\d+)__/g, (m, i) => {
      const n = names[Number(i)];
      return n === undefined ? m : '{{' + n + '}}';
    });
  }

  /* ---------------------------------------------------------------
     表单 / 查询串：k=v&k=v
     --------------------------------------------------------------- */
  function decodeFormPart(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); }
    catch (_) { return String(s); }
  }

  /** 是否像表单或查询串（≥2 对 k=v；纯 URL / JSON / XML 不算） */
  function looksLikeForm(text) {
    if (typeof text !== 'string') return false;
    let t = text.trim();
    if (!t) return false;
    // 完整 URL、JSON、XML 先排除
    if (/^[a-zA-Z][\w+.-]*:\/\//.test(t)) return false;
    if (/^[[{]/.test(t) || /^</.test(t)) return false;
    if (t.startsWith('?')) t = t.slice(1);
    if (!/^[^=&\s]+=/.test(t)) return false;
    if (!t.includes('&')) return false;
    const pairs = t.split('&').filter((p) => p !== '');
    if (pairs.length < 2) return false;
    // 每一对都必须是 k=v 或裸 key
    return pairs.every((p) => /^[^=&\s]*=/.test(p) || /^[^=&\s]+$/.test(p));
  }

  /** 解析表单串 → [{key, value, rawKey, rawVal, changed}]（值已 URL 解码） */
  function parseForm(text) {
    let t = String(text ?? '').trim();
    if (t.startsWith('?')) t = t.slice(1);
    return t.split('&').filter((p) => p !== '').map((pair) => {
      const i = pair.indexOf('=');
      const rawKey = i < 0 ? pair : pair.slice(0, i);
      const rawVal = i < 0 ? '' : pair.slice(i + 1);
      const key = decodeFormPart(rawKey);
      const value = decodeFormPart(rawVal);
      return { key, value, rawKey, rawVal, changed: value !== rawVal };
    });
  }

  /** 表单串 → 对齐的「key = value」，一行一个参数 */
  function formatForm(text, { annotateRaw = true } = {}) {
    const items = parseForm(text);
    if (!items.length) return '';
    const w = Math.max(...items.map((i) => i.key.length));
    return items.map((it) => {
      const pad = ' '.repeat(Math.max(0, w - it.key.length));
      const note = it.value === ''
        ? '   ← 空值'
        : (annotateRaw && it.changed ? `   ← 原始: ${it.rawVal}` : '');
      return `${it.key}${pad} = ${it.value}${note}`;
    }).join('\n');
  }

  /* ---------------------------------------------------------------
     智能美化：自动识别 JSON / 表单·查询串 / XML
     --------------------------------------------------------------- */
  function smartFormat(text) {
    const s = String(text ?? '');
    const t = s.trim();
    if (!t) return { ok: false, kind: 'none', error: '内容为空' };

    // 1) JSON（容错 BOM / JSONP / 防劫持前缀，且保留 {{变量}}）
    const { masked, names } = maskVars(t);
    const j = tryParseJSONLoose(masked);
    if (j.ok) {
      const out = unmaskVars(JSON.stringify(j.value, null, 2), names);
      return { ok: true, kind: 'json', text: out, notes: j.notes };
    }

    // 2) 表单 / 查询串
    if (looksLikeForm(t)) {
      const items = parseForm(t);
      return { ok: true, kind: 'form', text: formatForm(t), count: items.length, items };
    }

    // 3) XML / HTML
    if (/^<[!?a-zA-Z]/.test(t)) return { ok: true, kind: 'xml', text: formatXML(t) };

    return { ok: false, kind: 'text', error: j.error || '不能识别的格式（不是 JSON、表单参数或 XML）' };
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
    tryParseJSONLoose, maskVars, unmaskVars,
    looksLikeForm, parseForm, formatForm, smartFormat,
    copy, splitUrl, parseQuery, buildQuery, methodClass, cartesian
  };
})();
