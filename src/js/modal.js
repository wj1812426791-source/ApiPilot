/* =========================================================================
   modal.js - 弹窗 / 确认框 / 输入框 / 右键菜单 / Toast
   ========================================================================= */
const UI = (() => {

  const root = () => U.$('#modalRoot');
  let stack = [];

  function open({ title, size = 'md', body, footer, onClose, onMount }) {
    const holder = root();
    const modal = U.el('div', { class: `modal ${size}` });

    const head = U.el('div', { class: 'modal-head' }, [
      U.el('h3', { text: title || '' }),
      U.el('button', { class: 'modal-close', text: '×', onClick: () => close() })
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

    holder.innerHTML = '';
    holder.appendChild(modal);
    holder.hidden = false;

    const entry = { modal, onClose };
    stack.push(entry);

    if (onMount) onMount(modal, bodyEl);
    return { modal, body: bodyEl, close };
  }

  function close() {
    const entry = stack.pop();
    const holder = root();
    holder.hidden = true;
    holder.innerHTML = '';
    if (entry && entry.onClose) entry.onClose();
  }

  function confirm(message, { title = '确认', okText = '确定', danger = false } = {}) {
    return new Promise((resolve) => {
      const foot = U.el('div', { style: 'display:flex;gap:9px;' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => { close(); resolve(false); } }),
        U.el('button', {
          class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText,
          onClick: () => { close(); resolve(true); }
        })
      ]);
      open({
        title, size: 'sm',
        body: `<div style="font-size:13px;line-height:1.8;">${U.escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
        footer: foot
      });
    });
  }

  function prompt(label, defaultValue = '', { title = '输入', placeholder = '' } = {}) {
    return new Promise((resolve) => {
      const input = U.el('input', { class: 'input', type: 'text', value: defaultValue, placeholder });
      const submit = () => { const v = input.value.trim(); close(); resolve(v || null); };
      const body = U.el('div', {}, [
        U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: label }), input])
      ]);
      const foot = U.el('div', { style: 'display:flex;gap:9px;' }, [
        U.el('button', { class: 'btn', text: '取消', onClick: () => { close(); resolve(null); } }),
        U.el('button', { class: 'btn primary', text: '确定', onClick: submit })
      ]);
      open({
        title, size: 'sm', body, footer: foot,
        onMount: () => {
          setTimeout(() => { input.focus(); input.select(); }, 30);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') { close(); resolve(null); }
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
      menu.appendChild(U.el('button', {
        class: 'ctx-item' + (item.danger ? ' danger' : ''),
        onClick: () => { hideContext(); item.action && item.action(); }
      }, [
        U.el('span', { text: item.label }),
        item.shortcut ? U.el('span', { class: 'sc', text: item.shortcut }) : null
      ]));
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

  return { open, close, confirm, prompt, toast, contextMenu, hideContext };
})();
