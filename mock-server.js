/* =========================================================================
   mock-server.js - 本地演示后端
   用来体验 / 自测「登录取 Token → 自动携带 → 过期自动重登」全流程。
   启动： node mock-server.js  [端口，默认 8899]
   ========================================================================= */
'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.argv[2]) || 8899;
/** Token 有效期（秒）—— 故意设短，方便观察自动重登 */
const TTL = Number(process.env.MOCK_TTL || 60);

const tokens = new Map(); // token -> { user, expiresAt }

function json(res, code, data, extraHeaders) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }, extraHeaders || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function auth(req) {
  const raw = req.headers['authorization'] || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, reason: '缺少 Authorization 头' };
  const rec = tokens.get(token);
  if (!rec) return { ok: false, reason: 'Token 无效' };
  if (Date.now() > rec.expiresAt) return { ok: false, reason: 'Token 已过期' };
  return { ok: true, user: rec.user, token };
}

const USERS = [
  { id: 1, name: '王甲', role: 'admin', dept: '质量部' },
  { id: 2, name: '李乙', role: 'tester', dept: '质量部' },
  { id: 3, name: '张丙', role: 'dev', dept: '研发部' }
];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;
  const log = (msg) => console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${pathname}  ${msg}`);

  // ---------------------- 登录 ----------------------
  if (pathname === '/login' && req.method === 'POST') {
    const raw = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(raw); } catch (_) {
      payload = Object.fromEntries(new URLSearchParams(raw));
    }
    if (payload.username !== 'admin' || payload.password !== '123456') {
      log('登录失败');
      return json(res, 200, { code: 500, msg: '账号或密码错误', data: null });
    }
    const token = 'mock_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    tokens.set(token, { user: payload.username, expiresAt: Date.now() + TTL * 1000 });
    log(`登录成功，签发 Token（${TTL}s 有效）`);
    return json(res, 200, {
      code: 200,
      msg: '登录成功',
      data: { token, expires_in: TTL, username: payload.username }
    });
  }

  // ---------------------- 用户列表（需要 Token）----------------------
  if (pathname === '/api/user/list') {
    const a = auth(req);
    if (!a.ok) {
      log('鉴权失败：' + a.reason);
      return json(res, 401, { code: 401, msg: a.reason, data: null });
    }
    const pageNum = Number(u.searchParams.get('pageNum') || 1);
    const pageSize = Number(u.searchParams.get('pageSize') || 10);
    log('鉴权通过');
    return json(res, 200, {
      code: 200,
      msg: 'ok',
      data: { total: USERS.length, pageNum, pageSize, list: USERS.slice((pageNum - 1) * pageSize, pageNum * pageSize) }
    });
  }

  // ------------- 业务码型鉴权：HTTP 恒 200，靠 body.code 表示过期 -------------
  if (pathname === '/api/soft/profile') {
    const a = auth(req);
    if (!a.ok) {
      log('业务码鉴权失败：' + a.reason);
      return json(res, 200, { code: 401, msg: '登录已失效，请重新登录', data: null });
    }
    return json(res, 200, { code: 200, msg: 'ok', data: { user: a.user, time: new Date().toISOString() } });
  }

  // ---------------------- 其他工具接口 ----------------------
  if (pathname === '/api/echo') {
    const raw = await readBody(req);
    return json(res, 200, {
      code: 200,
      method: req.method,
      query: Object.fromEntries(u.searchParams),
      headers: req.headers,
      body: raw
    });
  }

  if (pathname === '/api/slow') {
    const ms = Number(u.searchParams.get('ms') || 2000);
    setTimeout(() => json(res, 200, { code: 200, msg: `延迟 ${ms}ms 后返回` }), ms);
    return;
  }

  if (pathname === '/api/status') {
    const code = Number(u.searchParams.get('code') || 200);
    return json(res, code, { code, msg: '按请求返回状态码 ' + code });
  }

  if (pathname === '/' ) {
    return json(res, 200, {
      name: 'ApiPilot Mock Server',
      ttlSeconds: TTL,
      endpoints: {
        'POST /login': '账号 admin / 密码 123456，返回 data.token',
        'GET  /api/user/list': '需要 Authorization: Bearer <token>，失效返回 HTTP 401',
        'GET  /api/soft/profile': 'HTTP 恒 200，失效时 body.code = 401',
        'ANY  /api/echo': '回显请求内容',
        'GET  /api/slow?ms=2000': '延迟响应',
        'GET  /api/status?code=500': '指定状态码'
      }
    });
  }

  json(res, 404, { code: 404, msg: '没有这个接口: ' + pathname });
});

server.listen(PORT, () => {
  console.log(`ApiPilot Mock Server 已启动: http://localhost:${PORT}`);
  console.log(`Token 有效期 ${TTL} 秒，账号 admin / 密码 123456`);
});
