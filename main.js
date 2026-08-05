'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// 数据目录：按用户习惯放在 D 盘项目目录下，不污染 C:\Users\...\AppData
// 自检模式自动隔离到 data/selftest，绝不污染真实数据（防再次冲掉用户环境）
// ---------------------------------------------------------------------------
const IS_SELFTEST = process.argv.includes('--selftest');
const DATA_DIR = process.env.APIPILOT_DATA_DIR
  || (IS_SELFTEST ? path.join(__dirname, 'data', 'selftest') : path.join(__dirname, 'data'));
const STORE_FILE = path.join(DATA_DIR, 'workspace.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

// 若被 ELECTRON_RUN_AS_NODE 污染，electron 会退化成纯 Node，此时 app 为 undefined
if (!app || typeof app.whenReady !== 'function') {
  console.error(
    '[ApiPilot] 当前进程以纯 Node 模式运行（ELECTRON_RUN_AS_NODE 已设置），无法启动 Electron。\n' +
      '请在启动前执行:  set ELECTRON_RUN_AS_NODE=  （CMD） 或  unset ELECTRON_RUN_AS_NODE（bash）'
  );
  process.exit(1);
}

const NO_GPU = IS_SELFTEST || process.argv.includes('--no-gpu') || process.env.APIPILOT_NO_GPU === '1';

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  app.setPath('userData', path.join(DATA_DIR, 'chromium'));
} catch (e) {
  console.error('初始化数据目录失败:', e);
}

if (NO_GPU) {
  // 无显卡 / 沙箱环境下 GPU 进程会反复崩溃，自检时直接走软件渲染
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow = null;

// ---------------------------------------------------------------------------
// 简易 Cookie Jar：按 host 保存，供 session 型登录使用
// ---------------------------------------------------------------------------
const cookieJar = new Map(); // host -> Map(name -> {value, path, expires})

function storeCookies(host, setCookieHeaders) {
  if (!setCookieHeaders || !setCookieHeaders.length) return;
  if (!cookieJar.has(host)) cookieJar.set(host, new Map());
  const jar = cookieJar.get(host);
  for (const raw of setCookieHeaders) {
    const [pair, ...attrs] = String(raw).split(';');
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    let expires = 0;
    for (const a of attrs) {
      const [k, v] = a.split('=');
      const key = (k || '').trim().toLowerCase();
      if (key === 'max-age') expires = Date.now() + Number(v) * 1000;
      else if (key === 'expires' && !expires) expires = new Date(v).getTime() || 0;
    }
    if (value === '' || value === 'deleted') jar.delete(name);
    else jar.set(name, { value, expires });
  }
}

function buildCookieHeader(host) {
  const jar = cookieJar.get(host);
  if (!jar || !jar.size) return '';
  const now = Date.now();
  const parts = [];
  for (const [name, item] of jar.entries()) {
    if (item.expires && item.expires < now) {
      jar.delete(name);
      continue;
    }
    parts.push(`${name}=${item.value}`);
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// 判断响应是否为文本类型
// ---------------------------------------------------------------------------
const TEXT_HINTS = [
  'text/', 'json', 'xml', 'javascript', 'x-www-form-urlencoded',
  'yaml', 'csv', 'html', 'graphql', 'x-ndjson'
];

function isTextContent(contentType, buffer) {
  const ct = (contentType || '').toLowerCase();
  if (ct) {
    if (TEXT_HINTS.some((h) => ct.includes(h))) return true;
    if (ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/')) return false;
    if (ct.includes('octet-stream') || ct.includes('pdf') || ct.includes('zip')) return false;
  }
  // 无 content-type：抽样判断是否含有二进制字节
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const b of sample) {
    if (b === 0) return false;
  }
  return true;
}

function decompress(buffer, encoding) {
  const enc = (encoding || '').toLowerCase();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
    if (enc.includes('deflate')) return zlib.inflateSync(buffer);
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
  } catch (e) {
    try {
      if (enc.includes('deflate')) return zlib.inflateRawSync(buffer);
    } catch (_) { /* 忽略，返回原始数据 */ }
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// 构造请求体
// ---------------------------------------------------------------------------
function buildBody(body, headers) {
  const result = { buffer: null, contentType: null };
  if (!body || body.mode === 'none' || !body.mode) return result;

  if (body.mode === 'raw') {
    result.buffer = Buffer.from(body.text || '', 'utf8');
    result.contentType = body.contentType || 'text/plain';
    return result;
  }

  if (body.mode === 'urlencoded') {
    const parts = (body.items || [])
      .filter((i) => i.enabled !== false && i.key)
      .map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value ?? '')}`);
    result.buffer = Buffer.from(parts.join('&'), 'utf8');
    result.contentType = 'application/x-www-form-urlencoded';
    return result;
  }

  if (body.mode === 'formdata') {
    const boundary = '----ApiPilotFormBoundary' + Math.random().toString(16).slice(2);
    const chunks = [];
    for (const item of body.items || []) {
      if (item.enabled === false || !item.key) continue;
      if (item.type === 'file' && item.src) {
        let fileBuf;
        try {
          fileBuf = fs.readFileSync(item.src);
        } catch (e) {
          continue;
        }
        const filename = path.basename(item.src);
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${item.key}"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`, 'utf8'));
        chunks.push(fileBuf);
        chunks.push(Buffer.from('\r\n', 'utf8'));
      } else {
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${item.key}"\r\n\r\n${item.value ?? ''}\r\n`,
          'utf8'));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    result.buffer = Buffer.concat(chunks);
    result.contentType = `multipart/form-data; boundary=${boundary}`;
    return result;
  }

  if (body.mode === 'binary' && body.src) {
    try {
      result.buffer = fs.readFileSync(body.src);
      result.contentType = 'application/octet-stream';
    } catch (e) { /* 文件读取失败则不带 body */ }
    return result;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 核心：发送 HTTP 请求
// ---------------------------------------------------------------------------
function doRequest(config, redirectCount, startedAt) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(config.url);
    } catch (e) {
      return resolve({ error: `URL 无效: ${config.url}` });
    }
    if (!/^https?:$/.test(target.protocol)) {
      return resolve({ error: `不支持的协议: ${target.protocol}` });
    }

    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;

    // 头部规范化
    const headers = {};
    for (const [k, v] of Object.entries(config.headers || {})) {
      if (k && v !== undefined && v !== null) headers[k] = String(v);
    }

    const bodyInfo = buildBody(config.body, headers);
    const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (bodyInfo.buffer && bodyInfo.contentType && !hasCT) {
      headers['Content-Type'] = bodyInfo.contentType;
    }
    if (bodyInfo.buffer) {
      headers['Content-Length'] = Buffer.byteLength(bodyInfo.buffer);
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept')) {
      headers['Accept'] = '*/*';
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) {
      headers['User-Agent'] = 'ApiPilot/1.0.0';
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept-encoding')) {
      headers['Accept-Encoding'] = 'gzip, deflate, br';
    }

    // 自动附带 cookie
    if (config.useCookieJar !== false) {
      const cookie = buildCookieHeader(target.host);
      const hasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
      if (cookie && !hasCookie) headers['Cookie'] = cookie;
    }

    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: (config.method || 'GET').toUpperCase(),
      headers,
      rejectUnauthorized: config.ignoreSSL === false
    };

    const timeout = Number(config.timeout) > 0 ? Number(config.timeout) : 60000;
    let ttfb = 0;
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const req = lib.request(options, (res) => {
      ttfb = Date.now() - startedAt;
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        chunks.push(c);
        total += c.length;
        if (total > 50 * 1024 * 1024) { // 50MB 保护
          req.destroy();
        }
      });
      res.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        const setCookie = res.headers['set-cookie'] || [];
        if (config.useCookieJar !== false) storeCookies(target.host, setCookie);

        // 重定向处理
        const status = res.statusCode;
        const location = res.headers.location;
        if (config.followRedirect !== false && location && [301, 302, 303, 307, 308].includes(status)) {
          if (redirectCount >= 5) {
            return finish({ error: '重定向次数超过 5 次' });
          }
          let nextUrl;
          try {
            nextUrl = new URL(location, target).toString();
          } catch (e) {
            return finish({ error: `重定向地址无效: ${location}` });
          }
          const nextConfig = { ...config, url: nextUrl };
          if (status === 303 || ((status === 301 || status === 302) && options.method === 'POST')) {
            nextConfig.method = 'GET';
            nextConfig.body = { mode: 'none' };
            const h = { ...nextConfig.headers };
            for (const k of Object.keys(h)) {
              if (['content-type', 'content-length'].includes(k.toLowerCase())) delete h[k];
            }
            nextConfig.headers = h;
          }
          return doRequest(nextConfig, redirectCount + 1, startedAt).then((r) => {
            finish({ ...r, redirects: [{ from: config.url, to: nextUrl, status }, ...(r.redirects || [])] });
          });
        }

        const decoded = decompress(rawBuf, res.headers['content-encoding']);
        const contentType = res.headers['content-type'] || '';
        const textual = isTextContent(contentType, decoded);
        finish({
          status,
          statusText: res.statusMessage || '',
          headers: res.headers,
          setCookie,
          bodyText: textual ? decoded.toString('utf8') : '',
          bodyBase64: textual ? '' : decoded.toString('base64'),
          isBinary: !textual,
          size: rawBuf.length,
          decodedSize: decoded.length,
          timeMs: Date.now() - startedAt,
          ttfb,
          redirects: [],
          requestPreview: {
            url: config.url,
            method: options.method,
            headers,
            bodyPreview: bodyInfo.buffer
              ? (isTextContent(bodyInfo.contentType, bodyInfo.buffer)
                ? bodyInfo.buffer.toString('utf8').slice(0, 20000)
                : `<binary ${bodyInfo.buffer.length} bytes>`)
              : ''
          }
        });
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      finish({ error: `请求超时（${timeout}ms）`, timeMs: Date.now() - startedAt });
    });

    req.on('error', (err) => {
      let msg = err.message || String(err);
      if (err.code === 'ENOTFOUND') msg = `无法解析域名: ${target.hostname}`;
      else if (err.code === 'ECONNREFUSED') msg = `连接被拒绝: ${target.host}`;
      else if (err.code === 'ETIMEDOUT') msg = `连接超时: ${target.host}`;
      else if (String(err.code || '').includes('CERT')) msg = `证书校验失败（可在设置里开启"忽略 SSL 证书错误"）: ${err.message}`;
      finish({ error: msg, code: err.code, timeMs: Date.now() - startedAt });
    });

    if (bodyInfo.buffer) req.write(bodyInfo.buffer);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// IPC 注册
// ---------------------------------------------------------------------------
ipcMain.handle('http:send', async (_evt, config) => {
  const startedAt = Date.now();
  try {
    return await doRequest(config, 0, startedAt);
  } catch (e) {
    return { error: e.message || String(e), timeMs: Date.now() - startedAt };
  }
});

ipcMain.handle('cookie:clear', async (_evt, host) => {
  if (host) cookieJar.delete(host);
  else cookieJar.clear();
  return true;
});

ipcMain.handle('cookie:list', async () => {
  const out = [];
  for (const [host, jar] of cookieJar.entries()) {
    for (const [name, item] of jar.entries()) {
      out.push({ host, name, value: item.value, expires: item.expires });
    }
  }
  return out;
});

ipcMain.handle('store:load', async () => {
  try {
    const txt = await fsp.readFile(STORE_FILE, 'utf8');
    return { ok: true, data: JSON.parse(txt) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, data: null };
    return { ok: false, error: e.message };
  }
});

let saveTimer = null;
ipcMain.handle('store:save', async (_evt, data) => {
  try {
    const txt = JSON.stringify(data, null, 2);
    await fsp.writeFile(STORE_FILE + '.tmp', txt, 'utf8');
    await fsp.rename(STORE_FILE + '.tmp', STORE_FILE);
    // 每天保留一份备份
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const day = new Date().toISOString().slice(0, 10);
        await fsp.writeFile(path.join(BACKUP_DIR, `workspace-${day}.json`), txt, 'utf8');
      } catch (_) { /* 备份失败不影响主流程 */ }
    }, 5000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dialog:open', async (_evt, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, opts || {});
  if (res.canceled || !res.filePaths.length) return { ok: false };
  const file = res.filePaths[0];
  if (opts && opts.readAsText) {
    try {
      const content = await fsp.readFile(file, 'utf8');
      return { ok: true, path: file, content };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return { ok: true, path: file, paths: res.filePaths };
});

ipcMain.handle('dialog:save', async (_evt, opts) => {
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: opts.defaultPath });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    const data = opts.base64
      ? Buffer.from(opts.content, 'base64')
      : Buffer.from(opts.content || '', 'utf8');
    await fsp.writeFile(res.filePath, data);
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app:info', async () => ({
  version: app.getVersion(),
  dataDir: DATA_DIR,
  storeFile: STORE_FILE,
  electron: process.versions.electron,
  node: process.versions.node
}));

ipcMain.handle('app:openPath', async (_evt, target) => {
  await shell.openPath(target || DATA_DIR);
  return true;
});

ipcMain.on('window:control', (_evt, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  } else if (action === 'close') mainWindow.close();
});

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#f7f7f7',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: process.argv.filter((a) => a === '--selftest' || a === '--dev'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!IS_SELFTEST) mainWindow.show();
  });

  // 把渲染进程的日志转发到终端，方便排查
  mainWindow.webContents.on('console-message', (...args) => {
    let level, message, line, sourceId;
    if (args[0] && typeof args[0] === 'object' && 'message' in args[0]) {
      ({ level, message, lineNumber: line, sourceId } = args[0]);
    } else {
      [, level, message, line, sourceId] = args;
    }
    const isErr = level === 3 || level === 'error' || level === 2;
    if (isErr || process.argv.includes('--dev')) {
      console.log(`[renderer] ${message}  (${sourceId || ''}:${line || ''})`);
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (IS_SELFTEST) {
    let finished = false;
    ipcMain.on('selftest:done', (_e, payload) => {
      finished = true;
      console.log('SELFTEST_RESULT ' + JSON.stringify(payload));
      setTimeout(() => app.exit(payload && payload.failed ? 1 : 0), 200);
    });
    setTimeout(() => {
      if (!finished) {
        console.log('SELFTEST_TIMEOUT 自检在 120 秒内未回传结果');
        app.exit(2);
      }
    }, 120000);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('主进程未捕获异常:', err);
});
