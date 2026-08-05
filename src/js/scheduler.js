/* =========================================================================
   scheduler.js - 请求定时任务（每个请求可独立定时发送）
   - 数据挂在该请求节点上：req.schedule = { enabled, intervalMin, intervalMs,
     durationMs, startedAt, nextRunAt, lastRunAt, runCount, running, log }
   - durationMs 为 Infinity 表示永久运行，直到手动取消
   - log：每次执行的发送/响应记录（最多保留 200 条）
   - 随 workspace.json 自动持久化，重启后未过期任务会自动续期
   - 点击「定时任务…」弹出一个**小弹窗（仅配置：发送间隔 / 持续时长 / 启停）**；
     每次执行的「发出的请求 + 服务器返回」实时显示在**请求设置右侧的常驻日志面板**
     中（带「清空」按钮，平时不隐藏），风格与响应区一致。
   ========================================================================= */
const Scheduler = (() => {

  const TICK_MS = 1000;
  const active = new Map();          // reqId -> req 节点（持有 schedule 引用）
  let masterTimer = null;
  let currentReqId = null;           // 当前打开了面板（右侧）的请求
  let panelBound = false;

  /* ------------------------------ 工具 ------------------------------ */
  function isFiniteDur(s) { return s && isFinite(s.durationMs); }

  function isExpired(s) {
    if (!s || !s.enabled) return true;
    if (!isFinite(s.durationMs)) return false;          // 永久运行
    return Date.now() - s.startedAt >= s.durationMs;
  }

  function isActive(req) { return !!req && !!(req.schedule && req.schedule.enabled); }

  function badgeTip(req) {
    const s = req.schedule;
    if (!s) return '定时任务';
    let dur;
    if (!isFinite(s.durationMs)) dur = '永久运行';
    else {
      const remMin = Math.max(0, Math.ceil((s.startedAt + s.durationMs - Date.now()) / 60000));
      dur = '剩余约 ' + remMin + ' 分钟';
    }
    const nextSec = Math.max(0, Math.ceil(((s.nextRunAt || Date.now()) - Date.now()) / 1000));
    return '定时任务：每 ' + s.intervalMin + ' 分钟发送一次\n' + dur +
      '\n已发送 ' + (s.runCount || 0) + ' 次' + (s.running ? '（发送中…）' : '') +
      '\n下次：约 ' + nextSec + ' 秒后\n右键可取消';
  }

  /* ------------------------------ 主循环 ------------------------------ */
  function ensureMaster() {
    if (masterTimer) return;
    masterTimer = setInterval(tick, TICK_MS);
  }

  async function tick() {
    const now = Date.now();
    let changed = false;
    for (const [reqId, req] of [...active]) {
      const s = req.schedule;
      if (!s || !s.enabled) { active.delete(reqId); continue; }

      if (isFinite(s.durationMs) && now - s.startedAt >= s.durationMs) {
        s.enabled = false; s.running = false;
        active.delete(reqId);
        changed = true;
        Store.save();
        UI.toast('定时任务已结束：' + req.name + '（共 ' + (s.runCount || 0) + ' 次）', 'ok');
        if (currentReqId === reqId) { renderConfig(req); renderLog(req); }
        continue;
      }

      updateBadge(req);
      if (currentReqId === reqId) updateStatus(req);   // 实时刷新面板状态
      if (s.running) continue;                          // 上一轮还没发完，跳过本次
      if (now >= (s.nextRunAt || 0)) {
        s.nextRunAt = now + s.intervalMs;
        fire(req);
      }
    }
    if (changed) Tree.render();
  }

  async function fire(req) {
    const s = req.schedule;
    if (!s || !s.enabled) return;
    s.running = true;
    s.lastRunAt = Date.now();
    s.runCount = (s.runCount || 0) + 1;
    updateBadge(req);

    let result;
    try {
      result = await Http.send(req);
    } catch (e) {
      result = { res: { error: (e && e.message) || String(e) }, meta: {} };
    }

    if (req.schedule) req.schedule.running = false;

    // 记录到日志
    const entry = makeEntry(req, result);
    s.log = s.log || [];
    s.log.push(entry);
    if (s.log.length > 200) s.log = s.log.slice(-200);
    if (currentReqId === req.id) { renderLog(req); updateStatus(req); }
    Store.save();

    updateBadge(req);

    const res = result.res || {};
    const ok = res && !res.error && res.status && res.status < 400;
    UI.toast('定时·' + req.name + ' #' + s.runCount + ' → ' + (res && res.error ? '异常' : (res.status || '-')),
      ok ? '' : 'bad');
  }

  /* ------------------------------ 启停控制 ------------------------------ */
  function start(req) {
    const s = req.schedule;
    if (!s || !s.enabled) return;
    if (isExpired(s)) {
      s.enabled = false;
      Store.save();
      Tree.render();
      return;
    }
    s.running = false;                          // 重启后清除可能残留的发送中标记
    active.set(req.id, req);
    if (!s.nextRunAt || s.nextRunAt <= Date.now()) s.nextRunAt = Date.now();
    ensureMaster();
    updateBadge(req);
    if (currentReqId === req.id) updateStatus(req);
  }

  function stop(reqId, persist) {
    const req = Store.findRequest(reqId);
    if (req && req.schedule) req.schedule.enabled = false;
    active.delete(reqId);
    if (persist) Store.save();
    Tree.render();
  }

  function cancel(reqId) {
    stop(reqId, true);
    const req = Store.findRequest(reqId);
    if (currentReqId === reqId && req) { renderConfig(req); renderLog(req); }
  }

  /** 启动时调用：扫描所有请求，续期未过期的定时任务 */
  function init() {
    bindPanelOnce();
    Store.walk(Store.state.collections, (node) => {
      if (node.type === 'request' && isActive(node)) start(node);
    });
  }

  /* ------------------------------ 面板（右侧常驻） ------------------------------ */
  function field(label, input) {
    return U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: label }), input]);
  }

  function open(req) {
    currentReqId = req.id;
    Editor.openRequest(req.id);                 // 打开该请求，editor 会刷新右侧日志面板

    const wrap = U.el('div', { class: 'sched-modal' });
    const config = U.el('div', { class: 'sp-config', id: 'spConfig' });
    wrap.appendChild(config);

    UI.open({
      title: '⏰ 定时任务 · ' + req.name,
      size: 'sm',
      body: wrap,
      onMount: () => {
        renderConfig(req);
        renderLog(req);   // 右侧常驻日志面板同步显示该请求的记录
      }
    });
  }

  function close() {
    UI.close();
    // 注意：不清除 currentReqId，关闭设置弹窗后右侧日志面板仍持续展示当前请求的记录
  }

  /* 右侧常驻日志面板：绑定清除按钮 + 切换请求时刷新 */
  function bindPanelOnce() {
    if (panelBound) return;
    panelBound = true;
    const clear = U.$('#spClearLog');
    if (clear) clear.addEventListener('click', () => {
      const r = currentReqId ? Store.findRequest(currentReqId) : null;
      if (r && r.schedule) r.schedule.log = [];
      if (r) { renderLog(r); Store.save(); }
      UI.toast('已清空执行日志', 'ok');
    });
  }

  function showLog(req) {
    currentReqId = req ? req.id : null;
    if (req) renderLog(req);
  }

  function renderConfig(req) {
    const root = U.$('#spConfig');
    if (!root) return;
    const cur = isActive(req) ? req.schedule : null;
    const intervalVal = cur ? cur.intervalMin : 5;
    const durationVal = cur ? (isFinite(cur.durationMs) ? Math.round(cur.durationMs / 60000) : 30) : 60;
    const permanent = cur ? !isFinite(cur.durationMs) : false;

    const intervalInput = U.el('input', { type: 'number', class: 'input small', min: '1', value: intervalVal });
    const durationInput = U.el('input', { type: 'number', class: 'input small', min: '1', value: durationVal, disabled: permanent });
    const permanentChk = U.el('input', { type: 'checkbox' });
    permanentChk.checked = permanent;
    permanentChk.addEventListener('change', () => { durationInput.disabled = permanentChk.checked; });

    const errEl = U.el('div', { class: 'form-error', hidden: true });
    const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; };
    const statusEl = U.el('div', { class: 'sp-status', id: 'spStatus' });

    const foot = U.el('div', { class: 'sp-config-foot' }, [
      U.el('button', {
        class: 'btn primary sm', text: cur ? '保存修改' : '开始定时',
        onClick: () => {
          const intervalMin = Number(intervalInput.value);
          if (!(intervalMin >= 1)) { showErr('发送间隔请填写 ≥ 1 的正整数'); return; }
          let durationMs = Infinity;
          if (!permanentChk.checked) {
            const durationMin = Number(durationInput.value);
            if (!(durationMin >= 1)) { showErr('持续时长请填写 ≥ 1 的正整数'); return; }
            durationMs = durationMin * 60000;
          }
          apply(req, intervalMin, durationMs, !!cur);
        }
      }),
      cur ? U.el('button', {
        class: 'btn danger sm', text: '停止并清除',
        onClick: () => { cancel(req.id); UI.toast('已停止定时任务', 'ok'); }
      }) : null
    ]);

    root.innerHTML = '';
    root.appendChild(U.el('div', { class: 'sched-form' }, [
      field('发送间隔（分钟）', intervalInput),
      field('持续时长（分钟）', durationInput),
      U.el('label', { class: 'switch-row' }, [
        permanentChk, U.el('span', { text: ' 永久运行（直到手动取消）' })
      ]),
      errEl,
      statusEl,
      foot
    ]));
    updateStatus(req);
  }

  function updateStatus(req) {
    const el = U.$('#spStatus');
    if (!el) return;
    const s = req.schedule;
    if (!s || !s.enabled) {
      el.className = 'sp-status stopped';
      el.textContent = '未运行';
      return;
    }
    const nextSec = Math.max(0, Math.ceil(((s.nextRunAt || Date.now()) - Date.now()) / 1000));
    let dur;
    if (!isFinite(s.durationMs)) dur = '永久运行';
    else {
      const remMin = Math.max(0, Math.ceil((s.startedAt + s.durationMs - Date.now()) / 60000));
      dur = '剩余约 ' + remMin + ' 分钟';
    }
    el.className = 'sp-status running';
    el.textContent = (s.running ? '发送中…  ' : '') + '每 ' + s.intervalMin + ' 分钟 · ' + dur +
      ' · 已发 ' + (s.runCount || 0) + ' 次 · 下次约 ' + nextSec + ' 秒';
  }

  function apply(req, intervalMin, durationMs, resume) {
    if (!req.schedule) req.schedule = {};
    if (!resume) req.schedule.log = [];                    // 新任务清空历史记录
    req.schedule.enabled = true;
    req.schedule.intervalMin = intervalMin;
    req.schedule.intervalMs = intervalMin * 60000;
    req.schedule.durationMs = durationMs;
    if (!resume) {
      req.schedule.startedAt = Date.now();
      req.schedule.runCount = 0;
      req.schedule.lastRunAt = 0;
    }
    req.schedule.nextRunAt = Date.now();
    req.schedule.running = false;
    Store.save();
    start(req);
    Tree.render();
    UI.toast('定时已开启：' + req.name + '（每 ' + intervalMin + ' 分钟）', 'ok');
    if (currentReqId === req.id) { renderConfig(req); renderLog(req); }
  }

  /* ------------------------------ 日志 ------------------------------ */
  function makeEntry(req, result) {
    const res = result.res || {};
    const cfg = result.config || {};
    let reqBody = '';
    const b = cfg.body || {};
    if (b.mode === 'raw') reqBody = b.text || '';
    else if (b.mode === 'urlencoded' || b.mode === 'formdata') {
      reqBody = (b.items || []).map((i) => i.key + '=' + i.value).join('&');
    }
    return {
      ts: Date.now(),
      method: cfg.method || req.method || 'GET',
      url: cfg.url || '',
      status: res.status || 0,
      statusText: res.statusText || '',
      timeMs: res.timeMs,
      size: res.decodedSize != null ? res.decodedSize : res.size,
      ok: !res.error && res.status && res.status < 400,
      error: res.error || '',
      reqHeaders: cfg.headers || {},
      reqBody,
      resHeaders: res.headers || {},
      resBody: res.bodyText || '',
      reloggedIn: !!(result.meta && result.meta.reloggedIn),
      retried: !!(result.meta && result.meta.reloggedIn && res.retriedAfterRelogin)
    };
  }

  function formatBody(text) {
    if (text == null) return '';
    const p = U.tryParseJSON(text);
    if (p.ok) return '<pre class="sp-pre">' + U.highlightJSON(p.value) + '</pre>';
    const esc = U.escapeHtml(String(text));
    return '<pre class="sp-pre">' + (esc.length > 4000 ? esc.slice(0, 4000) + '\n…(已截断)' : esc) + '</pre>';
  }

  function renderLog(req) {
    const box = U.$('#spLog');
    if (!box) return;
    const log = (req && req.schedule && req.schedule.log) || [];
    const countEl = U.$('#spLogCount');
    if (countEl) countEl.textContent = ((req && req.schedule && req.schedule.runCount) || 0) + ' 次';
    box.innerHTML = '';
    if (!log.length) {
      box.appendChild(U.el('div', {
        class: 'sp-empty',
        text: '暂无执行记录，开启后这里会实时显示每次发送的请求与服务器返回。'
      }));
      return;
    }
    for (let i = log.length - 1; i >= 0; i--) box.appendChild(renderEntry(log[i]));
  }

  function renderEntry(e) {
    const path = (e.url || '').replace(/^https?:\/\/[^/]+/, '') || e.url;
    let stCls = 'err';
    if (!e.error) {
      if (e.status < 300) stCls = 'ok';
      else if (e.status < 500) stCls = 'cli';
      else stCls = 'srv';
    }
    const stText = e.error ? '异常' : (e.status + ' ' + (e.statusText || '')).trim();

    const entry = U.el('div', { class: 'sp-entry' });
    const head = U.el('div', { class: 'sp-entry-head' }, [
      U.el('span', { class: 'sp-caret', text: '▸' }),
      U.el('span', { class: 'sp-method ' + U.methodClass(e.method), text: e.method }),
      U.el('span', { class: 'sp-path', text: path, title: e.url }),
      U.el('span', { class: 'sp-st ' + stCls, text: stText }),
      U.el('span', { class: 'sp-time', text: U.fmtRelative(e.ts) })
    ]);

    const detail = U.el('div', { class: 'sp-entry-detail' });
    detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '发出的请求' }));
    detail.appendChild(U.el('div', { class: 'sp-kv', text: e.method + ' ' + e.url }));
    detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '请求头' }));
    detail.appendChild(U.el('div', {
      class: 'sp-kv',
      text: Object.entries(e.reqHeaders || {}).map(([k, v]) => k + ': ' + v).join('\n') || '(无)'
    }));
    if (e.reqBody) {
      detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '请求体' }));
      const bd = U.el('div'); bd.innerHTML = formatBody(e.reqBody); detail.appendChild(bd);
    }

    detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '服务器返回' }));
    const meta = ['状态 ' + (e.error ? '异常' : (e.status + ' ' + (e.statusText || '')).trim())];
    if (e.timeMs) meta.push('耗时 ' + U.fmtTime(e.timeMs));
    if (e.size != null) meta.push('大小 ' + U.fmtBytes(e.size));
    if (e.reloggedIn) meta.push(e.retried ? '已重登并重发' : 'Token 已刷新');
    detail.appendChild(U.el('div', { class: 'sp-kv', text: meta.join('  ·  ') }));
    detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '响应头' }));
    detail.appendChild(U.el('div', {
      class: 'sp-kv',
      text: Object.entries(e.resHeaders || {})
        .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\n') || '(无)'
    }));
    detail.appendChild(U.el('div', { class: 'sp-sub-label', text: '响应体' }));
    const rb = U.el('div'); rb.innerHTML = formatBody(e.resBody); detail.appendChild(rb);

    head.addEventListener('click', () => entry.classList.toggle('open'));
    entry.appendChild(head);
    entry.appendChild(detail);
    return entry;
  }

  /* ------------------------------ 徽标刷新 ------------------------------ */
  function updateBadge(req) {
    const el = U.$('#tree .node-row[data-id="' + req.id + '"] .schedule-badge');
    if (el) {
      el.title = badgeTip(req);
      el.classList.toggle('running', !!(req.schedule && req.schedule.running));
    }
  }

  return { init, open, close, cancel, stop, badgeTip, isActive, renderConfig, renderLog, showLog };
})();
