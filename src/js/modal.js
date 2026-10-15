/* =========================================================================
   modal.js - 弹窗 / 确认框 / 输入框 / 右键菜单 / Toast
   ========================================================================= */
const UI = (() => {

  const root = () => U.$('#modalRoot');
  // 弹窗栈：每一层是独立 DOM 层，新弹窗叠加在旧弹窗之上（而不是把旧的替换掉）
  let stack = [];

  function open({ title, size = 'md', body, footer, onClose, onMount, replace = false }) {
    // replace：顶层入口用（工具栏按钮 / 快捷键），避免连按叠出多个同样的弹窗；
    // 从某个弹窗内部再开弹窗（如环境管理里点「新建环境」）不要用它，让它叠加在上面
    if (replace) closeAll();

    const holder = root();
    const modal = U.el('div', { class: `modal ${size}` });

    const closeBtn = U.el('button', { class: 'modal-close', text: '×' });
    const head = U.el('div', { class: 'modal-head' }, [
      U.el('h3', { text: title || '' }),
      closeBtn
    ]);

    const bodyEl = U.el('div', { class: 'modal-body' + (size === 'lg' ? ' flush' : '') });
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);

    modal.appendChild(head);
    modal.appendChild(bodyEl);

    if (footer) {
      const footEl = U.el('div', { class: 'modal-foot' });
      if (typeof footer === 'string') footEl.innerHTML = footer;
      else footEl.appendChild(footer);
      modal.appendChild(footEl);
    }

    // 每层一个 .modal-layer：铺满视口做居中 + 挡住下层交互，叠加而不是替换
    const layer = U.el('div', { class: 'modal-layer' });
    layer.appendChild(modal);
    holder.appendChild(layer);
    holder.hidden = false;

    const entry = { layer, modal, onClose, close: () => close(entry) };
    stack.push(entry);
    closeBtn.addEventListener('click', () => close(entry));

    if (onMount) onMount(modal, bodyEl);
    return { modal, body: bodyEl, close: entry.close };
  }

  /** 关闭指定弹窗；不传则关最上面那层（只关它，下层弹窗保持不动） */
  function close(entry) {
    const target = entry || stack[stack.length - 1];
    if (!target) return;
    const i = stack.indexOf(target);
    if (i < 0) return;                       // 已经关过了
    stack.splice(i, 1);
    if (target.layer && target.layer.parentNode) target.layer.parentNode.removeChild(target.layer);
    if (!stack.length) root().hidden = true;
    if (target.onClose) target.onClose();
  }

  /** 关闭全部弹窗（供需要"推倒重来"的场景使用） */
  function closeAll() {
    while (stack.length) close(stack[stack.length - 1]);
  }

  const depth = () => stack.length;

  function confirm(message, { title = '确认', okText = '确定', danger = false } = {}) {
    return new Promise((resolve) => {
      let h = null;
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        if (h) h.close();               // 只关这一层，下面被压住的弹窗（如环境管理）保持打开
        resolve(v);
      };
      const foot = U.el('div', { style: 'display:flex;gap:9px;' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => done(false) }),
        U.el('button', {
          class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText,
          onClick: () => done(true)
        })
      ]);
      h = open({
        title, size: 'sm',
        body: `<div style="font-size:13px;line-height:1.8;">${U.escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
        footer: foot
      });
    });
  }

  function prompt(label, defaultValue = '', { title = '输入', placeholder = '' } = {}) {
    return new Promise((resolve) => {
      let h = null;
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        if (h) h.close();               // 只关输入框这一层，下层的弹窗继续留着
        resolve(v);
      };
      const input = U.el('input', { class: 'input', type: 'text', value: defaultValue, placeholder });
      const submit = () => finish(input.value.trim() || null);
      const body = U.el('div', {}, [
        U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: label }), input])
      ]);
      const foot = U.el('div', { style: 'display:flex;gap:9px;' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => finish(null) }),
        U.el('button', { class: 'btn primary', text: '确定', onClick: submit })
      ]);
      h = open({
        title, size: 'sm', body, footer: foot,
        onMount: () => {
          setTimeout(() => { input.focus(); input.select(); }, 30);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              e.stopPropagation();      // 别让 Esc 冒泡到 document 把下层弹窗也一起关掉
              finish(null);
            }
          });
        }
      });
    });
  }

  /* ------------------------------ Toast ------------------------------ */
  function toast(message, type = '', ms = 2600) {
    const wrap = U.$('#toastWrap');
    const node = U.el('div', { class: 'toast ' + type, html: U.escapeHtml(message).replace(/\n/g, '<br>') });
    wrap.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .2s, transform .2s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 220);
    }, ms);
    return node;
  }

  /* --------------------------- 右键菜单 --------------------------- */
  function contextMenu(x, y, items) {
    const menu = U.$('#ctxMenu');
    menu.innerHTML = '';
    for (const item of items) {
      if (item === '-') {
        menu.appendChild(U.el('div', { class: 'ctx-sep' }));
        continue;
      }
      const btn = U.el('button', {
        class: 'ctx-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : ''),
        disabled: item.disabled ? 'disabled' : null,
        onClick: () => {
          if (item.disabled) return;          // 禁用项点了不关闭菜单，也不执行
          hideContext();
          item.action && item.action();
        }
      }, [
        U.el('span', { text: item.label }),
        item.shortcut ? U.el('span', { class: 'sc', text: item.shortcut }) : null
      ]);
      menu.appendChild(btn);
    }
    menu.hidden = false;
    // 边界修正
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function hideContext() {
    const menu = U.$('#ctxMenu');
    if (menu) menu.hidden = true;
  }

  document.addEventListener('click', hideContext);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('[data-ctx]')) hideContext();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContext();
      if (stack.length) close();
    }
  });

  return { open, close, closeAll, depth, confirm, prompt, toast, contextMenu, hideContext };
})();
