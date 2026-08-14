/* =========================================================================
   vars.js - 变量解析引擎
   支持 {{变量名}}，优先级：环境变量 > 全局变量 > 内置动态变量
   ========================================================================= */
const Vars = (() => {

  const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

  function dynamic(name) {
    switch (name) {
      case '$timestamp': return String(Math.floor(Date.now() / 1000));
      case '$timestampMs': return String(Date.now());
      case '$isoTimestamp': return new Date().toISOString();
      case '$randomInt': return String(Math.floor(Math.random() * 1000));
      case '$guid':
      case '$uuid':
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      case '$randomString': return Math.random().toString(36).slice(2, 10);
      default: return undefined;
    }
  }

  /** 收集当前作用域内所有变量（含 token） */
  function scope(env) {
    const map = new Map();
    for (const v of Store.state.globals || []) {
      if (v.enabled !== false && v.key) map.set(v.key, v.value ?? '');
    }
    const e = env !== undefined ? env : Store.activeEnv();
    if (e) {
      for (const v of e.variables || []) {
        if (v.enabled !== false && v.key) map.set(v.key, v.value ?? '');
      }
      if (e.token && e.token.value) {
        map.set('token', e.token.value);
        map.set('$token', e.token.value);
        // 带前缀的完整认证串
        map.set('authorization', (e.login?.prefix || '') + e.token.value);
      }
    }
    return map;
  }

  /** 按路径从流程步骤结果中提取值 */
  function resolveStepValue(name, ctx) {
    // 支持写法（body 查询无需写 response.body 前缀，普通查询即可）：
    //   $1                              -> 整个步骤结果
    //   $1.data.f_Id                    -> body 路径（无前缀，默认查 body）
    //   $1.response.body.data.f_Id      -> body 路径（旧写法，向后兼容）
    //   $1.headers.x-request-id         -> 响应头（短前缀）
    //   $1.response.headers.x-request-id -> 响应头（旧写法，向后兼容）
    //   $1.status / $1.response.status  -> 状态码
    if (!ctx || !ctx.stepResults) return undefined;
    const m = /^\$(\d+)(.*)$/.exec(name);
    if (!m) return undefined;
    const idx = Number(m[1]) - 1;
    const result = ctx.stepResults[idx];
    if (!result) return undefined;
    let rest = m[2] || '';
    if (!rest) return result;
    const res = result.response || {};

    // 兼容旧写法的 .response 前缀
    if (rest.startsWith('.response')) rest = rest.slice('.response'.length);

    // 现在 rest 形如 .body.x / .headers.x / .status / .data.f_Id
    if (rest === '.status' || rest === '.statusCode') return String(res.status || '');
    if (rest.startsWith('.headers')) {
      const p = rest.slice('.headers'.length);
      if (!p) return res.headers || {};
      return U.getByPath(res.headers || {}, p.slice(1));
    }
    if (rest.startsWith('.body')) {
      const p = rest.slice('.body'.length);
      if (!p) return res.parsedBody !== undefined ? res.parsedBody : res.bodyText;
      const body = res.parsedBody !== undefined ? res.parsedBody : (U.tryParseJSON(res.bodyText || '').value || {});
      return U.getByPath(body, p.slice(1));
    }
    // 无前缀 -> 直接当作 body 路径查询（普通查询，无需写 response.body）
    if (rest.startsWith('.')) {
      const body = res.parsedBody !== undefined ? res.parsedBody : (U.tryParseJSON(res.bodyText || '').value || {});
      return U.getByPath(body, rest.slice(1));
    }
    return undefined;
  }

  /** 解析字符串中的变量，返回 { text, missing: [] } */
  function resolveDetail(text, env, ctx, depth = 0) {
    if (typeof text !== 'string' || text.indexOf('{{') < 0) {
      return { text: text ?? '', missing: [] };
    }
    const map = scope(env);
    const missing = [];
    let out = text.replace(VAR_RE, (full, rawName) => {
      const name = rawName.trim();
      if (name.startsWith('$')) {
        const val = resolveStepValue(name, ctx);
        if (val !== undefined) return String(val);
        missing.push(name);
        return full;
      }
      if (map.has(name)) return map.get(name);
      const dyn = dynamic(name);
      if (dyn !== undefined) return dyn;
      missing.push(name);
      return full;
    });
    // 支持变量值里再套变量，最多 5 层
    if (depth < 5 && out !== text && out.indexOf('{{') >= 0) {
      const next = resolveDetail(out, env, ctx, depth + 1);
      out = next.text;
      for (const m of next.missing) if (!missing.includes(m)) missing.push(m);
    }
    return { text: out, missing };
  }

  const resolve = (text, env, ctx) => resolveDetail(text, env, ctx).text;

  function resolveItems(items, env) {
    return (items || [])
      .filter((i) => i.enabled !== false && (i.key || i.value))
      .map((i) => ({ key: resolve(i.key, env), value: resolve(i.value ?? '', env) }));
  }

  /** 检查一段文本里的变量是否都能解析 */
  function check(text, env, ctx) {
    return resolveDetail(text, env, ctx).missing;
  }

  /** 生成 URL 高亮 HTML：已定义的变量绿底，未定义红底 */
  function highlightHtml(text, env, ctx) {
    const map = scope(env);
    return U.escapeHtml(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (full, name) => {
      const key = name.trim();
      let known = map.has(key) || dynamic(key) !== undefined;
      if (key.startsWith('$') && ctx && ctx.stepResults) {
        known = resolveStepValue(key, ctx) !== undefined;
      }
      return `<span class="${known ? 'var-ok' : 'var-bad'}">${full}</span>`;
    });
  }

  /** 返回可展示的变量清单 */
  function list(env) {
    const e = env !== undefined ? env : Store.activeEnv();
    const rows = [];
    for (const v of Store.state.globals || []) {
      if (v.key) rows.push({ scope: '全局', key: v.key, value: v.value, enabled: v.enabled !== false });
    }
    if (e) {
      for (const v of e.variables || []) {
        if (v.key) rows.push({ scope: e.name, key: v.key, value: v.value, enabled: v.enabled !== false });
      }
      if (e.token && e.token.value) {
        rows.push({ scope: '自动', key: 'token', value: e.token.value, enabled: true });
      }
    }
    return rows;
  }

  return { resolve, resolveDetail, resolveItems, check, highlightHtml, list, scope, resolveStepValue, VAR_RE };
})();
