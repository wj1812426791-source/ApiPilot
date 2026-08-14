/* =========================================================================
   flow.js - 测试流程（Apifox 风格）
   - 左侧「测试流程」标签页：新建/重命名/删除/运行流程，支持文件夹集合
   - 流程编辑器：垂直步骤列表，支持从集合树拖拽请求加入
   - 魔棒：在任意输入框右侧读取前置步骤运行结果（response.body/headers/status）
   - 运行：依次执行步骤，自动用 {{$1.data.f_Id}} 等表达式传递数据（body 查询无需 response.body 前缀）
   ========================================================================= */
const Flow = (() => {

  let currentFlowId = null;
  let currentStepId = null;

  const caretSvg = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ------------------------------------------------------------------
     列表
     ------------------------------------------------------------------ */
  function renderList() {
    const box = U.$('#flowsList');
    const empty = U.$('#flowsEmpty');
    if (!box) return;
    box.innerHTML = '';
    const flows = Store.state.flows || [];
    const hasAny = flows.length > 0;
    empty.hidden = hasAny;

    // 新建按钮
    const head = U.el('div', { class: 'flows-head' }, [
      U.el('button', { class: 'btn primary sm', text: '+ 流程', onClick: () => newFlow() }),
      U.el('button', { class: 'btn sm', text: '+ 文件夹', onClick: () => newFlowFolder() })
    ]);
    box.appendChild(head);

    renderFlowItems(flows, box, 0);
  }

  function renderFlowItems(items, parent, depth) {
    for (const f of items || []) {
      if (f.type === 'flowFolder') {
        const wrap = U.el('div', { class: 'flow-folder' });
        const folderHead = U.el('div', {
          class: 'flow-folder-head',
          style: `padding-left:${8 + depth * 13}px`,
          onClick: () => { f.expanded = !f.expanded; Store.save(); renderList(); }
        }, [
          U.el('span', { class: 'flow-folder-caret' + (f.expanded ? ' open' : ''), html: caretSvg }),
          U.el('span', { class: 'flow-folder-name', text: f.name })
        ]);
        folderHead.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showFolderMenu(f, e.clientX, e.clientY);
        });
        wrap.appendChild(folderHead);
        if (f.expanded) {
          const kids = U.el('div', { class: 'flow-folder-children' });
          renderFlowItems(f.items, kids, depth + 1);
          if (!f.items || !f.items.length) {
            kids.appendChild(U.el('div', {
              class: 'flow-folder-empty',
              style: `padding-left:${8 + (depth + 1) * 13 + 19}px`,
              text: '空'
            }));
          }
          wrap.appendChild(kids);
        }
        parent.appendChild(wrap);
      } else {
        const isOpen = currentFlowId === f.id;
        const item = U.el('div', {
          class: 'flow-item' + (isOpen ? ' active' : ''),
          style: `padding-left:${8 + depth * 13}px`,
          title: f.name,
          onClick: () => openFlow(f.id)
        }, [
          U.el('span', { class: 'flow-item-name', text: f.name }),
          U.el('span', { class: 'flow-item-count', text: `${(f.steps || []).length} 步` })
        ]);
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showFlowMenu(f, e.clientX, e.clientY);
        });
        parent.appendChild(item);
      }
    }
  }

  function showFlowMenu(flow, x, y) {
    UI.contextMenu(x, y, [
      { label: '打开编辑', action: () => openFlow(flow.id) },
      { label: '运行', action: () => { openFlow(flow.id); runFlow(); } },
      { label: '改名字', action: () => renameFlow(flow) },
      { label: '移动到…', action: () => moveToDialog(flow) },
      '-',
      { label: '删除', danger: true, action: () => deleteFlow(flow) }
    ]);
  }

  // 收集所有流程文件夹，扁平化为下拉选项；excludeId 及其后代不会被列出（避免移动到自身/子文件夹）
  function collectFolderOptions(excludeId) {
    const opts = [];
    (function collect(items, depth) {
      for (const f of items || []) {
        if (f.type === 'flowFolder') {
          const isExcluded = f.id === excludeId;
          if (!isExcluded) {
            opts.push({ id: f.id, name: '　'.repeat(depth) + '📁 ' + f.name });
            collect(f.items, depth + 1);
          }
        }
      }
    })(Store.state.flows, 0);
    return opts;
  }

  async function moveToDialog(node) {
    const folderOptions = collectFolderOptions(node.id);
    const select = U.el('select', { class: 'input' }, [
      U.el('option', { value: '', text: '（根目录）' }),
      ...folderOptions.map((o) => U.el('option', { value: o.id, text: o.name }))
    ]);
    const loc = Store.findFlowParent(node.id);
    if (loc && loc.parent && loc.parent.type === 'flowFolder') {
      select.value = loc.parent.id;
    }
    const body = U.el('div', {}, [
      U.el('label', { class: 'field' }, [
        U.el('span', { class: 'field-label', text: '移动到上级文件夹' }), select
      ])
    ]);
    UI.open({
      title: '移动到 · ' + node.name,
      size: 'sm',
      body,
      footer: U.el('div', { style: 'display:flex;gap:9px' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', {
          class: 'btn primary', text: '确定',
          onClick: () => {
            const ok = Store.moveFlow(node.id, select.value || null);
            UI.close();
            if (ok) { Store.save(); renderList(); UI.toast('已移动到新位置', 'ok'); }
            else UI.toast('移动失败（目标不合法）', 'warn');
          }
        })
      ])
    });
  }

  function showFolderMenu(folder, x, y) {
    UI.contextMenu(x, y, [
      { label: '新建流程', action: () => newFlow(folder) },
      { label: '改名字', action: () => renameFolder(folder) },
      { label: '移动到…', action: () => moveToDialog(folder) },
      '-',
      { label: '删除', danger: true, action: () => deleteFolder(folder) }
    ]);
  }

  async function newFlow(defaultFolder = null) {
    const folderOptions = collectFolderOptions();

    const nameInput = U.el('input', { class: 'input', type: 'text', value: '新建测试流程', placeholder: '测试流程名称' });
    const folderSelect = U.el('select', { class: 'input' }, [
      U.el('option', { value: '', text: '（根目录）' }),
      ...folderOptions.map((o) => U.el('option', { value: o.id, text: o.name }))
    ]);
    if (defaultFolder && defaultFolder.type === 'flowFolder') folderSelect.value = defaultFolder.id;

    const body = U.el('div', {}, [
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '名称' }), nameInput]),
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '放入文件夹' }), folderSelect])
    ]);

    const submit = () => {
      const name = nameInput.value.trim();
      if (!name) { UI.toast('请输入流程名称', 'warn'); return; }
      const flow = Store.newFlow(name);
      const fid = folderSelect.value;
      if (fid) {
        const folder = Store.findFlow(fid);
        if (folder && folder.type === 'flowFolder') {
          folder.items = folder.items || [];
          folder.items.push(flow);
          folder.expanded = true;
        } else {
          Store.state.flows.push(flow);
        }
      } else {
        Store.state.flows.push(flow);
      }
      UI.close();
      Store.save();
      renderList();
      openFlow(flow.id);
    };

    UI.open({
      title: '新建测试流程',
      size: 'sm',
      body,
      footer: U.el('div', { style: 'display:flex;gap:9px' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', { class: 'btn primary', text: '创建', onClick: submit })
      ]),
      onMount: () => {
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 30);
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      }
    });
  }

  async function newFlowFolder() {
    const name = await UI.prompt('流程文件夹名称', '新建流程文件夹', { title: '新建流程文件夹' });
    if (!name) return;
    const folder = Store.newFlowFolder(name);
    Store.state.flows.push(folder);
    Store.save();
    renderList();
  }

  async function renameFlow(flow) {
    const name = await UI.prompt('测试流程名称', flow.name, { title: '重命名测试流程' });
    if (!name) return;
    flow.name = name;
    Store.save();
    renderList();
    Editor.renderTabs();
    if (currentFlowId === flow.id) U.$('#flowTitleInput').value = flow.name;
  }

  async function renameFolder(folder) {
    const name = await UI.prompt('流程文件夹名称', folder.name, { title: '重命名流程文件夹' });
    if (!name) return;
    folder.name = name;
    Store.save();
    renderList();
  }

  async function deleteFlow(flow) {
    const ok = await UI.confirm(`确定删除测试流程「${flow.name}」吗？`, { title: '删除测试流程', okText: '删除', danger: true });
    if (!ok) return;
    const parent = Store.findFlowParent(flow.id);
    if (parent) parent.items.splice(parent.index, 1);
    closeFlowTab(flow.id);
    Store.save();
    renderList();
  }

  async function deleteFolder(folder) {
    const count = countFlowsInFolder(folder);
    const extra = count ? `\n文件夹内的 ${count} 个测试流程会被一起删除。` : '';
    const ok = await UI.confirm(`确定删除流程文件夹「${folder.name}」吗？${extra}`, { title: '删除流程文件夹', okText: '删除', danger: true });
    if (!ok) return;
    const parent = Store.findFlowParent(folder.id);
    if (parent) parent.items.splice(parent.index, 1);
    collectFlowIds(folder).forEach(closeFlowTab);
    Store.save();
    renderList();
  }

  function countFlowsInFolder(folder) {
    let n = 0;
    for (const f of folder.items || []) {
      if (f.type === 'flowFolder') n += countFlowsInFolder(f);
      else n++;
    }
    return n;
  }

  function collectFlowIds(folder) {
    const ids = [];
    for (const f of folder.items || []) {
      if (f.type === 'flowFolder') ids.push(...collectFlowIds(f));
      else ids.push(f.id);
    }
    return ids;
  }

  /* ------------------------------------------------------------------
     标签页
     ------------------------------------------------------------------ */
  function current() {
    return Store.state.tabs.find((t) => t.id === Store.state.activeTabId && t.flowId) || null;
  }

  function openFlow(flowId) {
    const flow = Store.findFlow(flowId);
    if (!flow) return;
    const exist = Store.state.tabs.find((t) => t.flowId === flowId);
    if (exist) {
      Store.state.activeTabId = exist.id;
    } else {
      const tab = { id: U.uid('tab'), flowId, draft: U.clone(flow), dirty: false };
      Store.state.tabs.push(tab);
      Store.state.activeTabId = tab.id;
    }
    Store.save();
    Editor.renderTabs();
    renderCurrent();
  }

  function closeFlowTab(flowId) {
    Store.state.tabs = Store.state.tabs.filter((t) => t.flowId !== flowId);
    if (!Store.state.tabs.some((t) => t.id === Store.state.activeTabId)) {
      Store.state.activeTabId = Store.state.tabs.length ? Store.state.tabs[0].id : null;
    }
    Editor.renderTabs();
    renderCurrent();
  }

  /* ------------------------------------------------------------------
     流程编辑器渲染
     ------------------------------------------------------------------ */
  function renderCurrent() {
    const tab = current();
    const reqTab = Store.state.tabs.find((t) => t.id === Store.state.activeTabId && !t.flowId);

    U.$('#welcome').hidden = !!(tab || reqTab);
    U.$('#reqArea').hidden = !reqTab;
    U.$('#flowArea').hidden = !tab;

    if (!tab) {
      if (reqTab) Editor.renderCurrent();
      currentFlowId = null;
      return;
    }

    currentFlowId = tab.flowId;
    const flow = tab.draft;
    U.$('#flowTitleInput').value = flow.name || '';

    renderSteps(flow);
    renderFlowResult(null);
  }

  function renderSteps(flow) {
    const box = U.$('#flowSteps');
    box.innerHTML = '';
    const steps = flow.steps || [];
    U.$('#flowDropHint').hidden = steps.length > 0;

    steps.forEach((step, index) => {
      box.appendChild(renderStepCard(flow, step, index));
    });
  }

  function renderStepCard(flow, step, index) {
    const expanded = currentStepId === step.id;
    const steps = flow.steps || [];
    const card = U.el('div', {
      class: 'flow-step' + (expanded ? ' expanded' : ''),
      dataset: { id: step.id, index: String(index) }
    });

    const head = U.el('div', { class: 'flow-step-head' }, [
      U.el('div', { class: 'flow-step-sort' }, [
        U.el('button', {
          class: 'flow-sort-btn' + (index === 0 ? ' disabled' : ''),
          text: '↑', title: '上移',
          disabled: index === 0,
          onClick: (e) => { e.stopPropagation(); moveStep(flow, index, -1); }
        }),
        U.el('button', {
          class: 'flow-sort-btn' + (index === steps.length - 1 ? ' disabled' : ''),
          text: '↓', title: '下移',
          disabled: index === steps.length - 1,
          onClick: (e) => { e.stopPropagation(); moveStep(flow, index, 1); }
        })
      ]),
      U.el('span', { class: 'flow-step-num', text: String(index + 1) }),
      U.el('span', { class: 'node-method ' + U.methodClass(step.method), text: step.method }),
      U.el('span', { class: 'flow-step-name', text: step.name || '未命名步骤', title: step.url }),
      U.el('span', { class: 'spacer' }),
      U.el('button', {
        class: 'flow-step-edit', text: expanded ? '收起' : '编辑',
        onClick: () => { currentStepId = expanded ? null : step.id; renderSteps(flow); }
      }),
      U.el('button', {
        class: 'flow-step-del', text: '×', title: '删除步骤',
        onClick: () => { flow.steps.splice(index, 1); markDirty(); renderSteps(flow); }
      })
    ]);
    card.appendChild(head);

    if (expanded) {
      card.appendChild(renderStepDetail(flow, step, index));
    }

    return card;
  }

  function moveStep(flow, index, dir) {
    const steps = flow.steps;
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const [moved] = steps.splice(index, 1);
    steps.splice(newIndex, 0, moved);
    if (currentStepId === moved.id) { /* 保持展开状态 */ }
    markDirty();
    renderSteps(flow);
  }

  function renderStepDetail(flow, step, index) {
    const detail = U.el('div', { class: 'flow-step-detail' });

    // 名称
    const nameRow = U.el('div', { class: 'flow-detail-row' }, [
      U.el('label', { class: 'field inline' }, [
        U.el('span', { class: 'field-label', text: '步骤名称' }),
        U.el('input', {
          type: 'text', class: 'input', value: step.name || '',
          onInput: (e) => { step.name = e.target.value; markDirty(); }
        })
      ])
    ]);

    // URL
    const urlRow = U.el('div', { class: 'flow-detail-row' }, [
      U.el('label', { class: 'field inline full' }, [
        U.el('span', { class: 'field-label', text: 'URL' }),
        wrapMagicInput(U.el('input', {
          type: 'text', class: 'input mono', value: step.url || '', spellcheck: 'false',
          placeholder: '{{baseUrl}}/api/project',
          onInput: (e) => { step.url = e.target.value; markDirty(); syncUrlInput(e.target); }
        }), flow, index, 'URL')
      ])
    ]);

    // 参数
    const paramsPanel = U.el('div', { class: 'flow-detail-section' }, [
      U.el('div', { class: 'panel-caption', text: 'Query 参数' }),
      renderMagicKV(flow, index, step.params, { kPlaceholder: '参数名', vPlaceholder: '参数值' }, (list) => {
        step.params = list;
        markDirty();
      })
    ]);

    // 路径变量
    const pathPanel = U.el('div', { class: 'flow-detail-section' }, [
      U.el('div', { class: 'panel-caption', text: '路径变量' }),
      renderMagicKV(flow, index, step.pathVars, { kPlaceholder: '变量名', vPlaceholder: '值' }, (list) => {
        step.pathVars = list;
        markDirty();
      })
    ]);

    // Headers
    const headersPanel = U.el('div', { class: 'flow-detail-section' }, [
      U.el('div', { class: 'panel-caption', text: '请求头' }),
      renderMagicKV(flow, index, step.headers, { kPlaceholder: 'Header 名', vPlaceholder: 'Header 值' }, (list) => {
        step.headers = list;
        markDirty();
      })
    ]);

    // Body
    const bodyPanel = U.el('div', { class: 'flow-detail-section' }, [
      U.el('div', { class: 'panel-caption', text: 'Body' }),
      U.el('div', { class: 'body-modes' }, [
        renderBodyRadio(step, 'none', 'none'),
        renderBodyRadio(step, 'formdata', 'form-data'),
        renderBodyRadio(step, 'urlencoded', 'x-www-form-urlencoded'),
        renderBodyRadio(step, 'raw', 'raw'),
        step.body.mode === 'raw' ? (() => {
          const sel = U.el('select', {
            class: 'mini-select',
            onChange: (e) => { step.body.rawType = e.target.value; markDirty(); }
          }, [
            U.el('option', { value: 'application/json', text: 'JSON' }),
            U.el('option', { value: 'text/plain', text: 'Text' }),
            U.el('option', { value: 'application/xml', text: 'XML' })
          ]);
          sel.value = step.body.rawType || 'application/json';
          return sel;
        })() : null
      ]),
      renderBodyEditor(flow, index, step)
    ]);

    detail.appendChild(nameRow);
    detail.appendChild(urlRow);
    detail.appendChild(paramsPanel);
    detail.appendChild(pathPanel);
    detail.appendChild(headersPanel);
    detail.appendChild(bodyPanel);

    return detail;
  }

  function renderBodyRadio(step, value, label) {
    return U.el('label', {}, [
      U.el('input', {
        type: 'radio', name: 'bodyMode_' + step.id, value,
        checked: step.body.mode === value,
        onChange: () => { step.body.mode = value; markDirty(); renderCurrent(); }
      }),
      U.el('span', { text: label })
    ]);
  }

  function renderBodyEditor(flow, index, step) {
    const mode = step.body.mode || 'none';
    if (mode === 'none') {
      return U.el('div', { class: 'body-empty' }, [U.el('p', { text: '此请求没有 Body' })]);
    }
    if (mode === 'raw') {
      return wrapMagicInput(U.el('textarea', {
        class: 'code-area',
        spellcheck: 'false',
        placeholder: '{ "name": "项目 {{$randomString}}" }',
        text: step.body.raw || '',
        onInput: (e) => { step.body.raw = e.target.value; markDirty(); }
      }), flow, index, 'Body');
    }
    return renderMagicKV(flow, index, mode === 'formdata' ? step.body.formdata : step.body.urlencoded,
      { kPlaceholder: '键', vPlaceholder: '值', fileType: mode === 'formdata' },
      (list) => {
        if (mode === 'formdata') step.body.formdata = list;
        else step.body.urlencoded = list;
        markDirty();
      });
  }

  function syncUrlInput(input) {
    // 简单高亮
    // 实际流程中不需要像编辑器那样双向同步 params
  }

  function markDirty() {
    const tab = current();
    if (!tab) return;
    tab.dirty = true;
    Editor.renderTabs();
    Store.save();
  }

  /* ------------------------------------------------------------------
     魔棒：给输入框/表格值列加上前置结果引用能力
     ------------------------------------------------------------------ */
  function wrapMagicInput(input, flow, currentStepIndex, fieldLabel) {
    const wrap = U.el('div', { class: 'magic-input-wrap' });
    wrap.appendChild(input);
    const btn = U.el('button', {
      class: 'magic-btn', title: '读取前置步骤运行结果',
      onClick: () => openMagicPicker(input, flow, currentStepIndex, fieldLabel)
    }, [U.el('span', { text: '✨' })]);
    wrap.appendChild(btn);
    return wrap;
  }

  function renderMagicKV(flow, currentStepIndex, list, opts, onChange) {
    const container = U.el('div', { class: 'kv-groups' });
    const o = Object.assign({ desc: true, fileType: false, kPlaceholder: '键', vPlaceholder: '值' }, opts || {});

    const commit = () => { onChange(list); markDirty(); };

    function ensureShape(item) {
      if (item.value === undefined) item.value = '';
      if (item.enabled === undefined) item.enabled = true;
      if (item.multi === undefined) item.multi = false;
      if (!Array.isArray(item.candidates)) item.candidates = [];
      if (item.type === undefined) item.type = 'text';
      if (item.desc === undefined) item.desc = '';
    }

    function buildGroup(item, index, isPlaceholder) {
      ensureShape(item);
      const group = U.el('div', { class: 'kv-group' + (item.multi ? ' multi' : '') });

      /* ---- 头部：启用 / 键 / 单多选 / 说明 / 类型 / 删除 ---- */
      const head = U.el('div', { class: 'kv-group-head' });

      const chk = U.el('input', { type: 'checkbox' });
      chk.checked = item.enabled !== false;
      chk.disabled = isPlaceholder;
      chk.addEventListener('change', () => { if (isPlaceholder) return; item.enabled = chk.checked; commit(); });
      head.appendChild(U.el('div', { class: 'kv-check' }, [chk]));

      const keyInput = U.el('input', { type: 'text', class: 'kv-k-input input', value: item.key ?? '', placeholder: o.kPlaceholder, spellcheck: 'false' });
      const pushPlaceholder = () => { if (isPlaceholder) { list.push(item); return true; } return false; };
      keyInput.addEventListener('input', () => {
        item.key = keyInput.value;
        if (pushPlaceholder()) { commit(); render(); } else commit();
      });
      head.appendChild(keyInput);

      const fileType = o.fileType;
      const isFile = fileType && item.type === 'file';

      const toggle = U.el('div', { class: 'kv-mode-toggle' }, [
        U.el('button', {
          class: 'kv-mode-btn' + (!item.multi ? ' active' : ''), text: '◉ 单一',
          title: '单个值', disabled: isFile,
          onClick: () => { item.multi = false; commit(); render(); }
        }),
        U.el('button', {
          class: 'kv-mode-btn' + (item.multi ? ' active' : ''), text: '☑ 多选',
          title: '多个候选值，运行时逐个执行', disabled: isFile,
          onClick: () => {
            item.multi = true;
            if (!item.candidates.length) item.candidates.push({ value: item.value || '', checked: true });
            commit(); render();
          }
        })
      ]);
      head.appendChild(toggle);

      if (o.desc) {
        const descInput = U.el('input', { type: 'text', class: 'kv-d-input input', value: item.desc || '', placeholder: '说明' });
        descInput.addEventListener('input', () => { item.desc = descInput.value; if (pushPlaceholder()) { commit(); render(); } else commit(); });
        head.appendChild(descInput);
      }

      if (fileType) {
        const tSel = U.el('select', { class: 'kv-type-select' }, [
          U.el('option', { value: 'text', text: 'Text' }),
          U.el('option', { value: 'file', text: 'File' })
        ]);
        tSel.value = item.type || 'text';
        tSel.addEventListener('change', () => { item.type = tSel.value; commit(); render(); });
        head.appendChild(tSel);
      }

      head.appendChild(U.el('button', {
        class: 'kv-del', text: '×', title: '删除',
        onClick: () => { if (isPlaceholder) return; list.splice(index, 1); commit(); render(); }
      }));

      group.appendChild(head);

      /* ---- 主体：单值 / 多候选值 ---- */
      const bodyEl = U.el('div', { class: 'kv-group-body' });
      if (!item.multi) {
        if (isFile) {
          bodyEl.appendChild(U.el('div', { class: 'kv-single' }, [
            U.el('span', {
              style: 'flex:1;padding:0 4px;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5c5c5c',
              text: item.src || '未选择文件', title: item.src || ''
            }),
            U.el('button', {
              class: 'kv-file-btn', text: '选择文件',
              onClick: async () => {
                const r = await window.api.openDialog({ properties: ['openFile'] });
                if (r.ok) { item.src = r.path; commit(); render(); }
              }
            })
          ]));
        } else {
          const vInput = U.el('input', { type: 'text', class: 'input mono', value: item.value ?? '', placeholder: o.vPlaceholder, spellcheck: 'false' });
          vInput.addEventListener('input', () => { item.value = vInput.value; if (pushPlaceholder()) { commit(); render(); } else commit(); });
          bodyEl.appendChild(wrapMagicInput(vInput, flow, currentStepIndex, item.key || o.vPlaceholder));
        }
      } else {
        const candBox = U.el('div', { class: 'kv-candidates' });
        (item.candidates || []).forEach((cand, ci) => {
          const cRow = U.el('div', { class: 'kv-candidate' });
          const cSel = U.el('input', { type: 'checkbox', class: 'kv-cand-sel', title: '勾选后运行时执行一次' });
          cSel.checked = cand.checked !== false;
          cSel.addEventListener('change', () => { cand.checked = cSel.checked; commit(); });
          cRow.appendChild(cSel);
          const cInput = U.el('input', { type: 'text', class: 'input mono', value: cand.value ?? '', placeholder: '候选值 ' + (ci + 1), spellcheck: 'false' });
          cInput.addEventListener('input', () => { cand.value = cInput.value; commit(); });
          cRow.appendChild(wrapMagicInput(cInput, flow, currentStepIndex, item.key || o.vPlaceholder));
          cRow.appendChild(U.el('button', {
            class: 'kv-del', text: '×', title: '删除候选值',
            onClick: () => { item.candidates.splice(ci, 1); commit(); render(); }
          }));
          candBox.appendChild(cRow);
        });
        bodyEl.appendChild(candBox);
        bodyEl.appendChild(U.el('button', {
          class: 'kv-add-cand', text: '+ 添加候选值',
          onClick: () => { item.candidates.push({ value: '', checked: true }); commit(); render(); }
        }));
      }
      group.appendChild(bodyEl);
      return group;
    }

    function render() {
      container.innerHTML = '';
      list.forEach((item, i) => container.appendChild(buildGroup(item, i, false)));
      const ph = { key: '', value: '', desc: '', enabled: true, multi: false, candidates: [], type: 'text' };
      container.appendChild(buildGroup(ph, -1, true));
    }

    render();
    return container;
  }

  /* ------------------------------------------------------------------
     魔棒选择器
     ------------------------------------------------------------------ */
  function openMagicPicker(input, flow, currentStepIndex, fieldLabel) {
    const prevSteps = (flow.steps || []).slice(0, currentStepIndex);
    if (!prevSteps.length) {
      UI.toast('当前步骤之前没有其他步骤，无法读取前置结果', 'warn');
      return;
    }

    let selectedStepIndex = prevSteps.length - 1;
    let source = 'response.body';
    let jsonPath = '';
    let previewValue = '';
    let parsedBody = null;

    const stepSelect = U.el('select', { class: 'input' },
      prevSteps.map((s, i) => U.el('option', { value: String(i), text: `${i + 1}. ${s.method} ${s.name}` }))
    );
    stepSelect.value = String(selectedStepIndex);

    const sourceSelect = U.el('select', { class: 'input' }, [
      U.el('option', { value: 'response.body', text: 'response.body' }),
      U.el('option', { value: 'response.headers', text: 'response.headers' }),
      U.el('option', { value: 'response.status', text: 'response.status' })
    ]);
    sourceSelect.value = source;

    const pathInput = U.el('input', { type: 'text', class: 'input mono', value: jsonPath, placeholder: '如 data.f_Id（body 查询无需前缀）' });
    const previewBox = U.el('div', { class: 'magic-preview', text: '（请先运行流程以产生结果，或手动填写 JSONPath）' });
    const treeBox = U.el('div', { class: 'json-browser-tree', hidden: true });

    function getStepResult() {
      const stepIdx = Number(stepSelect.value);
      const step = prevSteps[stepIdx];
      return FlowRuntime && FlowRuntime.getStepResult && FlowRuntime.getStepResult(step.id);
    }

    function updatePreview() {
      source = sourceSelect.value;
      jsonPath = pathInput.value.trim();
      previewValue = '';
      treeBox.innerHTML = '';
      treeBox.hidden = true;

      const last = getStepResult();
      if (!last) {
        previewBox.textContent = '暂无该步骤的运行结果，运行一次流程后可自动浏览 JSON 树。';
        return;
      }

      if (source === 'response.status') {
        previewValue = String(last.response.status || '');
        previewBox.textContent = previewValue;
        return;
      }
      if (source === 'response.headers') {
        const v = jsonPath ? U.getByPath(last.response.headers || {}, jsonPath) : last.response.headers;
        previewValue = v !== undefined ? String(v) : '';
        previewBox.textContent = previewValue || '(空)';
        return;
      }
      // response.body
      const body = last.response.parsedBody !== undefined ? last.response.parsedBody : (U.tryParseJSON(last.response.bodyText || '').value || {});
      parsedBody = body;
      const v = jsonPath ? U.getByPath(body, jsonPath) : body;
      previewValue = v !== undefined ? String(v) : '';
      previewBox.textContent = previewValue || '(空)';

      // 如果来源是 body 且是对象，渲染 JSON 树
      if (body && typeof body === 'object') {
        renderJsonTree(treeBox, body, pathInput, previewBox);
      }
    }

    const browseBtn = U.el('button', {
      class: 'btn sm', text: '📂 浏览',
      onClick: () => {
        const last = getStepResult();
        if (!last) { UI.toast('请先运行一次流程，才能浏览 JSON 树', 'warn'); return; }
        const body = last.response.parsedBody !== undefined ? last.response.parsedBody : (U.tryParseJSON(last.response.bodyText || '').value || {});
        if (!body || typeof body !== 'object') { UI.toast('响应体不是 JSON，无法浏览', 'warn'); return; }
        treeBox.hidden = !treeBox.hidden;
        browseBtn.textContent = treeBox.hidden ? '📂 浏览' : '📂 收起';
        if (!treeBox.hidden && !treeBox.childElementCount) {
          renderJsonTree(treeBox, body, pathInput, previewBox);
        }
      }
    });

    stepSelect.addEventListener('change', updatePreview);
    sourceSelect.addEventListener('change', updatePreview);
    pathInput.addEventListener('input', updatePreview);

    const body = U.el('div', { class: 'magic-picker' }, [
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '前置步骤' }), stepSelect]),
      U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '提取来源' }), sourceSelect]),
      U.el('label', { class: 'field' }, [
        U.el('span', { class: 'field-label', text: 'JSONPath' }),
        U.el('div', { style: 'display:flex;gap:8px' }, [pathInput, browseBtn])
      ]),
      treeBox,
      U.el('div', { class: 'panel-caption mt', text: '预览' }),
      previewBox
    ]);

    updatePreview();

    UI.open({
      title: '✨ 读取前置步骤运行结果 · ' + fieldLabel,
      size: 'md',
      body,
      footer: U.el('div', { style: 'display:flex;gap:9px' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => UI.close() }),
        U.el('button', {
          class: 'btn primary', text: '插入',
          onClick: () => {
            const stepIdx = Number(stepSelect.value);
            // body 查询无需写 response.body 前缀，直接采用普通路径；headers/status 用短前缀
            let expr;
            if (source === 'response.body') {
              expr = `{{$${stepIdx + 1}${jsonPath ? '.' + jsonPath : ''}}}`;
            } else if (source === 'response.headers') {
              expr = `{{$${stepIdx + 1}.headers${jsonPath ? '.' + jsonPath : ''}}}`;
            } else {
              expr = `{{$${stepIdx + 1}.status}}`;
            }
            insertAtCursor(input, expr);
            input.dispatchEvent(new Event('input'));
            UI.close();
          }
        })
      ])
    });
  }

  function insertAtCursor(input, text) {
    if (input.setSelectionRange) {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      input.value = before + text + after;
      input.selectionStart = input.selectionEnd = start + text.length;
      input.focus();
    } else {
      input.value += text;
    }
  }

  const treeToggleSvg = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderJsonTree(container, body, pathInput, previewBox) {
    container.innerHTML = '';

    function renderNode(key, value, path, depth) {
      const row = U.el('div', { class: 'json-tree-row', style: `padding-left:${depth * 16}px` });
      if (value && typeof value === 'object') {
        const isArray = Array.isArray(value);
        const kids = U.el('div', { class: 'json-tree-children' });
        let expanded = true;

        const toggle = U.el('span', {
          class: 'json-tree-toggle expanded',
          html: treeToggleSvg
        });
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          expanded = !expanded;
          kids.hidden = !expanded;
          toggle.classList.toggle('expanded', expanded);
        });

        row.appendChild(toggle);
        row.appendChild(U.el('span', { class: 'json-tree-key', text: `${key}: ` + (isArray ? `[${value.length}]` : '{...}') }));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          pathInput.value = path;
          pathInput.dispatchEvent(new Event('input'));
          if (previewBox) previewBox.textContent = JSON.stringify(value);
        });

        for (const [k, v] of Object.entries(value)) {
          const childPath = path ? path + '.' + k : k;
          kids.appendChild(renderNode(k, v, childPath, depth + 1));
        }

        const wrap = U.el('div', {});
        wrap.appendChild(row);
        wrap.appendChild(kids);
        return wrap;
      } else {
        row.appendChild(U.el('span', { class: 'json-tree-toggle leaf', html: treeToggleSvg }));
        row.appendChild(U.el('span', { class: 'json-tree-key', text: key + ': ' }));
        row.appendChild(U.el('span', { class: 'json-tree-val', text: JSON.stringify(value) }));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          pathInput.value = path;
          pathInput.dispatchEvent(new Event('input'));
          if (previewBox) previewBox.textContent = JSON.stringify(value);
        });
        return row;
      }
    }

    for (const [k, v] of Object.entries(body)) {
      container.appendChild(renderNode(k, v, k, 0));
    }
  }

  /* ------------------------------------------------------------------
     运行结果渲染（每个节点可展开查看响应）
     ------------------------------------------------------------------ */
  function runOkCheck(run) {
    const st = run.response || {};
    return !st.error && st.status && st.status < 400;
  }

  function runStatusText(run) {
    const st = run.response || {};
    return st.error ? '异常' : `${st.status || '-'} ${st.statusText || ''}`;
  }

  function stepStatusText(sr) {
    if (sr.runCount > 1) {
      const ok = sr.runs.filter(runOkCheck).length;
      return `${ok}/${sr.runCount} 成功`;
    }
    const st = (sr.runs[0] && sr.runs[0].response) || {};
    return st.error ? '异常' : `${st.status || '-'} ${st.statusText || ''}`;
  }

  function stepTime(sr) {
    const t = (sr.runs || []).reduce((a, r) => a + ((r.response && r.response.timeMs) || 0), 0);
    return U.fmtTime(t);
  }

  function renderRunDetail(run) {
    const wrap = U.el('div', { class: 'run-detail' });
    const st = run.response || {};

    wrap.appendChild(U.el('div', { class: 'run-status-line' }, [
      U.el('span', { class: 'run-method ' + U.methodClass(run.method), text: run.method }),
      U.el('span', { class: 'run-url mono', text: run.url || '', title: run.url || '' }),
      U.el('span', { class: 'spacer' }),
      U.el('span', {
        class: 'run-status ' + (st.error ? 'err' : (st.status < 400 ? 'ok' : 'err')),
        text: st.error ? ('异常: ' + st.error) : `${st.status} ${st.statusText || ''}`
      }),
      U.el('span', { class: 'muted-sm', text: U.fmtTime(st.timeMs) })
    ]));

    if (st.headers && Object.keys(st.headers).length) {
      wrap.appendChild(U.el('div', { class: 'run-sub' }, [
        U.el('div', { class: 'run-sub-label', text: '响应头' }),
        U.el('div', { class: 'sp-kv' },
          Object.entries(st.headers).map(([k, v]) => U.el('div', { text: `${k}: ${v}` })))
      ]));
    }

    const bWrap = U.el('div', { class: 'run-sub' }, [U.el('div', { class: 'run-sub-label', text: '响应体' })]);
    let bodyHtml;
    if (st.error) bodyHtml = U.escapeHtml(st.error);
    else if (st.parsedBody !== undefined) bodyHtml = U.highlightJSON(st.parsedBody);
    else bodyHtml = U.escapeHtml(st.bodyText || '');
    bWrap.appendChild(U.el('pre', { class: 'sp-pre code-hl', html: bodyHtml }));
    wrap.appendChild(bWrap);

    return wrap;
  }

  function renderFlowResult(result) {
    const box = U.$('#flowResult');
    if (!result) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';

    const totalRuns = (result.stepResults || []).reduce((n, s) => n + (s.runCount || 1), 0);
    const head = U.el('div', { class: 'flow-result-head' }, [
      U.el('span', { text: result.ok ? '✅ 流程运行完成' : '❌ 流程运行失败', style: 'font-weight:600' }),
      U.el('span', { class: 'spacer' }),
      U.el('span', { class: 'muted-sm', text: `${result.stepResults.length} 步 · ${totalRuns} 次请求 · 耗时 ${U.fmtTime(result.timeMs)}` })
    ]);
    box.appendChild(head);

    const list = U.el('div', { class: 'flow-result-list' });
    (result.stepResults || []).forEach((sr) => {
      const stepHeader = U.el('div', {
        class: 'flow-result-item ' + (sr.ok ? 'ok' : 'err') +
          (sr.runCount > 1 || (sr.runs && sr.runs[0]) ? ' expandable' : '')
      }, [
        U.el('span', { class: 'flow-result-caret', html: caretSvg }),
        U.el('span', { class: 'node-method ' + U.methodClass(sr.method), text: sr.method }),
        U.el('span', { class: 'flow-result-name', text: sr.name }),
        U.el('span', { class: 'spacer' }),
        sr.runCount > 1 ? U.el('span', { class: 'flow-run-count', text: `${sr.runCount} 次` }) : null,
        U.el('span', { text: stepStatusText(sr) }),
        U.el('span', { class: 'muted-sm', text: stepTime(sr) })
      ]);

      if (sr.runCount > 1) {
        const runsBox = U.el('div', { class: 'flow-result-runs', hidden: true });
        sr.runs.forEach((run, ri) => {
          const runRow = U.el('div', { class: 'flow-run-item ' + (runOkCheck(run) ? 'ok' : 'err') }, [
            U.el('span', { class: 'flow-run-caret', html: caretSvg }),
            U.el('span', { class: 'flow-run-idx', text: '#' + (ri + 1) }),
            U.el('span', { class: 'flow-run-url mono', text: run.url || '(无 URL)', title: run.url || '' }),
            U.el('span', { class: 'spacer' }),
            U.el('span', { text: runStatusText(run) }),
            U.el('span', { class: 'muted-sm', text: U.fmtTime((run.response || {}).timeMs) })
          ]);
          const detail = U.el('div', { class: 'flow-run-detail', hidden: true }, [renderRunDetail(run)]);
          runRow.addEventListener('click', () => { detail.hidden = !detail.hidden; });
          runsBox.appendChild(runRow);
          runsBox.appendChild(detail);
        });
        stepHeader.addEventListener('click', () => { runsBox.hidden = !runsBox.hidden; });
        list.appendChild(stepHeader);
        list.appendChild(runsBox);
      } else if (sr.runs && sr.runs[0]) {
        const detail = U.el('div', { class: 'flow-run-detail', hidden: true }, [renderRunDetail(sr.runs[0])]);
        stepHeader.addEventListener('click', () => { detail.hidden = !detail.hidden; });
        list.appendChild(stepHeader);
        list.appendChild(detail);
      } else {
        list.appendChild(stepHeader);
      }
    });
    box.appendChild(list);
  }

  /* ------------------------------------------------------------------
     运行流程（含多选参数批量执行）
     ------------------------------------------------------------------ */
  function buildStepIterations(step) {
    const groups = [];
    const lists = ['params', 'pathVars', 'urlencoded', 'formdata'];
    for (const name of lists) {
      const arr = step[name];
      if (!Array.isArray(arr)) continue;
      arr.forEach((item, index) => {
        if (item && item.multi && Array.isArray(item.candidates)) {
          const vals = item.candidates
            .filter((c) => c.checked !== false && c.value !== '')
            .map((c) => c.value);
          if (vals.length) groups.push({ name, index, vals });
        }
      });
    }
    if (!groups.length) return [U.clone(step)];
    const combos = U.cartesian(groups.map((g) => g.vals));
    return combos.map((combo) => {
      const cloned = U.clone(step);
      groups.forEach((g, k) => {
        const arr = cloned[g.name];
        if (arr && arr[g.index]) arr[g.index].value = combo[k];
      });
      return cloned;
    });
  }

  async function runFlow(flow) {
    if (!flow) {
      const tab = current();
      flow = tab && tab.draft;
    }
    if (!flow || !flow.steps || !flow.steps.length) {
      UI.toast('流程中没有步骤', 'warn');
      return;
    }

    const env = Store.activeEnv();
    const started = Date.now();
    const ctx = { stepResults: [] };
    const stepResults = [];

    renderFlowResult(null);

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const iterations = buildStepIterations(step);
      UI.toast(`流程运行中… 第 ${i + 1}/${flow.steps.length} 步` +
        (iterations.length > 1 ? `（${iterations.length} 次批量）` : ''), '', 1200);

      const runs = [];
      let stepOk = true;
      let last = null;

      for (const itStep of iterations) {
        try {
          const { res, meta, config } = await Http.send(itStep, { env, ctx });
          const parsed = U.tryParseJSON(res.bodyText || '');
          const run = {
            name: step.name,
            method: step.method,
            url: config && config.url,
            request: config,
            response: {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
              bodyText: res.bodyText,
              parsedBody: parsed.ok ? parsed.value : undefined,
              timeMs: res.timeMs,
              error: res.error
            },
            meta
          };
          runs.push(run);
          last = run;
          if (res.error || !res.status || res.status >= 400) stepOk = false;
        } catch (e) {
          const run = { name: step.name, method: step.method, response: { error: e.message || String(e) }, meta: {} };
          runs.push(run);
          last = run;
          stepOk = false;
        }
      }

      const sr = {
        stepId: step.id, name: step.name, method: step.method,
        multi: iterations.length > 1, runCount: runs.length, ok: stepOk, runs
      };
      ctx.stepResults.push(last);
      stepResults.push(sr);
      FlowRuntime && FlowRuntime.setStepResult(step.id, last);

      if (!stepOk) {
        renderFlowResult({ ok: false, timeMs: Date.now() - started, stepResults });
        UI.toast(`第 ${i + 1} 步失败`, 'err', 4000);
        return;
      }
    }

    renderFlowResult({ ok: true, timeMs: Date.now() - started, stepResults });
    UI.toast('流程运行完成', 'ok');
  }

  /* ------------------------------------------------------------------
     运行结果缓存（供魔棒浏览）
     ------------------------------------------------------------------ */
  const FlowRuntime = {
    cache: new Map(),
    setStepResult(stepId, result) { this.cache.set(stepId, result); },
    getStepResult(stepId) { return this.cache.get(stepId); }
  };

  /* ------------------------------------------------------------------
     事件绑定
     ------------------------------------------------------------------ */
  function bind() {
    U.$('#flowTitleInput').addEventListener('input', (e) => {
      const tab = current();
      if (!tab) return;
      tab.draft.name = e.target.value;
      markDirty();
    });

    U.$('#btnRunFlow').addEventListener('click', () => runFlow());

    U.$('#btnCreateFirstFlow').addEventListener('click', () => newFlow());

    // 流程区域拖拽接收集合请求
    const flowArea = U.$('#flowArea');
    if (flowArea) {
      flowArea.addEventListener('dragover', (e) => {
        const reqId = e.dataTransfer.getData('text/plain') || e.dataTransfer.types.includes('text/plain');
        if (reqId) e.preventDefault();
      });
      flowArea.addEventListener('drop', (e) => {
        e.preventDefault();
        const tab = current();
        if (!tab) return;
        const reqId = e.dataTransfer.getData('text/plain');
        const req = Store.findRequest(reqId);
        if (!req) return;
        const step = Store.newFlowStep(req);
        tab.draft.steps = tab.draft.steps || [];
        tab.draft.steps.push(step);
        markDirty();
        renderSteps(tab.draft);
        UI.toast('已添加步骤：' + step.name, 'ok');
      });
    }
  }

  return {
    bind, renderList, renderCurrent, current, openFlow, runFlow, buildStepIterations, FlowRuntime
  };
})();
