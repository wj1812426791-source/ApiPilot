# ApiPilot

一个 Postman 风格的本地 API 调试工具（Electron 桌面应用）。

和 Postman 最大的不同：**每个环境可以配一套「登录取 Token」的动作**，Token 存在本地，发请求前自动检查、过期自动重登、遇到 401 自动重登并重发原请求 —— 不用再手动复制粘贴 Token 了。

---

## 一、启动

### 最省事的方式

双击项目根目录下的 **`启动 ApiPilot.bat`**。

首次运行会自动 `npm install`（已配好 npm 国内镜像，Electron 内核走 npmmirror）。

### 命令行

```bash
cd D:\ApiPilot
npm install
npm start
```

> ⚠️ **如果启动报 `Cannot read properties of undefined (reading 'setPath')`**
> 说明当前终端里有 `ELECTRON_RUN_AS_NODE=1`（VS Code / Cursor / 各类 Electron 系终端会注入它），
> 它会让 electron 退化成纯 Node 运行。清掉再启动：
> ```
> CMD:        set ELECTRON_RUN_AS_NODE=
> PowerShell: $env:ELECTRON_RUN_AS_NODE=""
> Git Bash:   unset ELECTRON_RUN_AS_NODE
> ```
> 用 `.bat` 启动则不用管，脚本里已经清掉了。

---

## 二、目录说明

```
D:\ApiPilot\
├── main.js               主进程：窗口 + HTTP 请求引擎 + 本地存储 + IPC
├── preload.js            安全桥（contextIsolation），暴露 window.api
├── mock-server.js        演示后端（端口 8899），用来体验 Token 自动续期
├── 启动 ApiPilot.bat      双击启动
├── 启动演示后端.bat        双击启动 mock
├── data\
│   ├── workspace.json    所有集合 / 环境 / 历史（唯一数据文件，可直接备份）
│   └── backup\           每天自动备份一份
└── src\
    ├── index.html
    ├── css\app.css
    └── js\
        ├── util.js       工具函数
        ├── store.js      状态与持久化
        ├── vars.js       {{变量}} 解析引擎
        ├── modal.js      弹窗 / toast / 右键菜单
        ├── auth.js       ★ 登录取 Token、有效期、自动重登
        ├── http.js       请求编译与发送（含 401 重试）
        ├── tree.js       集合树
        ├── editor.js     请求编辑器
        ├── response.js   响应面板
        ├── env.js        环境管理
        ├── importer.js   Postman / cURL 导入导出
        ├── selftest.js   端到端自检（39 项）
        └── app.js        装配与快捷键
```

**数据全部落在 `D:\ApiPilot\data`，不写 C 盘 AppData。** 换电脑直接拷这个目录。

---

## 三、核心功能：环境登录 + Token 自动续期

这是这个工具存在的理由，重点说。

### 1. 打开环境管理

右上角环境下拉 → **管理环境**，或按 `Ctrl+E`。

### 2. 「变量」标签页

配公共变量，比如：

| 变量名 | 值 |
|---|---|
| baseUrl | `https://api.example.com`（示例，换成你自己的服务地址） |
| username | `your_username` |
| password | `your_password` |

请求里用 `{{baseUrl}}/api/user/list` 引用。

### 3. 「登录与 Token」标签页

勾上 **启用自动登录**，然后配四块：

**① 登录请求**

| 项 | 示例 |
|---|---|
| 方法 | POST |
| URL | `{{baseUrl}}/login` |
| Body 类型 | JSON |
| Body | `{"username":"{{username}}","password":"{{password}}"}` |

登录请求本身也支持 `{{变量}}`，所以账号密码写在变量里、登录体里引用即可。

**② Token 提取**

从登录响应里把 Token 抠出来，支持四种写法：

| 写法 | 含义 |
|---|---|
| `data.token` | JSON 路径，取 `响应.data.token` |
| `data.list[0].token` | 支持数组下标 |
| `header:Authorization` | 从响应头取 |
| `cookie:JSESSIONID` | 从 Set-Cookie 取 |
| 留空 | 自动探测常见字段（token / accessToken / access_token / jwt / id_token …） |

**③ 注入方式**

拿到 Token 后怎么带到业务请求上：

| 注入位置 | 效果 |
|---|---|
| Header（默认） | `Authorization: Bearer <token>`，前缀可改，也可改成 `token`、`X-Token` 等任意头名 |
| Query | 拼到 URL 上，如 `?access_token=xxx` |
| Cookie | 作为 Cookie 发送 |

**④ 有效期与自动重登**

| 项 | 说明 |
|---|---|
| 有效期来源 | ①响应里的字段（如 `data.expires_in`，秒）②固定时长（如 30 分钟）③不判断，只靠 401 触发 |
| 提前量 | 内置提前 30 秒判过期，避免卡在临界点 |
| 重登状态码 | 默认 `401,403`，逗号分隔可改 |
| 重登业务码 | 有些接口 HTTP 恒 200，靠 body 里的码表示失效。填 `code=401` 即可匹配 |

### 4. 之后发请求会发生什么

```
发送请求
  ├─ 环境启用了自动登录？ 且 请求 Auth = Inherit？
  │    └─ 是 → 检查本地 Token 是否还在有效期内
  │             ├─ 过期/没有 → 先跑一遍登录请求，存下新 Token
  │             └─ 有效       → 直接用
  ├─ 按配置把 Token 注入 Header / Query / Cookie
  ├─ 发出去
  └─ 响应命中重登条件（401/403 或 body.code=401）？
       └─ 是 → 自动重登 → 用新 Token 重发一次原请求（只重试一次，不会死循环）
```

标题栏右上角有个 **Token 芯片**，实时显示当前 Token 状态和剩余有效期，点一下可以看完整值 / 手动刷新 / 清除。

并发场景做了去重：同一环境同时有多个请求触发登录，只会真正发一次登录请求，其余等结果。

---

## 四、其他功能

**Collections**
- 集合 / 文件夹 / 请求三级树，右键新建、重命名、复制、删除
- 拖拽排序与移动
- 集合级别可导出为 Postman v2.1 格式

**请求编辑器**
- Params / Headers / Body / Auth / Path Vars / Settings 六个页签
- Body 支持 none / raw(JSON,XML,Text,HTML,JS) / x-www-form-urlencoded / form-data / binary
- URL 栏与 Params 表双向实时同步
- 路径变量 `:id` 自动识别成表格行
- 变量在 URL 里高亮，鼠标悬停显示解析后的实际值；未定义的变量标红

**响应面板**
- Pretty（JSON 语法高亮 / XML 格式化）、Raw、Preview（HTML、图片直接渲染）
- 响应头表格、状态码 / 耗时 / 大小、Cookie
- 「实际发出的请求」页签：能看到变量替换后、Token 注入后的最终请求原文（排查问题很有用）

**导入导出**
- 导入 Postman Collection v2.1 / cURL 命令 / ApiPilot 自身备份
- 导出 Postman v2.1 / cURL / 完整工作区备份
- 请求右键「复制为 cURL」

**快捷键**

| 键 | 功能 |
|---|---|
| `Ctrl+Enter` | 发送 |
| `Ctrl+S` | 保存请求 |
| `Ctrl+N` | 新建请求 |
| `Ctrl+W` | 关闭标签 |
| `Ctrl+E` | 环境管理 |
| `Ctrl+L` | 聚焦地址栏 |
| `Ctrl+F` | 搜索集合 |
| `Ctrl+Tab` | 切换标签 |

**内置动态变量**

`{{$timestamp}}` `{{$timestampMs}}` `{{$isoTimestamp}}` `{{$randomInt}}` `{{$uuid}}` `{{$guid}}` `{{$randomString}}`

---

## 五、先拿演示后端试一把

1. 双击 `启动演示后端.bat`（端口 8899，Token 有效期只有 **60 秒**，方便观察续期）
2. 启动 ApiPilot，环境选「本地演示」
3. 打开「示例集合 → 用户列表」，`Ctrl+Enter` 发送

第一次会自动登录拿 Token 再请求；等 60 秒后再发一次，会看到它自己重新登录、再发请求，响应正常返回 200。

演示后端接口：

| 接口 | 说明 |
|---|---|
| `POST /login` | admin / 123456，返回 `data.token`、`data.expires_in` |
| `GET /api/user/list` | 需要 Bearer Token，失效返回 HTTP 401 |
| `GET /api/soft/profile` | HTTP 恒 200，失效时 `body.code = 401` |
| `ANY /api/echo` | 回显请求内容 |
| `GET /api/slow?ms=2000` | 延迟响应，测超时 |
| `GET /api/status?code=500` | 指定状态码 |

---

## 六、自检

改完代码想确认没搞坏，跑一遍端到端自检（会真的起窗口、真的发 HTTP 请求）：

```bash
# 先启动 mock
node mock-server.js

# 另开一个终端
set ELECTRON_RUN_AS_NODE=
set APIPILOT_DATA_DIR=D:\ApiPilot\data\selftest
npx electron . --selftest
```

输出 `SELFTEST_RESULT {"total":46,"passed":46,"failed":0,...}` 就是全绿。

自检用独立数据目录，不会动你的正式 `workspace.json`；跑的时候窗口不显示，跑完自动退出。

覆盖范围（46 项）：变量解析、JSON 路径提取、登录取 Token、Token 三种注入方式、本地过期自动重登、401 自动重登重发、业务码 401 重登、请求体各模式、URL 与 Params 合并、错误处理、cURL 解析、Postman 导入导出往返、持久化读写，以及界面渲染（关键 DOM 元素、集合树、标签页、环境下拉、Token 芯片、样式生效）。

在无显卡 / 远程桌面等环境里 GPU 进程可能起不来，自检模式已自动降级为软件渲染。日常使用如果也遇到 GPU 报错，加 `--no-gpu` 启动即可。

---

## 七、打包成安装包

```bash
npm i -D electron-builder
npm run dist
```

产物在 `release\` 下，NSIS 安装包，可自选安装路径。
