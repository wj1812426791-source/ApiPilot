/* 轻量 Node 测试：响应 Body 模糊查询（键名/值包含即命中，精确路径优先） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadSrc = (f) => fs.readFileSync(path.join(__dirname, 'src', 'js', f), 'utf8');
const loadHtml = () => fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');

const context = {
  console, JSON, Math, Date, Array, Object, String, Number, parseInt, Boolean, RegExp, Map, Set,
  encodeURIComponent, decodeURIComponent, unescape,
  document: {}, navigator: {}, window: {}
};
vm.createContext(context);

context.UI = { toast: () => {}, open: () => {}, close: () => {} };
context.Editor = { current: () => null };
context.Store = { state: { globals: [], environments: [] }, activeEnv: () => null };

vm.runInContext(loadSrc('util.js'), context);
vm.runInContext(loadSrc('response.js') + '\nthis.__Response = Response;', context);
const { fuzzyFind, previewValue } = context.__Response;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

const root = {
  code: 0,
  msg: '操作成功',
  data: {
    f_Id: 'F_20260811001',
    f_Name: '星光嘉寓',
    list: [
      { id: 101, name: '空调', xCurrentProject: 'P1' },
      { id: 102, name: '地暖', xCurrentProject: 'P2' }
    ]
  }
};

console.log('模糊匹配：键名');
const byKey = fuzzyFind(root, 'f_Id');
check('命中键名 f_Id（1 处）', byKey.length === 1);
check('路径为 data.f_Id', byKey[0] && byKey[0].path === 'data.f_Id');
check('取到对应值', byKey[0] && byKey[0].value === 'F_20260811001');

// 包含匹配：f_Name 也算命中 name，加上 list 两项 = 3
check('键名 name 命中 3 条（f_Name + list 两项）', fuzzyFind(root, 'name').length === 3);
check('精确 list.0.name 只出 1 条', fuzzyFind(root, 'list.0.name').length === 1);
check('部分键名 xCurrent 命中 2 条', fuzzyFind(root, 'xCurrent').length === 2);
check('大小写不敏感（F_ID）', fuzzyFind(root, 'F_ID').length === 1);

console.log('\n模糊匹配：值');
check('按值 2026 命中 f_Id', fuzzyFind(root, '2026').some((h) => h.path === 'data.f_Id'));
check('按值 星光 命中 f_Name', fuzzyFind(root, '星光').some((h) => h.path === 'data.f_Name'));
check('按值 地暖 命中 list.1.name', fuzzyFind(root, '地暖').some((h) => h.path === 'data.list.1.name'));
check('中文值命中 msg', fuzzyFind(root, '成功').some((h) => h.path === 'msg'));

console.log('\n模糊匹配：边界');
check('无关关键字返回空', fuzzyFind(root, 'zzz_not_exist').length === 0);
check('空关键字返回空', fuzzyFind(root, '').length === 0);
check('undefined 关键字返回空', fuzzyFind(root, undefined).length === 0);
check('null 内部值不报错', fuzzyFind({ a: null, b: 'x' }, 'x').length === 1);

const big = {};
for (let i = 0; i < 400; i++) big['k' + i] = 'matchvalue';
check('结果上限 300（防卡死）', fuzzyFind(big, 'matchvalue').length === 300);

console.log('\n值预览');
check('对象预览', previewValue({ a: 1, b: 2 }) === '{对象 · 2 个字段}');
check('数组预览', previewValue([1, 2, 3]) === '[数组 · 3 项]');
check('null 预览', previewValue(null) === 'null');
check('长字符串截断', previewValue('x'.repeat(200)).endsWith('…'));
check('短字符串原样', previewValue('ok') === 'ok');

console.log('\n源码/界面就位检查');
const code = loadSrc('response.js');
const html = loadHtml();
check('response.js 有 fuzzyFind', code.includes('function fuzzyFind(root, query)'));
check('先按精确路径查（精确优先）', code.includes('U.getByPath(loose.value, filterPath)'));
check('路径没命中时退化为模糊', code.includes('renderFuzzyHits(content, fuzzyFind(loose.value, filterPath), filterPath)'));
check('渲染函数存在', code.includes('function renderFuzzyHits(content, hits, query)'));
check('点路径可精确定位', code.includes('点击定位到该路径'));
check('非 JSON 文本按行模糊过滤', code.includes('包含「${filterPath}」的行'));
check('过滤框提示模糊查询', html.includes('模糊查询 body'));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
