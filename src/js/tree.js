/* =========================================================================
   tree.js - 左侧集合树 & 历史列表
   ========================================================================= */
const Tree = (() => {

  let filterText = '';
  let dragSrcId = null;

  // 复制/粘贴：会话内剪贴板（存深拷贝，不含运行态）
  let clipboard = null;
  // 键盘复制/粘贴的目标节点（点选集合树任意节点即选中）
  let selectedId = null;

  const isContainer = (node) => !!node && node.type !== 'request';

  /** 深拷贝并重新分配 id（避免与源节点 id 冲突；文件夹会递归） */
  function cloneWithNewIds(src) {
    const copy = U.clone(src);
    const reId = (n) => {
      n.id = U.uid(n.type === 'request' ? 'req' : n.type === 'folder' ? 'fld' : 'col');
      (n.items || []).forEach(reId);
    };
    reId(copy);
    return copy;
  }

  const caretSvg = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const folderSvg = '<svg viewBox="0 0 14 14" width="13" height="13" style="flex:none;color:#8a8a8a"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.2c.4 0 .8.2 1.1.5l.6.7h4.1A1.5 1.5 0 0 1 12 4.7v5.8A1.5 1.5 0 0 1 10.5 12h-8A1.5 1.5 0 0 1 1 10.5z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  const clockSvg = '<svg viewBox="0 0 14 14" width="10" height="10"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 3.6V7l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  function matches(node) {
    if (!filterText) return true;
    const t = filterText.toLowerCase();
    if ((node.name || '').toLowerCase().includes(t)) return true;
    if (node.type === 'request' && (node.url || '').toLowerCase().includes(t)) return true;
    if (node.items) return node.items.some(matches);
    return false;
  }

  function render() {
    const box = U.$('#tree');
    const empty = U.$('#collectionsEmpty');
    box.innerHTML = '';

    const cols = Store.state.collections.filter(matches);
    empty.hidden = Store.state.collections.length > 0;

    for (const col of cols) box.appendChild(renderNode(col, 0));
  }

  function renderNode(node, depth) {
    const wrap = U.el('div', { class: 'tree-node' });
    const isLeaf = node.type === 'request';
    const isOpenTab = Store.state.tabs.some(
      (t) => t.refId === node.id && t.id === Store.state.activeTabId
    );

    const row = U.el('div', {
      class: 'node-row' + (node.type === 'collection' ? ' is-collection' : '')
        + (isOpenTab ? ' selected' : '')
        + (selectedId === node.id ? ' kb-sel' : ''),
      style: `padding-left:${8 + depth * 13}px`,
      draggable: 'true',
      dataset: { id: node.id },
      'data-ctx': '1'
    });

    // 折叠箭头
    const caret = U.el('span', {
      class: 'node-caret' + (isLeaf ? ' leaf' : '') + (node.expanded ? ' open' : ''),
      html: caretSvg,
      onClick: (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        Store.save();
        render();
      }
    });
    row.appendChild(caret);

    if (isLeaf) {
      row.appendChild(U.el('span', {
        class: 'node-method ' + U.methodClass(node.method),
        text: (node.method || 'GET').slice(0, 6)
      }));
    } else if (node.type === 'folder') {
      row.appendChild(U.el('span', { html: folderSvg }));
    }

    row.appendChild(U.el('span', { class: 'node-name', text: node.name || node.url || '未命名请求', title: node.url || node.name }));

    // 未保存标记：编辑区改了但还没点「保存」，集合节点里还是旧数据
    if (isLeaf && Editor.isDirty(node.id)) {
      row.appendChild(U.el('span', {
        class: 'dirty-dot',
        title: '编辑区有未保存的修改（右键「复制为 cURL / 导出请求」会自动用编辑区的最新内容）'
      }));
    }

    // 定时任务徽标
    if (isLeaf && node.schedule && node.schedule.enabled) {
      const badge = U.el('span', {
        class: 'schedule-badge' + (node.schedule.running ? ' running' : ''),
        title: Scheduler.badgeTip(node)
      });
      badge.innerHTML = clockSvg + '<span>定时</span>';
      row.appendChild(badge);
    }

    const acts = U.el('div', { class: 'node-actions' });
    if (!isLeaf) {
      acts.appendChild(U.el('button', {
        class: 'node-act', text: '+', title: '新建请求',
        onClick: (e) => { e.stopPropagation(); addRequest(node); }
      }));
    }
    acts.appendChild(U.el('button', {
      class: 'node-act', text: '⋯', title: '更多',
      onClick: (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        showMenu(node, r.left, r.bottom + 4);
      }
    }));
    row.appendChild(acts);

    row.addEventListener('click', () => {
      select(node.id);
      if (isLeaf) Editor.openRequest(node.id);
      else { node.expanded = !node.expanded; Store.save(); render(); }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select(node.id);
      showMenu(node, e.clientX, e.clientY);
    });

    // 拖拽排序 / 移动
    row.addEventListener('dragstart', (e) => {
      dragSrcId = node.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      e.stopPropagation();
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSrcId || dragSrcId === node.id) return;
      e.preventDefault();
      row.style.boxShadow = isLeaf ? 'inset 0 -2px 0 var(--orange)' : 'inset 0 0 0 1.5px var(--orange)';
    });
    row.addEventListener('dragleave', () => { row.style.boxShadow = ''; });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.style.boxShadow = '';
      handleDrop(dragSrcId, node);
      dragSrcId = null;
    });

    wrap.appendChild(row);

    if (!isLeaf && node.expanded) {
      const kids = (node.items || []).filter(matches);
      for (const child of kids) wrap.appendChild(renderNode(child, depth + 1));
      if (!kids.length) {
        wrap.appendChild(U.el('div', {
          style: `padding:4px 0 4px ${8 + (depth + 1) * 13 + 19}px;font-size:11.5px;color:#a8a8aa;`,
          text: '空'
        }));
      }
    }
    return wrap;
  }

  function handleDrop(srcId, targetNode) {
    if (!srcId || srcId === targetNode.id) return;
    // 不允许把父节点拖进自己的子孙
    let isDescendant = false;
    const src = Store.findNode(srcId);
    if (!src) return;
    Store.walk([src.node], (n) => { if (n.id === targetNode.id) { isDescendant = true; return false; } });
    if (isDescendant) return;

    const moved = Store.removeNode(srcId);
    if (!moved) return;

    if (targetNode.type === 'request') {
      const t = Store.findNode(targetNode.id);
      if (t) t.siblings.splice(t.index + 1, 0, moved);
    } else {
      targetNode.items = targetNode.items || [];
      targetNode.items.push(moved);
      targetNode.expanded = true;
    }
    Store.save();
    render();
  }

  /* --------------------------- 菜单动作 --------------------------- */

  /** 选中集合树某个节点（仅高亮，供 Ctrl+C / Ctrl+V 定位目标） */
  function select(id) {
    selectedId = id;
    const box = U.$('#tree');
    if (!box) return;
    U.$$('.node-row', box).forEach((r) => r.classList.toggle('kb-sel', r.dataset.id === id));
  }

  function getSelected() {
    if (!selectedId) return null;
    return Store.findNode(selectedId) ? Store.findNode(selectedId).node : null;
  }

  /** 复制请求 / 文件夹（请求取编辑区最新草稿，避免复制到未保存的旧数据） */
  function copyNode(node) {
    if (!node) return false;
    const src = node.type === 'request' ? (Editor.liveReq(node) || node) : node;
    clipboard = { kind: src.type, name: src.name || '', data: U.clone(src) };
    UI.toast(`已复制${src.type === 'request' ? '请求' : '文件夹'}「${src.name || '未命名'}」，在目标集合右键或按 Ctrl+V 粘贴`, 'ok', 2800);
    return true;
  }

  /** 把剪贴板内容粘贴到目标节点（集合/文件夹 → 粘贴到其内部；请求 → 粘贴为其同级下一项） */
  function pasteTo(target) {
    if (!clipboard) { UI.toast('剪贴板是空的，先复制一个请求（Ctrl+C）', 'warn', 2600); return null; }
    if (!target) { UI.toast('请先在集合树里点选要粘贴到的集合或请求', 'warn', 2600); return null; }

    const copy = cloneWithNewIds(clipboard.data);

    if (target.type === 'request') {
      const hit = Store.findNode(target.id);
      if (!hit) return null;
      hit.siblings.splice(hit.index + 1, 0, copy);
      // 粘贴到请求旁边时，展开它的父级容器，保证能看到
      const parent = Store.findNode(target.id).parent;
      if (parent) parent.expanded = true;
    } else {
      target.items = target.items || [];
      target.items.push(copy);
      target.expanded = true;
    }

    Store.save();
    render();
    select(copy.id);

    const where = target.type === 'request' ? `「${target.name || '未命名'}」之后` : `「${target.name || '未命名'}」`;
    UI.toast(`已粘贴${copy.type === 'request' ? '请求' : '文件夹'}「${copy.name || '未命名'}」到 ${where}`, 'ok', 2400);
    return copy;
  }

  /** Ctrl+C：复制当前选中节点 */
  function copySelected() {
    const node = getSelected();
    if (!node) { UI.toast('先在集合树里点选一个请求或文件夹，再按 Ctrl+C', 'warn', 2600); return false; }
    return copyNode(node);
  }

  /** Ctrl+V：粘贴到当前选中节点 */
  function pasteSelected() {
    const node = getSelected();
    if (!node) { UI.toast('先在集合树里点选要粘贴到的集合或请求，再按 Ctrl+V', 'warn', 2600); return false; }
    return !!pasteTo(node);
  }

  const hasClipboard = () => !!clipboard;

  function showMenu(node, x, y) {
    const items = [];
    const isReq = node.type === 'request';

    if (!isReq) {
      items.push({ label: '新建请求', action: () => addRequest(node) });
      items.push({ label: '新建文件夹', action: () => addFolder(node) });
      items.push('-');
      items.push({
        label: '粘贴', shortcut: 'Ctrl+V', disabled: !clipboard,
        action: () => pasteTo(node)
      });
      items.push({
        label: node.type === 'collection' ? '复制集合' : '复制文件夹', shortcut: 'Ctrl+C',
        action: () => copyNode(node)
      });
      items.push('-');
    } else {
      items.push({ label: '打开', action: () => Editor.openRequest(node.id) });
      items.push({
        label: node.schedule && node.schedule.enabled ? '定时任务（设置中）…' : '定时任务…',
        action: () => Scheduler.open(Editor.liveReq(node))
      });
      items.push({
        label: '复制为 cURL',
        action: async () => {
          // 编辑区改的是草稿，集合节点要「保存」后才同步；这里取最新数据，避免复制出空内容
          const live = Editor.liveReq(node) || node;
          if (!(live.url || '').trim()) {
            UI.toast('这个请求还没有 URL，复制出来是空的（先在编辑区填好 URL）', 'warn', 4000);
            return;
          }
          const env = Store.activeEnv();
          await U.copy(Importer.toCurl(live, env));
          UI.toast(Editor.isDirty(node) ? '已复制 cURL（含编辑区未保存的修改）' : '已复制 cURL 到剪贴板', 'ok', 2400);
        }
      });
      items.push({ label: '导出请求…', action: () => Importer.exportRequest(Editor.liveReq(node) || node) });
      items.push('-');
      items.push({ label: '复制请求', shortcut: 'Ctrl+C', action: () => copyNode(node) });
      items.push({
        label: '粘贴到它后面', shortcut: 'Ctrl+V', disabled: !clipboard,
        action: () => pasteTo(node)
      });
      items.push('-');
      if (node.schedule && node.schedule.enabled) {
        items.push({
          label: '取消定时任务', danger: true,
          action: () => { Scheduler.cancel(node.id); UI.toast('已取消定时任务', 'ok'); }
        });
      }
    }
    items.push({ label: '重命名', action: () => rename(node) });
    items.push({ label: '创建副本', action: () => duplicate(node) });
    if (node.type === 'collection') {
      items.push({ label: '导出集合…', action: () => Importer.exportCollection(node) });
    }
    items.push('-');
    items.push({ label: '删除', danger: true, action: () => remove(node) });
    UI.contextMenu(x, y, items);
  }

  function addRequest(parent) {
    const req = Store.newRequest('新建请求');
    parent.items = parent.items || [];
    parent.items.push(req);
    parent.expanded = true;
    Store.save();
    render();
    Editor.openRequest(req.id);
  }

  function addFolder(parent) {
    const f = Store.newFolder();
    parent.items = parent.items || [];
    parent.items.push(f);
    parent.expanded = true;
    Store.save();
    render();
  }

  async function newCollection() {
    const name = await UI.prompt('集合名称', '新建集合', { title: '新建集合' });
    if (!name) return;
    const col = Store.newCollection(name);
    Store.state.collections.push(col);
    Store.save();
    render();
  }

  async function rename(node) {
    const name = await UI.prompt('名称', node.name, { title: '重命名' });
    if (!name) return;
    node.name = name;
    // 同步到已打开的标签页草稿，避免后续保存时旧名字覆盖新名字
    Store.state.tabs.forEach((t) => { if (t.refId === node.id) t.draft.name = name; });
    Store.save();
    render();
    Editor.renderTabs();
    if (Editor.currentRefId() === node.id) Editor.renderCurrent();
  }

  function duplicate(node) {
    // 请求：若有编辑区未保存的修改，副本按最新内容生成
    const src = node.type === 'request' ? (Editor.liveReq(node) || node) : node;
    const copy = cloneWithNewIds(src);
    copy.name = (src.name || node.name || '未命名') + ' 副本';
    if (node.type === 'collection') {
      Store.state.collections.push(copy);
    } else {
      const hit = Store.findNode(node.id);
      if (hit) hit.siblings.splice(hit.index + 1, 0, copy);
    }
    Store.save();
    render();
  }

  async function remove(node) {
    if (node.type === 'request' && node.schedule && node.schedule.enabled) {
      Scheduler.cancel(node.id);   // 删除前先停掉定时任务
    }
    const label = node.type === 'request' ? '请求' : node.type === 'folder' ? '文件夹' : '集合';
    const extra = node.items && node.items.length ? `\n它下面的 ${countLeaf(node)} 个请求会一起删除。` : '';
    const ok = await UI.confirm(`确定删除${label}「${node.name}」吗？${extra}`, { title: '删除确认', okText: '删除', danger: true });
    if (!ok) return;
    Store.removeNode(node.id);
    Editor.closeTabsByRef(node.id, collectIds(node));
    Store.save();
    render();
  }

  function countLeaf(node) {
    let n = 0;
    Store.walk([node], (x) => { if (x.type === 'request') n++; });
    return n;
  }

  function collectIds(node) {
    const ids = [];
    Store.walk([node], (x) => ids.push(x.id));
    return ids;
  }

  function setFilter(text) {
    filterText = (text || '').trim();
    render();
    renderHistory();
  }

  /* --------------------------- 历史 --------------------------- */
  function renderHistory() {
    const box = U.$('#historyList');
    box.innerHTML = '';
    const list = Store.state.history.filter((h) => {
      if (!filterText) return true;
      return (h.url || '').toLowerCase().includes(filterText.toLowerCase());
    });

    if (!list.length) {
      box.appendChild(U.el('div', { class: 'empty-hint', html: '<p>还没有请求记录</p>' }));
      return;
    }

    let lastDay = '';
    for (const h of list.slice(0, 120)) {
      const day = U.fmtDateTime(h.at).slice(0, 10);
      if (day !== lastDay) {
        lastDay = day;
        box.appendChild(U.el('div', { class: 'hist-day', text: day }));
      }
      const codeCls = h.status >= 500 ? 'm-delete' : h.status >= 400 ? 'm-delete'
        : h.status >= 300 ? 'm-put' : h.status ? 'm-get' : 'm-head';
      box.appendChild(U.el('div', {
        class: 'hist-item',
        title: h.url,
        onClick: () => Editor.openFromHistory(h)
      }, [
        U.el('span', { class: 'node-method ' + U.methodClass(h.method), text: h.method }),
        U.el('span', { class: 'hist-url', text: h.url }),
        U.el('span', { class: 'hist-code ' + codeCls, text: h.status ? String(h.status) : 'ERR' })
      ]));
    }

    box.appendChild(U.el('div', { style: 'padding:12px;text-align:center' }, [
      U.el('button', {
        class: 'mini-btn', text: '清空历史',
        onClick: async () => {
          if (await UI.confirm('确定清空全部请求历史？', { title: '清空历史', danger: true, okText: '清空' })) {
            Store.state.history = [];
            Store.save();
            renderHistory();
          }
        }
      })
    ]));
  }

  return {
    render, renderHistory, setFilter, newCollection, addRequest, addFolder,
    select, getSelected, copyNode, pasteTo, copySelected, pasteSelected, hasClipboard
  };
})();
