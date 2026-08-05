/* =========================================================================
   env.js - 环境管理弹窗（变量 + 登录动作 + Token）
   ========================================================================= */
const Env = (() => {

  let selectedId = null;
  let activePane = 'vars';
  let bodyEl = null;

  function openManager(envId, pane) {
    selectedId = envId || Store.state.activeEnvId || (Store.state.environments[0] || {}).id;
    activePane = pane || 'vars';

    const layout = U.el('div', { class: 'env-layout' });
    UI.open({
      title: '环境管理', size: 'lg', body: layout,
      onClose: () => {
        Store.save();
        App.refreshEnvSelect();
        App.refreshTokenChip();
        Editor.renderAuth();
        Editor.renderAutoHeaders();
        Editor.syncUrlHighlight();
      },
      onMount: (modal, body) => { bodyEl = body; renderAll(layout); }
    });
  }

  function renderAll(layout) {
    layout.innerHTML = '';
    layout.appendChild(renderList());
    layout.appendChild(renderDetail());
  }

  const reRender = () => {
    const layout = bodyEl && bodyEl.querySelector('.env-layout');
    if (layout) renderAll(layout);
  };

  /* --------------------------- 左侧列表 --------------------------- */
  function renderList() {
    const box = U.el('div', { class: 'env-list' });
    const items = U.el('div', { class: 'env-list-items' });

    for (const env of Store.state.environments) {
      const st = Auth.status(env);
      items.appendChild(U.el('div', {
        class: 'env-item' + (env.id === selectedId ? ' active' : ''),
        onClick: () => { selectedId = env.id; reRender(); }
      }, [
        U.el('span', { class: 'env-dot' + (st.state === 'valid' ? ' on' : '') , title: st.text }),
        U.el('span', { class: 'env-name', text: env.name }),
        env.id === Store.state.activeEnvId
          ? U.el('span', { style: 'font-size:10px;color:var(--orange)', text: '当前' }) : null
      ]));
    }

    box.appendChild(items);
    box.appendChild(U.el('div', { class: 'env-list-foot' }, [
      U.el('button', {
        class: 'btn sm', style: 'width:100%', text: '+ 新建环境',
        onClick: async () => {
          const name = await UI.prompt('环境名称', '新环境', { title: '新建环境' });
          if (!name) return;
          const env = Store.newEnvironment(name);
          Store.state.environments.push(env);
          selectedId = env.id;
          Store.save();
          reRender();
        }
      }),
      U.el('button', {
        class: 'btn sm', style: 'width:100%;margin-top:6px', text: '↑ 导入环境…',
        title: '从 JSON 文件导入环境（支持单环境 / 完整备份包 / 裸数组）',
        onClick: async () => {
          const res = await Importer.importEnvironmentsFromFile();
          if (res) {
            selectedId = Store.state.environments[Store.state.environments.length - 1].id;
            reRender();
            UI.toast(`已导入 ${res.count} 个环境：${res.names.join('、')}`, 'ok', 3500);
          }
        }
      })
    ]));
    return box;
  }

  /* --------------------------- 右侧详情 --------------------------- */
  function renderDetail() {
    const env = Store.state.environments.find((e) => e.id === selectedId);
    const box = U.el('div', { class: 'env-detail' });

    if (!env) {
      box.appendChild(U.el('div', { class: 'env-empty', text: '左边选一个环境，或者新建一个' }));
      return box;
    }

    // 头部
    const nameInput = U.el('input', { class: 'input', type: 'text', value: env.name, style: 'max-width:260px' });
    nameInput.addEventListener('input', () => {
      env.name = nameInput.value;
      Store.save();
      const item = bodyEl.querySelector('.env-item.active .env-name');
      if (item) item.textContent = env.name;
    });

    const head = U.el('div', { class: 'env-detail-head' }, [
      nameInput,
      env.id === Store.state.activeEnvId
        ? U.el('span', { class: 'badge ok', text: '当前使用中' })
        : U.el('button', {
          class: 'btn sm', text: '设为当前环境',
          onClick: () => { Store.state.activeEnvId = env.id; Store.save(); App.refreshEnvSelect(); reRender(); }
        }),
      U.el('div', { style: 'flex:1' }),
      U.el('button', {
        class: 'btn sm', text: '导出',
        title: '导出该环境的变量与登录配置为 JSON 文件（不含运行时 Token）',
        onClick: () => Importer.exportEnvironment(env)
      }),
      U.el('button', {
        class: 'btn sm', text: '复制',
        onClick: () => {
          const copy = U.clone(env);
          copy.id = U.uid('env');
          copy.name = env.name + ' 副本';
          copy.token = Store.DEFAULT_TOKEN();
          Store.state.environments.push(copy);
          selectedId = copy.id;
          Store.save();
          reRender();
        }
      }),
      U.el('button', {
        class: 'btn sm danger', text: '删除',
        onClick: async () => {
          if (Store.state.environments.length <= 1) { UI.toast('至少保留一个环境', 'warn'); return; }
          if (!await UI.confirm(`确定删除环境「${env.name}」？`, { title: '删除环境', danger: true, okText: '删除' })) return;
          Store.state.environments = Store.state.environments.filter((e) => e.id !== env.id);
          if (Store.state.activeEnvId === env.id) Store.state.activeEnvId = Store.state.environments[0].id;
          selectedId = Store.state.environments[0].id;
          Store.save();
          App.refreshEnvSelect();
          reRender();
        }
      })
    ]);
    box.appendChild(head);

    // Tabs
    const tabs = U.el('div', { class: 'env-detail-tabs' });
    const mkTab = (key, label) => U.el('button', {
      class: 'env-tab' + (activePane === key ? ' active' : ''),
      text: label,
      onClick: () => { activePane = key; reRender(); }
    });
    tabs.appendChild(mkTab('vars', '变量'));
    tabs.appendChild(mkTab('login', '登录与 Token'));
    box.appendChild(tabs);

    box.appendChild(activePane === 'vars' ? renderVarsPane(env) : renderLoginPane(env));
    return box;
  }

  /* --------------------------- 变量 --------------------------- */
  function renderVarsPane(env) {
    const pane = U.el('div', { class: 'env-pane active' });
    pane.appendChild(U.el('div', { class: 'panel-caption', text: '环境变量（在任意输入框用 {{变量名}} 引用）' }));
    const table = U.el('div', { class: 'kv-table' });
    pane.appendChild(table);
    Editor.renderKV(table, env.variables, { kPlaceholder: '变量名', vPlaceholder: '值' }, () => Store.save());

    pane.appendChild(U.el('div', { class: 'panel-caption mt', text: '全局变量（所有环境共用）' }));
    const gt = U.el('div', { class: 'kv-table' });
    pane.appendChild(gt);
    Editor.renderKV(gt, Store.state.globals, { kPlaceholder: '变量名', vPlaceholder: '值' }, () => Store.save());

    pane.appendChild(U.el('div', {
      class: 'hint', style: 'margin-top:14px',
      html: '内置动态变量：<code>{{$timestamp}}</code> <code>{{$timestampMs}}</code> <code>{{$uuid}}</code> ' +
        '<code>{{$randomInt}}</code> <code>{{$randomString}}</code> <code>{{$isoTimestamp}}</code>；' +
        '登录成功后还可以直接用 <code>{{token}}</code>。'
    }));
    return pane;
  }

  /* --------------------------- 登录与 Token --------------------------- */
  function renderLoginPane(env) {
    const login = env.login || (env.login = Store.DEFAULT_LOGIN());
    const pane = U.el('div', { class: 'env-pane active' });

    const save = () => { Store.save(); App.refreshTokenChip(); };

    /* --- 总开关 --- */
    const enable = U.el('input', { type: 'checkbox' });
    enable.checked = !!login.enabled;
    enable.addEventListener('change', () => {
      login.enabled = enable.checked;
      save();
      reRender();
    });
    pane.appendChild(U.el('label', {
      class: 'switch-row',
      style: 'padding:2px 0 12px;font-size:13px;font-weight:600'
    }, [
      enable,
      U.el('span', { text: '启用登录动作（发请求时自动获取并携带 Token，过期自动重登）' })
    ]));

    if (!login.enabled) {
      pane.appendChild(U.el('div', {
        class: 'auth-note',
        html: '开启后：<br>' +
          '1. 每次发请求前检查 Token，没有或已过期就先调登录接口拿一个；<br>' +
          '2. 拿到的 Token 存在本地，重启软件也还在；<br>' +
          '3. 请求返回 401/403 时自动重新登录，并把原请求重发一次。'
      }));
      return pane;
    }

    /* --- 登录请求 --- */
    const sec1 = section('① 登录请求');
    const methodSel = U.el('select', { class: 'input' },
      ['POST', 'GET', 'PUT', 'PATCH'].map((m) => U.el('option', { value: m, text: m })));
    methodSel.value = login.method || 'POST';
    methodSel.addEventListener('change', () => { login.method = methodSel.value; save(); });

    const urlInput = U.el('input', {
      class: 'input mono', type: 'text', value: login.url || '',
      placeholder: '{{baseUrl}}/api/login', spellcheck: 'false'
    });
    urlInput.addEventListener('input', () => { login.url = urlInput.value; save(); });

    const row = U.el('div', { style: 'display:flex;gap:10px;align-items:flex-end;margin-bottom:12px' }, [
      U.el('label', { class: 'field', style: 'width:110px;margin:0' },
        [U.el('span', { class: 'field-label', text: '方法' }), methodSel]),
      U.el('label', { class: 'field', style: 'flex:1;margin:0' },
        [U.el('span', { class: 'field-label', text: '登录接口地址' }), urlInput])
    ]);
    sec1.body.appendChild(row);

    sec1.body.appendChild(U.el('div', { class: 'panel-caption', text: '请求头' }));
    const hTable = U.el('div', { class: 'kv-table', style: 'margin-bottom:12px' });
    sec1.body.appendChild(hTable);
    Editor.renderKV(hTable, login.headers, { desc: false, kPlaceholder: 'Header 名', vPlaceholder: '值' }, save);

    sec1.body.appendChild(U.el('div', { class: 'panel-caption', text: '请求体' }));
    const modeSel = U.el('select', { class: 'input', style: 'max-width:220px;margin-bottom:8px' }, [
      U.el('option', { value: 'raw', text: 'JSON (raw)' }),
      U.el('option', { value: 'urlencoded', text: 'x-www-form-urlencoded' }),
      U.el('option', { value: 'formdata', text: 'form-data' }),
      U.el('option', { value: 'none', text: '无 Body' })
    ]);
    modeSel.value = login.bodyMode || 'raw';
    modeSel.addEventListener('change', () => { login.bodyMode = modeSel.value; save(); reRender(); });
    sec1.body.appendChild(modeSel);

    if (login.bodyMode === 'raw') {
      const ta = U.el('textarea', {
        class: 'input mono', rows: 6, spellcheck: 'false',
        placeholder: '{\n  "username": "{{username}}",\n  "password": "{{password}}"\n}'
      });
      ta.value = login.bodyRaw || '';
      ta.addEventListener('input', () => { login.bodyRaw = ta.value; save(); });
      sec1.body.appendChild(ta);
    } else if (login.bodyMode === 'urlencoded' || login.bodyMode === 'formdata') {
      const bt = U.el('div', { class: 'kv-table' });
      sec1.body.appendChild(bt);
      login.bodyItems = login.bodyItems || [];
      Editor.renderKV(bt, login.bodyItems, {
        desc: false, fileType: login.bodyMode === 'formdata',
        kPlaceholder: '字段名', vPlaceholder: '值'
      }, save);
    }
    sec1.body.appendChild(U.el('div', {
      class: 'hint',
      html: '账号密码建议写成变量，比如 <code>{{username}}</code>，值放在「变量」标签页里，换环境不用改这里。'
    }));
    pane.appendChild(sec1.wrap);

    /* --- Token 提取 --- */
    const sec2 = section('② 从响应里取 Token');
    const tokenPath = U.el('input', {
      class: 'input mono', type: 'text', value: login.tokenPath || '',
      placeholder: '留空则自动识别，如 data.token', spellcheck: 'false'
    });
    tokenPath.addEventListener('input', () => { login.tokenPath = tokenPath.value; save(); });

    sec2.body.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '提取路径' }), tokenPath
    ]));
    sec2.body.appendChild(U.el('div', {
      class: 'hint', style: 'margin-top:-8px;margin-bottom:12px',
      html: '支持 <code>data.token</code>、<code>data.list[0].token</code>、' +
        '<code>header:Authorization</code>（从响应头取）、<code>cookie:JSESSIONID</code>（从 Cookie 取）。' +
        '留空时会自动在响应里找 token / access_token / jwt 之类的字段。'
    }));

    const injectSel = U.el('select', { class: 'input' }, [
      U.el('option', { value: 'header', text: '放进请求头' }),
      U.el('option', { value: 'query', text: '放进 URL 参数' })
    ]);
    injectSel.value = login.injectTo || 'header';
    injectSel.addEventListener('change', () => { login.injectTo = injectSel.value; save(); reRender(); });

    const grid = U.el('div', { class: 'grid3' });
    grid.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '注入位置' }), injectSel
    ]));

    if (login.injectTo === 'query') {
      const qn = U.el('input', { class: 'input mono', type: 'text', value: login.queryName || 'token' });
      qn.addEventListener('input', () => { login.queryName = qn.value; save(); });
      grid.appendChild(U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: '参数名' }), qn]));
    } else {
      const hn = U.el('input', { class: 'input mono', type: 'text', value: login.headerName || 'Authorization' });
      hn.addEventListener('input', () => { login.headerName = hn.value; save(); });
      grid.appendChild(U.el('label', { class: 'field' }, [U.el('span', { class: 'field-label', text: 'Header 名' }), hn]));

      const pf = U.el('input', { class: 'input mono', type: 'text', value: login.prefix || '', placeholder: 'Bearer ' });
      pf.addEventListener('input', () => { login.prefix = pf.value; save(); });
      grid.appendChild(U.el('label', { class: 'field' }, [
        U.el('span', { class: 'field-label', text: '前缀（注意末尾空格）' }), pf
      ]));
    }
    sec2.body.appendChild(grid);
    pane.appendChild(sec2.wrap);

    /* --- 有效期 --- */
    const sec3 = section('③ 有效期与自动重登');
    const g3 = U.el('div', { class: 'grid3' });

    const ttl = U.el('input', { class: 'input', type: 'number', min: '0', value: login.ttlSeconds ?? 7200 });
    ttl.addEventListener('input', () => { login.ttlSeconds = Number(ttl.value) || 0; save(); });
    g3.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '有效期（秒，0=不过期）' }), ttl
    ]));

    const ep = U.el('input', {
      class: 'input mono', type: 'text', value: login.expirePath || '',
      placeholder: '如 data.expires_in', spellcheck: 'false'
    });
    ep.addEventListener('input', () => { login.expirePath = ep.value; save(); });
    g3.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '从响应读过期时间（可选）' }), ep
    ]));

    const eu = U.el('select', { class: 'input' }, [
      U.el('option', { value: 'seconds', text: '相对秒数（expires_in）' }),
      U.el('option', { value: 'ms', text: '相对毫秒数' }),
      U.el('option', { value: 'timestamp', text: '绝对时间戳（秒）' }),
      U.el('option', { value: 'timestampMs', text: '绝对时间戳（毫秒）' }),
      U.el('option', { value: 'datetime', text: '日期字符串' })
    ]);
    eu.value = login.expireUnit || 'seconds';
    eu.addEventListener('change', () => { login.expireUnit = eu.value; save(); });
    g3.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '过期时间格式' }), eu
    ]));
    sec3.body.appendChild(g3);

    const auto = U.el('input', { type: 'checkbox' });
    auto.checked = login.autoRelogin !== false;
    auto.addEventListener('change', () => { login.autoRelogin = auto.checked; save(); });
    sec3.body.appendChild(U.el('label', { class: 'switch-row' }, [
      auto, U.el('span', { text: '响应表示登录失效时，自动重新登录并重发一次原请求' })
    ]));

    const g3b = U.el('div', { class: 'grid2' });
    const rs = U.el('input', { class: 'input mono', type: 'text', value: login.reloginStatus || '401,403' });
    rs.addEventListener('input', () => { login.reloginStatus = rs.value; save(); });
    g3b.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '触发重登的状态码' }), rs
    ]));

    const rb = U.el('input', {
      class: 'input mono', type: 'text', value: login.reloginBodyMatch || '',
      placeholder: '如 code=401 或 登录已失效'
    });
    rb.addEventListener('input', () => { login.reloginBodyMatch = rb.value; save(); });
    g3b.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field-label', text: '响应体判定（可选）' }), rb
    ]));
    sec3.body.appendChild(g3b);
    sec3.body.appendChild(U.el('div', {
      class: 'hint',
      html: '很多系统 HTTP 状态永远是 200，靠 body 里的 code 表示登录过期。' +
        '这种就填 <code>code=401</code>，支持 <code>字段路径=值</code>，也可以直接填一段关键字做包含匹配。'
    }));
    pane.appendChild(sec3.wrap);

    /* --- 当前 Token --- */
    pane.appendChild(renderTokenPanel(env));
    return pane;
  }

  function section(title) {
    const body = U.el('div', { class: 'sec-body' });
    const wrap = U.el('div', { class: 'login-section' }, [
      U.el('header', {}, [U.el('span', { text: title })]),
      body
    ]);
    return { wrap, body };
  }

  function renderTokenPanel(env) {
    const st = Auth.status(env);
    const token = env.token || {};
    const panel = U.el('div', { class: 'token-panel' });

    panel.appendChild(U.el('div', { class: 'token-row' }, [
      U.el('span', { class: 'lbl', text: '当前状态' }),
      U.el('span', {
        class: 'badge ' + (st.state === 'valid' ? 'ok' : st.state === 'expired' ? 'bad' : 'none'),
        text: st.text
      })
    ]));

    panel.appendChild(U.el('div', { class: 'token-row', style: 'align-items:flex-start' }, [
      U.el('span', { class: 'lbl', style: 'padding-top:6px', text: 'Token' }),
      U.el('div', { class: 'token-val', text: token.value || '（还没有获取过）' })
    ]));

    panel.appendChild(U.el('div', { class: 'token-row' }, [
      U.el('span', { class: 'lbl', text: '获取时间' }),
      U.el('span', { text: token.acquiredAt ? U.fmtDateTime(token.acquiredAt) : '-' })
    ]));

    panel.appendChild(U.el('div', { class: 'token-row' }, [
      U.el('span', { class: 'lbl', text: '过期时间' }),
      U.el('span', {
        text: token.expiresAt
          ? `${U.fmtDateTime(token.expiresAt)}（${U.fmtRelative(token.expiresAt)}）`
          : (token.value ? '不过期' : '-')
      })
    ]));

    if (token.from) {
      panel.appendChild(U.el('div', { class: 'token-row' }, [
        U.el('span', { class: 'lbl', text: '提取自' }),
        U.el('span', { style: 'font-family:var(--mono);font-size:11.5px', text: token.from })
      ]));
    }

    const resultBox = U.el('div', { class: 'token-result' });
    const btnLogin = U.el('button', { class: 'btn primary sm', text: '立即登录 / 刷新 Token' });
    btnLogin.addEventListener('click', async () => {
      if (btnLogin.disabled) return;
      const oldText = btnLogin.textContent;
      btnLogin.disabled = true;
      btnLogin.innerHTML = '<span class="spin"></span> 登录中';
      resultBox.innerHTML = '';
      let resultNode = null;
      try {
        const r = await Auth.login(env);
        if (r.ok) {
          UI.toast('登录成功，Token 已保存', 'ok');
          resultNode = U.el('div', {
            class: 'test-result ok',
            text: `登录成功\n提取自：${r.from}\nToken：${r.token}\n` +
              (r.expiresAt ? `过期时间：${U.fmtDateTime(r.expiresAt)}` : '过期时间：不过期')
          });
        } else {
          const detail = r.res
            ? `\n\nHTTP ${r.res.status || '-'} ${r.res.statusText || ''}\n${(r.res.bodyText || '').slice(0, 1200)}`
            : '';
          UI.toast('登录失败：' + r.error, 'bad', 4500);
          resultNode = U.el('div', { class: 'test-result bad', text: '登录失败：' + r.error + detail });
        }
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        UI.toast('登录异常：' + msg, 'bad', 4500);
        resultNode = U.el('div', { class: 'test-result bad', text: '登录异常：' + msg });
      }
      btnLogin.disabled = false;
      btnLogin.textContent = oldText;
      // 重绘面板以反映最新 token 状态，但保留本次结果提示
      const fresh = renderTokenPanel(env);
      if (resultNode) {
        const nr = fresh.querySelector('.token-result');
        if (nr) nr.appendChild(resultNode);
      }
      const old = panel.parentNode;
      if (old) old.replaceChild(fresh, panel);
      App.refreshTokenChip();
    });

    const btnClear = U.el('button', {
      class: 'btn sm', text: '清除 Token',
      onClick: () => {
        Auth.clearToken(env);
        const old = panel.parentNode;
        if (old) old.replaceChild(renderTokenPanel(env), panel);
      }
    });

    const btnCopy = U.el('button', {
      class: 'btn sm', text: '复制 Token',
      onClick: async () => {
        if (!token.value) { UI.toast('还没有 Token', 'warn'); return; }
        await U.copy(token.value);
        UI.toast('已复制', 'ok', 1300);
      }
    });

    const btnRaw = U.el('button', {
      class: 'btn sm', text: '看登录响应',
      onClick: () => {
        if (!token.raw) { UI.toast('还没有登录记录', 'warn'); return; }
        const parsed = U.tryParseJSON(token.raw);
        UI.open({
          title: '上次登录接口的响应', size: 'md',
          body: U.el('pre', { class: 'code', html: parsed.ok ? U.highlightJSON(parsed.value) : U.escapeHtml(token.raw) })
        });
      }
    });

    panel.appendChild(U.el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' },
      [btnLogin, btnClear, btnCopy, btnRaw]));
    panel.appendChild(resultBox);
    return panel;
  }

  return { openManager };
})();
