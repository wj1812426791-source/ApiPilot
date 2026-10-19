/* 本轮排查修复的回归测试
   1) 环境 Header 与请求 Header 名大小写不同 → 不能重复发两个同名头（见 test_env_headers）
   2) 发送中（工具栏隐藏）按 Ctrl+F → 不能把焦点塞进看不见的输入框（见 test_res_search）
   3) 响应回来时已切标签 → 不能把 A 的响应画到 B 上
   4) 退出时 400ms 防抖窗口内的改动不能丢（flushSync + 同步 IPC）
   5) 流程连点「运行」不能并发跑两遍
   6) 删除环境时别把无关的选中项抢走
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');
const loadRoot = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

/* ------------------------------ 1. 退出前同步落盘 ------------------------------ */
console.log('\n[1] Store.flushSync：关窗前把防抖中的改动写掉');
let syncCalls = 0;
let syncThrows = false;
let lastPayload = null;
const beforeUnloadHandlers = [];

const ctx = {
  console, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  setTimeout, clearTimeout,
  document: {}, navigator: {},
  window: {
    api: {
      loadStore: async () => ({ ok: true, data: null }),
      saveStore: async () => ({ ok: true }),
      saveStoreSync: (data) => {
        syncCalls++;
        lastPayload = data;
        if (syncThrows) throw new Error('disk full');
        return { ok: true };
      }
    },
    addEventListener: (type, fn) => { if (type === 'beforeunload') beforeUnloadHandlers.push(fn); }
  }
};
vm.createContext(ctx);
vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', ctx);
vm.runInContext(loadSrc('store.js') + '\nthis.__Store = Store;', ctx);
const Store = ctx.__Store;

check('加载时注册了 beforeunload', beforeUnloadHandlers.length === 1);
check('没有待保存改动时 flushSync 不写盘', Store.flushSync() === true && syncCalls === 0);

Store.save();                       // 进入 400ms 防抖
check('save() 后立即 flushSync 会同步落盘', Store.flushSync() === true && syncCalls === 1, 'calls=' + syncCalls);
check('落盘内容是完整快照（含 collections/environments/openTabs）',
  !!(lastPayload && lastPayload.collections && lastPayload.environments && lastPayload.openTabs));
check('落盘后不再重复写（pendingSave 已清）', Store.flushSync() === true && syncCalls === 1);

Store.save();
syncThrows = true;
check('写盘失败时返回 false（不静默假装成功）', Store.flushSync() === false);
syncThrows = false;

// 模拟直接关窗：beforeunload 会触发一次 flushSync
Store.save();
syncCalls = 0;
beforeUnloadHandlers[0]();
check('关闭窗口时自动 flush', syncCalls === 1, 'calls=' + syncCalls);

/* ------------------------------ 2. 流程并发保护 ------------------------------ */
console.log('\n[2] 流程运行并发保护');
const flowSrc = loadSrc('flow.js');
check('有 flowRunning 运行中标志', /let flowRunning = false/.test(flowSrc));
check('运行中再次触发会提示并返回', /if \(flowRunning\)[\s\S]{0,160}return;/.test(flowSrc));
check('用 try/finally 保证异常后也能复位', /flowRunning = true;[\s\S]{0,40}try \{/.test(flowSrc) && /finally \{\s*flowRunning = false;/.test(flowSrc));

/* ------------------------------ 3. 响应不串台 ------------------------------ */
console.log('\n[3] 响应回包时的标签归属');
const editorSrc = loadSrc('editor.js');
check('新增 showResponse 统一处理', /function showResponse\(res, meta, tab\)/.test(editorSrc));
check('切走时恢复当前标签自己的响应', /if \(now && now !== tab\) Response\.restore\(now\)/.test(editorSrc));
const showCalls = (editorSrc.match(/^\s*Response\.show\(/gm) || []).length;
check('业务代码里不再直接调 Response.show（只在 showResponse 内部）', showCalls === 1, 'count=' + showCalls);
check('取消分支也走 showResponse', /showResponse\(\{ error: '请求已取消'/.test(editorSrc));
check('异常分支也走 showResponse', /showResponse\(\{ error: e\.message/.test(editorSrc));

/* ------------------------------ 4. 主进程同步写 ------------------------------ */
console.log('\n[4] 主进程 / preload 的同步写通道');
const mainSrc = loadRoot('main.js');
const preloadSrc = loadRoot('preload.js');
check('main.js 注册 store:save-sync', mainSrc.includes("'store:save-sync'"));
check('同步写用 tmp + rename（保持原子性）',
  /writeFileSync\(tmp[\s\S]{0,120}renameSync\(tmp/.test(mainSrc));
check('tmp 文件名唯一（并发写不会互相覆盖）',
  /\$\{STORE_FILE\}\.tmp-\$\{process\.pid\}-\$\{Date\.now\(\)\}/.test(mainSrc));
check('preload 暴露 saveStoreSync', preloadSrc.includes('saveStoreSync'));

/* ------------------------------ 5. 删除环境不抢选中 ------------------------------ */
console.log('\n[5] 删除环境后的选中状态');
const envSrc = loadSrc('env.js');
check('仍有「至少保留一个环境」保护', /environments\.length <= 1[\s\S]{0,80}至少保留一个环境/.test(envSrc));
check('只在该环境被删掉时才改选中', /if \(!Store\.state\.environments\.some\(\(e\) => e\.id === selectedId\)\)[\s\S]{0,80}selectedId = Store\.state\.environments\[0\]\.id/.test(envSrc));

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
