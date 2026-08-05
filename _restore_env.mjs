import fs from 'fs';

const FILE = 'D:/ApiPilot/data/workspace.json';
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 重建「会议室」环境：按用户之前设定的结构
// - Token 注入到自定义请求头 token（不是 Authorization Bearer）
// - 带 tenantNo 变量
// 注：baseUrl / 登录账号密码 / 登录路径 / tokenPath 属于用户私有数据，用占位符标出
const meetingEnv = {
  id: 'env_meeting_room',
  name: '会议室',
  variables: [
    { key: 'baseUrl', value: '', desc: '会议室服务地址，例如 http://10.x.x.x:8080', enabled: true },
    { key: 'username', value: '', desc: '登录账号', enabled: true },
    { key: 'password', value: '', desc: '登录密码', enabled: true },
    { key: 'tenantNo', value: 'host', desc: '租户号（按服务端要求填写）', enabled: true }
  ],
  login: {
    enabled: true,
    method: 'POST',
    url: '{{baseUrl}}/login',
    headers: [{ key: 'Content-Type', value: 'application/json', desc: '', enabled: true }],
    bodyMode: 'raw',
    bodyRaw: '{\n  "username": "{{username}}",\n  "password": "{{password}}"\n}',
    bodyItems: [],
    tokenPath: 'data.token',
    injectTo: 'header',
    headerName: 'token',
    prefix: '',
    queryName: 'access_token',
    ttlSeconds: 7200,
    expirePath: '',
    expireUnit: 'seconds',
    autoRelogin: true,
    reloginStatus: '401,403',
    reloginBodyMatch: '',
    ignoreSSL: true,
    useCookieJar: true
  },
  token: { value: '', acquiredAt: 0, expiresAt: 0, raw: '', from: '' }
};

// 仅替换 environments：丢弃自检污染的「自检环境」，加入重建的「会议室」
d.environments = [meetingEnv];
d.activeEnvId = meetingEnv.id;

fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
console.log('已写入 environments:', d.environments.map(e => e.name));
console.log('activeEnvId:', d.activeEnvId);
console.log('collections 保留:', d.collections.map(c => c.name));
