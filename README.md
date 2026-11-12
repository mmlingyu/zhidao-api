# 知岛 · API 后端

Node.js 原生 HTTP 服务，负责课程生成、学科路由、账号/家庭、人脸特征向量比对、知识卡片、缓存与 A2UI 服务端编译。前端位于 [zhidao-web](https://github.com/mmlingyu/zhidao-web)。**默认 API-only，不提供网页。**

## 项目结构

```text
zhidao-api/
├── server.js                       # HTTP 路由、配置、启动
├── models.js                       # Liquid/Qwen 调用与输出校验
├── curriculum.js / knowledge.js     # 课程、知识协议与状态
├── grade-profile.js / feedback.js   # 年级画像与反馈纯逻辑
├── users.js / security.js           # 用户、会话、向量比对、CORS/限流/管理鉴权
├── cache.js                        # Redis 优先、本地 JSON 降级
├── cards.js                        # 知识卡片与学习证据
├── idioms.js / idioms.json          # 成语词库（完整保留）
├── a2ui-catalog.js / a2ui-matrix.js / a2ui-compiler.js
├── a2ui-bridge.js / a2ui-stream.js / a2ui-play.js
├── a2ui-question-map.js / a2ui-games.js / a2ui-p4[a-d].js
├── .env.example / .gitignore        # 无密钥配置模板与排除规则
├── package.json / package-lock.json
├── scripts/check.js / test-split.js # 语法与独立 API 冒烟验证
├── test-*.js                       # 可独立运行的原 API 回归测试
└── docs/
    ├── A2UI-COMPONENT-ROADMAP.md / A2UI-KNOWLEDGE-UI.md
    ├── KNOWLEDGE-CARDS.md / MOBILE.md
    ├── MONOLITH-README.md           # 原单体说明，仅作历史参考
    └── legacy-tests/               # 原混合测试/压测归档，不能直接在此执行
```

A2UI 编译、游戏协议与 `grade-profile.js`、`feedback.js` 同时供浏览器使用，因此两仓库各存一份。`knowledge.js` 为服务端 CommonJS 模块。后端不需要 TensorFlow / face-api：特征提取在浏览器，服务端只比对向量，因此运行依赖仅保留 `ioredis`，并更新锁文件。

## 安装与启动

Node.js 20+：

```bash
npm install
# 或 npm ci
cp .env.example .env
npm start
```

模板默认 `API_MOCK=true`、`HOST=127.0.0.1`、`PORT=3000`、本地 JSON 缓存。无需任何真实密钥即可联调：

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/grades
```

真实生成时，在服务器私有 `.env` 或环境变量中配置 `GENERATION_PROVIDER`、对应 `LIQUID_API_KEY` / `JEV_API_KEY` 或 `DASHSCOPE_API_KEY`，将 `API_MOCK=false`；可用 `GENERATION_MODEL`、`GENERATION_BASE_URL` 调整生成模型。默认配置逻辑仍以项目 `.env` 为准，部分运行参数允许环境变量覆盖，具体见 server.js 的 runtimeOverrides；不要同时混用冲突来源。`.env.example` 只包含空值/演示默认值，不包含原机器密钥。

## 分离部署

1. 后端独立常驻运行；公网/容器需要 `HOST=0.0.0.0`，端口通过 `PORT` 设置，通常用 Nginx/平台反向代理与 HTTPS。
2. `CORS_ORIGINS=https://web.example.com`；多来源用逗号分隔（含端口、不带尾斜线或路径）。未配置白名单且非本机绑定时，浏览器跨源调用不会被允许。
3. 前端 `config.js` 设 `window.ZHIDAO_API_BASE = 'https://api.example.com'`（不含 `/api`）；或通过同源 Nginx `/api/` 反代并让 API base 为空。
4. `/api/health` 返回状态；`/` 默认返回 404 JSON，是 API-only 的预期表现。`/api/face-assets` 在 API-only 模式返回 `managedBy: "frontend"`、`ready: null`：人脸静态资源在前端，应由前端自检，不代表识别失败。
5. 容器/服务器为缓存与用户数据配置持久化存储，不要提交运行数据。

可选保留本地同源联调：设置 `STATIC_DIR` 为 **zhidao-web 源码目录的绝对路径**，API 会按原白名单提供网页与 `public/` 资源。不设置就完全不提供静态文件；不要将其指向含私密文件的混合目录。此模式前端 API base 留空。

### Redis 与安全配置

- Redis 可选：`CACHE_BACKEND=auto` / `redis`，配置 `REDIS_URL` 或 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_DB`、`REDIS_TLS` 等；原逻辑在连接失败时降级本地 JSON。生产数据、备份与故障策略需另外规划。
- 多环境使用不同 `REDIS_KEY_PREFIX` / DB / 本地目录，避免互相影响。
- `ADMIN_TOKEN` 只放服务器，用于管理操作；不要发到浏览器。未设置时管理逻辑允许本机来源，若经本机反向代理接入尤其必须配置此令牌。
- `RATE_LIMIT_PER_MIN` 控制昂贵模型调用/登录接口限流；生产不要设为 0。当前基于直连 socket IP，不信任转发头；经反代时用户可能共享配额，需部署层另行规划可信代理与限流。
- CORS 不是服务端鉴权防火墙；公网开放前仍应审查登录、滥用防护与预算策略。账号/人脸特征向量属于敏感数据，应保护持久化目录、限制访问并制定备份/删除策略。

## 测试

```bash
npm run check
npm test                  # 无密钥、临时目录、mock 的 API-only / CORS / 课程验证
npm run test:idioms
npm run test:a2ui:map
npm run test:a2ui:server
npm run test:cache
npm run test:redis        # 内置 Redis 模拟服务器，需要 npm install
npm run test:users
```

原单体中读取网页源码/真实浏览器/压测的混合脚本保存到 docs/legacy-tests，仅作迁移参考，不承诺在拆分仓库中原样运行。未使用真实模型密钥进行收费调用。

## 安全边界与当前状态

当前 GitHub 仓库是**公开**的，未变更其可见性；不要提交 `.env`、密钥、node_modules、cache、用户数据和日志。此次仅将项目拆分后放入 GitHub；尚未部署到公网计算或静态托管平台。保留的历史文档描述单体，不应覆盖本 README 的分离部署说明。
