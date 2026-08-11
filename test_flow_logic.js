/* 轻量 Node 测试：验证测试流程核心逻辑（不依赖 Electron） */
const fs = require('fs');
const path = require('path');

// 把前端代码用 minimal DOM 跑起来太麻烦，这里只验证 vars.js 里的 $n 解析
// 方式：把 vars.js 改造成可 require（通过 vm + 简单 Store mock）
const vm = require('vm');

function loadSrc(file) {
  const code = fs.readFileSync(path.join(__dirname, 'src/js', file), 'utf8');
  return code;
}

const UCode = loadSrc('util.js');
const VarsCode = loadSrc('vars.js');

const context = {
  console,
  JSON,
  Math,
  Date,
  Array,
  Object,
  String,
  Number,
  parseInt,
  RegExp,
  Map,
  Set,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  unescape,
  encodeURIComponent,
  decodeURIComponent,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  document: {}
};
vm.createContext(context);

// 注入 Store mock
context.Store = {
  state: { globals: [] },
  activeEnv: () => ({
    id: 'env_1', name: '测试环境',
    variables: [{ key: 'baseUrl', value: 'http://localhost:8080', desc: '', enabled: true }],
    login: {}, token: {}
  })
};

vm.runInContext(UCode, context);
vm.runInContext(VarsCode + '\nthis.__vars = Vars;', context);

const Vars = context.__vars;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

console.log('Vars $n 解析测试');
const ctx = {
  stepResults: [
    {
      response: {
        status: 200,
        headers: { 'x-request-id': 'abc123' },
        bodyText: JSON.stringify({ code: 0, data: { f_Id: 'F_20260811001', name: '项目A' } }),
        parsedBody: { code: 0, data: { f_Id: 'F_20260811001', name: '项目A' } }
      }
    }
  ]
};

check('解析 $1.response.body.data.f_Id', Vars.resolve('{{$1.response.body.data.f_Id}}', undefined, ctx) === 'F_20260811001');
check('解析 $1.response.status', Vars.resolve('{{$1.response.status}}', undefined, ctx) === '200');
check('解析 $1.response.headers.x-request-id', Vars.resolve('{{$1.response.headers.x-request-id}}', undefined, ctx) === 'abc123');
const combined = Vars.resolve('{{baseUrl}}/api/project/{{$1.response.body.data.f_Id}}', undefined, ctx);
check('组合 baseUrl + $1', combined === 'http://localhost:8080/api/project/F_20260811001');
if (combined !== 'http://localhost:8080/api/project/F_20260811001') console.log('    actual:', combined);
check('未定义 $2 应保留原样', Vars.resolve('{{$2.response.body.id}}', undefined, ctx) === '{{$2.response.body.id}}');

console.log('\nHTTP build 流程变量测试');
// 用 vm 跑 http.js 需要 Auth/Store，比较复杂；这里只确认 build 函数签名接受 ctx
const httpCode = loadSrc('http.js');
check('http.js 包含 build(req, env, ctx)', httpCode.includes('function build(req, env, ctx)'));
check('send 支持 { env, ctx }', httpCode.includes('async function send(req, { onStage, env, ctx } = {})'));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
