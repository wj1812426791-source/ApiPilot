/* =========================================================================
   flow.js - 测试流程（Apifox 风格）
   - 左侧「测试流程」标签页：新建/重命名/删除/运行流程，支持文件夹集合
   - 流程编辑器：垂直步骤列表，支持从集合树拖拽请求加入
   - 魔棒：在任意输入框右侧读取前置步骤运行结果（response.body/headers/status）
   - 运行：依次执行步骤，自动用 {{$1.response.body.data.f_Id}} 等表达式传递数据
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
          showFlowMenu(f, e.clientX, e.clientY);
        });
        parent.appendChild(item);
      }
    }
  }

  function showFlowMenu(flow, x, y) {
    UI.contextMenu(x, y, [
      { label: '运行', action: () => { openFlow(flow.id); runFlow(); } },
      { label: '重命名', action: () => renameFlow(flow) },
      '-',
      { label: '删除', danger: true, action: () => deleteFlow(flow) }
    ]);
  }

  function showFolderMenu(folder, x, y) {
    UI.contextMenu(x, y, [
      { label: '新建流程', action: () => newFlow(folder) },
      { label: '重命名', action: () => renameFolder(folder) },
      '-',
      { label: '删除', danger: true, action: () => deleteFolder(folder) }
    ]);
  }

  async function newFlow(targetFolder = null) {
    const name = await UI.prompt('测试流程名称', '新建测试流程', { title: '新建测试流程' });
    if (!name) return;
    const flow = Store.newFlow(name);
    if (targetFolder && targetFolder.type === 'flowFolder') {
      targetFolder.items = targetFolder.items || [];
      targetFolder.items.push(flow);
      targetFolder.expanded = true;
    } else {
      Store.state.flows.push(flow);
    }
    Store.save();
    renderList();
    openFlow(flow.id);
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
    const container = U.el('div', { class: 'kv-table' });
    const o = Object.assign({ desc: true, fileType: false, kPlaceholder: '键', vPlaceholder: '值' }, opts || {});

    function render() {
      container.innerHTML = '';
      const head = U.el('div', { class: 'kv-head' }, [
        U.el('div', { class: 'kv-check' }),
        U.el('div', { class: 'kv-k', text: 'KEY' }),
        U.el('div', { class: 'kv-v', text: 'VALUE' }),
        o.desc ? U.el('div', { class: 'kv-d', text: '说明' }) : null,
        U.el('div', { class: 'kv-x' })
      ]);
      container.appendChild(head);

      const commit = () => { onChange(list); markDirty(); };

      const buildRow = (item, index, isPlaceholder) => {
        const row = U.el('div', { class: 'kv-row' + (isPlaceholder ? ' placeholder' : '') });

        const chk = U.el('input', { type: 'checkbox' });
        chk.checked = item.enabled !== false;
        chk.disabled = isPlaceholder;
        chk.addEventListener('change', () => { item.enabled = chk.checked; commit(); });
        row.appendChild(U.el('div', { class: 'kv-check' }, [chk]));

        const mkInput = (field, ph, useMagic) => {
          const inp = U.el('input', { type: 'text', value: item[field] ?? '', placeholder: ph, spellcheck: 'false' });
          inp.addEventListener('input', () => {
            item[field] = inp.value;
            if (isPlaceholder && (item.key || item.value)) {
              item.enabled = true;
              list.push(item);
              commit();
              render();
            } else {
              commit();
            }
          });
          if (useMagic) return wrapMagicInput(inp, flow, currentStepIndex, ph);
          return inp;
        };

        row.appendChild(U.el('div', { class: 'kv-k' }, [mkInput('key', o.kPlaceholder)]));

        const vCell = U.el('div', { class: 'kv-v', style: 'display:flex;align-items:center' });
        if (o.fileType && item.type === 'file') {
          vCell.appendChild(U.el('span', {
            style: 'flex:1;padding:0 9px;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5c5c5c',
            text: item.src || '未选择文件', title: item.src || ''
          }));
          vCell.appendChild(U.el('button', {
            class: 'kv-file-btn', text: '选择文件',
            onClick: async () => {
              const r = await window.api.openDialog({ properties: ['openFile'] });
              if (r.ok) { item.src = r.path; commit(); render(); }
            }
          }));
        } else {
          vCell.appendChild(mkInput('value', o.vPlaceholder, true));
        }
        if (o.fileType) {
          const sel = U.el('select', { class: 'kv-type-select' }, [
            U.el('option', { value: 'text', text: 'Text' }),
            U.el('option', { value: 'file', text: 'File' })
          ]);
          sel.value = item.type || 'text';
          sel.addEventListener('change', () => { item.type = sel.value; commit(); render(); });
          vCell.appendChild(sel);
        }
        row.appendChild(vCell);

        if (o.desc) row.appendChild(U.el('div', { class: 'kv-d' }, [mkInput('desc', '说明')]));

        row.appendChild(U.el('div', { class: 'kv-x' }, [
          isPlaceholder ? U.el('span') : U.el('button', {
            class: 'kv-del', text: '×', title: '删除这一行',
            onClick: () => { list.splice(index, 1); commit(); render(); }
          })
        ]));

        return row;
      };

      list.forEach((item, i) => container.appendChild(buildRow(item, i, false)));
      const ph = { key: '', value: '', desc: '', enabled: true, type: 'text' };
      container.appendChild(buildRow(ph, -1, true));
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

    const pathInput = U.el('input', { type: 'text', class: 'input mono', value: jsonPath, placeholder: '如 data.f_Id' });
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
            const expr = `{{$${stepIdx + 1}.${source}${jsonPath ? '.' + jsonPath : ''}}}`;
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
     运行流程
     ------------------------------------------------------------------ */
  function renderFlowResult(result) {
    const box = U.$('#flowResult');
    if (!result) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = '';

    const head = U.el('div', { class: 'flow-result-head' }, [
      U.el('span', { text: result.ok ? '✅ 流程运行完成' : '❌ 流程运行失败', style: 'font-weight:600' }),
      U.el('span', { class: 'spacer' }),
      U.el('span', { class: 'muted-sm', text: `耗时 ${U.fmtTime(result.timeMs)}` })
    ]);
    box.appendChild(head);

    const list = U.el('div', { class: 'flow-result-list' });
    for (const stepRes of result.stepResults || []) {
      const st = stepRes.response || {};
      const ok = !st.error && st.status && st.status < 400;
      const item = U.el('div', { class: 'flow-result-item' + (ok ? ' ok' : ' err') }, [
        U.el('span', { class: 'node-method ' + U.methodClass(stepRes.method), text: stepRes.method }),
        U.el('span', { class: 'flow-result-name', text: stepRes.name }),
        U.el('span', { class: 'spacer' }),
        U.el('span', { text: st.error ? '异常' : `${st.status || '-'} ${st.statusText || ''}` }),
        U.el('span', { class: 'muted-sm', text: U.fmtTime(st.timeMs) })
      ]);
      list.appendChild(item);
    }
    box.appendChild(list);
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

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      UI.toast(`流程运行中… 第 ${i + 1}/${flow.steps.length} 步`, '', 1200);
      try {
        const { res, meta, config } = await Http.send(step, { env, ctx });
        const parsed = U.tryParseJSON(res.bodyText || '');
        const result = {
          stepId: step.id,
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
        ctx.stepResults.push(result);
        stepResults.push(result);
        FlowRuntime && FlowRuntime.setStepResult && FlowRuntime.setStepResult(step.id, result);
        if (res.error || !res.status || res.status >= 400) {
          renderFlowResult({ ok: false, timeMs: Date.now() - started, stepResults });
          UI.toast(`第 ${i + 1} 步失败：${res.error || res.status}`, 'err', 4000);
          return;
        }
      } catch (e) {
        const result = {
          stepId: step.id,
          name: step.name,
          method: step.method,
          response: { error: e.message || String(e) },
          meta: {}
        };
        stepResults.push(result);
        renderFlowResult({ ok: false, timeMs: Date.now() - started, stepResults });
        UI.toast(`第 ${i + 1} 步异常：${e.message || e}`, 'err', 4000);
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
    bind, renderList, renderCurrent, current, openFlow, runFlow, FlowRuntime
  };
})();
