/* =========================================================================
   app.js - 应用入口与全局装配
   ========================================================================= */
const App = (() => {

  let tokenTimer = null;

  /* --------------------------- 顶栏 --------------------------- */
  function refreshEnvSelect() {
    const sel = U.$('#envSelect');
    sel.innerHTML = '';
    for (const env of Store.state.environments) {
      sel.appendChild(U.el('option', { value: env.id, text: env.name }));
    }
    sel.value = Store.state.activeEnvId || '';
    refreshTokenChip();
  }

  function refreshTokenChip() {
    const env = Store.activeEnv();
    const st = Auth.status(env);
    const chip = U.$('#tokenChip');
    chip.className = 'token-chip ' + (st.cls || '');
    U.$('#tokenChipText').textContent = st.text;
    chip.title = st.token
      ? `Token: ${st.token.slice(0, 60)}${st.token.length > 60 ? '…' : ''}\n点击打开环境登录配置`
      : '点击打开环境登录配置';
  }

  /* --------------------------- 分隔条 --------------------------- */
  function bindSplitters() {
    const sidebar = U.$('#sidebar');
    const splitV = U.$('#splitV');
    let dragging = false;

    splitV.addEventListener('mousedown', (e) => {
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    const resArea = U.$('#resArea');
    const splitH = U.$('#splitH');
    let draggingH = false;
    splitH.addEventListener('mousedown', (e) => {
      draggingH = true;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    // 定时任务日志面板常驻于请求区右侧（带分隔线），无需额外拖拽分隔条

    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        const w = Math.min(460, Math.max(190, e.clientX));
        sidebar.style.width = w + 'px';
        Store.state.ui.sidebarWidth = w;
      }
      if (draggingH) {
        const body = U.$('#workspaceBody').getBoundingClientRect();
        const h = Math.min(body.height - 160, Math.max(100, body.bottom - e.clientY));
        resArea.style.height = h + 'px';
        Store.state.ui.resHeightPx = h;
      }
    });

    document.addEventListener('mouseup', () => {
      if (dragging || draggingH) {
        dragging = draggingH = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        Store.save();
      }
    });
  }

  /* --------------------------- 快捷键 --------------------------- */
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const k = e.key.toLowerCase();

      if (k === 'enter') { e.preventDefault(); Editor.send(); }
      else if (k === 's') { e.preventDefault(); e.shiftKey ? Editor.saveAs() : Editor.save(); }
      else if (k === 'n') { e.preventDefault(); Editor.newTab(); }
      else if (k === 'w') {
        e.preventDefault();
        const t = Editor.current();
        if (t) Editor.closeTab(t.id);
      } else if (k === 'e') { e.preventDefault(); Env.openManager(); }
      else if (k === 'l') { e.preventDefault(); U.$('#urlInput').select(); }
      else if (k === 'f') { e.preventDefault(); U.$('#sideSearch').focus(); }
      else if (k === 'tab') {
        e.preventDefault();
        const tabs = Store.state.tabs;
        if (tabs.length < 2) return;
        const i = tabs.findIndex((t) => t.id === Store.state.activeTabId);
        const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        Store.state.activeTabId = next.id;
        Editor.renderTabs();
        Editor.renderCurrent();
      }
    });
  }

  /* --------------------------- 初始化 --------------------------- */
  async function init() {
    await Store.load();

    // UI 尺寸恢复
    if (Store.state.ui.sidebarWidth) U.$('#sidebar').style.width = Store.state.ui.sidebarWidth + 'px';
    if (Store.state.ui.resHeightPx) U.$('#resArea').style.height = Store.state.ui.resHeightPx + 'px';

    refreshEnvSelect();
    Tree.render();
    Tree.renderHistory();
    Editor.bind();
    Editor.renderTabs();
    Editor.renderCurrent();
    Response.bind();
    bindSplitters();
    bindShortcuts();
    Scheduler.init();   // 续期未过期的定时任务

    // 顶栏
    U.$('#envSelect').addEventListener('change', (e) => {
      Store.state.activeEnvId = e.target.value;
      Store.save();
      refreshTokenChip();
      Editor.renderAuth();
      Editor.renderAutoHeaders();
      Editor.syncUrlHighlight();
    });
    U.$('#btnEnvManage').addEventListener('click', () => Env.openManager());
    U.$('#tokenChip').addEventListener('click', () => Env.openManager(Store.state.activeEnvId, 'login'));
    U.$('#btnImport').addEventListener('click', () => Importer.importDialog());
    U.$('#btnExport').addEventListener('click', () => Importer.exportDialog());
    U.$('#btnSettings').addEventListener('click', showSettings);

    U.$$('[data-win]').forEach((btn) => {
      btn.addEventListener('click', () => window.api.windowControl(btn.dataset.win));
    });

    // 侧边栏
    U.$$('.side-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        U.$$('.side-tab').forEach((b) => b.classList.toggle('active', b === btn));
        U.$('#paneCollections').classList.toggle('active', btn.dataset.side === 'collections');
        U.$('#paneHistory').classList.toggle('active', btn.dataset.side === 'history');
        Store.state.ui.sideTab = btn.dataset.side;
        Store.save();
      });
    });
    U.$('#sideSearch').addEventListener('input', U.debounce((e) => Tree.setFilter(e.target.value), 180));
    U.$('#btnNewCollection').addEventListener('click', () => Tree.newCollection());
    U.$('#btnCreateFirst').addEventListener('click', () => Tree.newCollection());
    U.$('#btnWelcomeEnv').addEventListener('click', () => Env.openManager(Store.state.activeEnvId, 'login'));

    // 数据目录
    const info = await window.api.appInfo();
    const hint = U.$('#dataDirHint');
    hint.textContent = 'v' + info.version + ' · 数据目录';
    hint.title = info.dataDir;
    hint.addEventListener('click', () => window.api.openPath(info.dataDir));

    // Token 状态定时刷新（显示剩余时间）
    tokenTimer = setInterval(refreshTokenChip, 20000);

    // 自检模式
    if (window.apiFlags && window.apiFlags.selftest) {
      setTimeout(() => {
        SelfTest.run().catch((e) => {
          console.error('自检异常: ' + (e && e.stack || e));
          window.api.selftestDone({ total: 0, passed: 0, failed: 1, failures: [{ name: '自检脚本异常', detail: String(e) }] });
        });
      }, 300);
    }

    // 关闭前落盘
    window.addEventListener('beforeunload', () => {
      try { window.api.saveStore(JSON.parse(JSON.stringify(serializeNow()))); } catch (e) { /* ignore */ }
    });
  }

  function serializeNow() {
    return {
      version: 1,
      collections: Store.state.collections,
      environments: Store.state.environments,
      globals: Store.state.globals,
      activeEnvId: Store.state.activeEnvId,
      history: Store.state.history.slice(0, 200),
      ui: Store.state.ui,
      openTabs: Store.state.tabs.map((t) => ({ id: t.id, refId: t.refId, draft: t.draft, dirty: t.dirty })),
      activeTabId: Store.state.activeTabId
    };
  }

  function showSettings() {
    window.api.appInfo().then((info) => {
      const body = U.el('div');
      body.appendChild(U.el('div', { class: 'panel-caption', text: '运行信息' }));
      const t = U.el('table', { class: 'h-table' });
      const row = (k, v) => t.appendChild(U.el('tr', {}, [U.el('td', { text: k }), U.el('td', { text: v })]));
      row('版本', info.version);
      row('Electron', info.electron);
      row('Node', info.node);
      row('数据文件', info.storeFile);
      body.appendChild(t);

      body.appendChild(U.el('div', { class: 'panel-caption mt', text: '快捷键' }));
      const t2 = U.el('table', { class: 'h-table' });
      const row2 = (k, v) => t2.appendChild(U.el('tr', {}, [U.el('td', { text: k }), U.el('td', { text: v })]));
      row2('Ctrl + Enter', '发送请求');
      row2('Ctrl + S', '保存请求');
      row2('Ctrl + Shift + S', '另存为');
      row2('Ctrl + N', '新建请求');
      row2('Ctrl + W', '关闭当前标签');
      row2('Ctrl + E', '打开环境管理');
      row2('Ctrl + L', '选中地址栏');
      row2('Ctrl + F', '搜索集合');
      row2('Ctrl + Tab', '切换标签页');
      body.appendChild(t2);

      UI.open({
        title: '设置与信息', size: 'md', body,
        footer: U.el('div', { style: 'display:flex;gap:9px;width:100%' }, [
          U.el('button', {
            class: 'btn', text: '打开数据目录',
            onClick: () => window.api.openPath(info.dataDir)
          }),
          U.el('button', {
            class: 'btn', text: '清空 Cookie',
            onClick: async () => { await window.api.clearCookies(); UI.toast('Cookie 已清空', 'ok'); }
          }),
          U.el('div', { style: 'flex:1' }),
          U.el('button', { class: 'btn primary', text: '关闭', onClick: () => UI.close() })
        ])
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error(e);
      document.body.innerHTML =
        `<div style="padding:40px;font-family:var(--sans)">
           <h2 style="color:#d93a2b">启动失败</h2>
           <pre style="white-space:pre-wrap">${U.escapeHtml(e.stack || e.message || String(e))}</pre>
         </div>`;
    });
  });

  return { refreshEnvSelect, refreshTokenChip };
})();
