/* 轻量 Node 测试：智能美化（JSON 容错 / 表单·查询串 / XML） */

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
vm.runInContext(loadSrc('util.js') + '\nthis.__U = U;', context);
const U = context.__U;

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

/* =========================================================================
   1) 用户实际报的那串（x-www-form-urlencoded）
   ========================================================================= */
console.log('\n[1] 表单串识别与解析');

const FORM = 'rechargeTimeQRange=&status=1&tenantID=b53660bd-0214-4017-b2e6-61cdd0e4c6dc'
  + '&roomID=34cf0cbc-4ebd-400a-bacd-733bdee497cf&rows=10&page=1&sidx=createTime+DES';

check('looksLikeForm 认得出这串', U.looksLikeForm(FORM) === true);

const items = U.parseForm(FORM);
check('解析出 7 个参数', items.length === 7, '实际 ' + items.length);
check('空值参数保留为空字符串', items[0].key === 'rechargeTimeQRange' && items[0].value === '');
check('普通参数原样', items[1].key === 'status' && items[1].value === '1');
check('UUID 值不被破坏', items[2].value === 'b53660bd-0214-4017-b2e6-61cdd0e4c6dc');
check('+ 解码为空格（createTime DES）', items[6].value === 'createTime DES', items[6].value);
check('被解码过的项标记 changed', items[6].changed === true);
check('未解码的项不算 changed', items[2].changed === false);

const fmt = U.formatForm(FORM);
const fmtLines = fmt.split('\n');
check('格式化后一行一个参数', fmtLines.length === 7);
check('key 与 = 对齐（等号在同一列）', new Set(fmtLines.map((l) => l.indexOf('='))).size === 1);
check('空值有标注', fmtLines[0].includes('空值'));
check('原始编码值保留可查', fmtLines[6].includes('createTime+DES'));

/* =========================================================================
   2) looksLikeForm 不该误判
   ========================================================================= */
console.log('\n[2] 不该被当成表单的内容');

check('完整 URL 不算表单', U.looksLikeForm('https://a.com/x?rows=10&page=1') === false);
check('JSON 不算表单', U.looksLikeForm('{"rows":10,"page":1}') === false);
check('XML 不算表单', U.looksLikeForm('<a rows="10" page="1"/>') === false);
check('单参数不算表单', U.looksLikeForm('status=1') === false);
check('普通文本不算表单', U.looksLikeForm('操作成功') === false);
check('空串不算表单', U.looksLikeForm('') === false);
check('带 ? 前缀的查询串算表单', U.looksLikeForm('?rows=10&page=1') === true);

/* =========================================================================
   3) 宽松 JSON
   ========================================================================= */
console.log('\n[3] 宽松 JSON（BOM / JSONP / 防劫持前缀 / 含变量）');

check('普通 JSON 可解析', U.tryParseJSONLoose('{"a":1}').ok === true);
check('BOM 可解析', U.tryParseJSONLoose('\uFEFF{"a":1}').ok === true);
check('while(1); 前缀可解析', U.tryParseJSONLoose('while(1);{"a":1}').ok === true);
check(') ] }\' 前缀可解析', U.tryParseJSONLoose(")]}',{\"a\":1}").ok === true);
check('JSONP 包裹可解析', U.tryParseJSONLoose('cb({"a":1});').ok === true);
check('JSONP 解析出正确值', JSON.stringify(U.tryParseJSONLoose('cb({"a":1});').value) === '{"a":1}');
check('剥离前缀有说明', U.tryParseJSONLoose('while(1);{"a":1}').notes.length === 1);
check('乱码文本仍失败', U.tryParseJSONLoose('hello world').ok === false);

/* =========================================================================
   4) smartFormat
   ========================================================================= */
console.log('\n[4] smartFormat 自动识别');

const rForm = U.smartFormat(FORM);
check('表单串 → kind=form', rForm.ok && rForm.kind === 'form');
check('表单串带参数个数', rForm.count === 7);
check('表单串结果已分行', rForm.text.split('\n').length === 7);

const rJson = U.smartFormat('{"b":1,"a":[1,2]}');
check('JSON → kind=json', rJson.ok && rJson.kind === 'json');
check('JSON 已缩进美化', rJson.text.includes('\n  "b": 1'));

const rXml = U.smartFormat('<root><a>1</a></root>');
check('XML → kind=xml', rXml.ok && rXml.kind === 'xml');
check('XML 已分行', rXml.text.split('\n').length > 1);

check('空内容 → 明确报错', U.smartFormat('   ').ok === false);
check('不可识别 → 明确报错', U.smartFormat('操作成功').ok === false);
check('报错带原因', !!U.smartFormat('操作成功').error);

/* 含 {{变量}} 的 JSON（变量名带下划线——旧实现会还原失败） */
console.log('\n[5] 含 {{变量}} 的 JSON 美化');
const withVar = '{"x-current-project":"{{x_current_project}}","token":"{{token}}","url":"{{baseUrl}}/pms"}';
const rVar = U.smartFormat(withVar);
check('含变量 JSON 可美化', rVar.ok && rVar.kind === 'json', rVar.error);
check('变量名带下划线也能还原', rVar.text.includes('{{x_current_project}}'));
check('多个变量都还原', rVar.text.includes('{{token}}') && rVar.text.includes('{{baseUrl}}'));
check('美化后仍是合法 JSON（掩码已还原）', (() => {
  try { JSON.parse(rVar.text); return true; } catch (_) { return false; }
})());

const varKey = '{"{{dyn_key}}":1}';
check('变量当 key 也能还原', U.smartFormat(varKey).ok && U.smartFormat(varKey).text.includes('{{dyn_key}}'));

/* 掩码工具本身 */
console.log('\n[6] 掩码工具');
const { masked, names } = U.maskVars('{"a":"{{x_y}}","b":"{{z}}"}');
check('掩码后不含 {{', !masked.includes('{{'));
check('掩码保留结构', JSON.stringify(JSON.parse(masked)) === JSON.stringify({ a: '__APV0__', b: '__APV1__' }));
check('还原正确', U.unmaskVars(masked, names).includes('{{x_y}}'));
check('没有占位时原样返回', U.unmaskVars('abc', []) === 'abc');

/* =========================================================================
   7) 接线：编辑器按钮 / 响应渲染 / 实际发出面板
   ========================================================================= */
console.log('\n[7] 接线检查');

const editorCode = loadSrc('editor.js');
const respCode = loadSrc('response.js');
const html = loadHtml();

check('美化按钮改用 smartFormat', editorCode.includes('U.smartFormat(raw)'));
check('美化按钮不再写死"不是合法 JSON"', !editorCode.includes('不是合法 JSON，无法美化'));
check('表单体美化 → 转为参数表', editorCode.includes('req.body.urlencoded = items') || editorCode.includes('b.urlencoded = items'));
check('表单体美化时保留原始 raw', editorCode.includes('原始内容仍保留在 raw'));
check('参数表模式再点美化有提示', editorCode.includes('参数表本身就是美化后的形式'));
check('响应 Pretty 用宽松 JSON', respCode.includes('U.tryParseJSONLoose(text)'));
check('响应 Pretty 有表单分支', respCode.includes('renderFormParams(content, text, filterPath)'));
check('响应 Pretty 有参数表渲染函数', respCode.includes('function renderFormParams'));
check('「实际发出」请求体走 bodyNode', respCode.includes('wrap.appendChild(bodyNode(bp, s.body))'));
check('bodyNode 处理表单体', respCode.includes('U.formatForm(bp)'));
check('美化按钮提示文案已更新', html.includes('智能美化：JSON / 表单参数 / XML'));
check('样式已加（kv-view）', fs.readFileSync(path.join(__dirname, 'src', 'css', 'app.css'), 'utf8').includes('.kv-view'));

/* =========================================================================
   汇总
   ========================================================================= */
console.log('\n' + '='.repeat(46));
console.log(`智能美化：${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(46));
process.exit(failed ? 1 : 0);
