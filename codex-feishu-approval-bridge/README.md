# Codex Feishu Approval Bridge

这个项目是一个本地 bridge。它连接 Codex CLI 的 `app-server` 与飞书交互卡片，把 Codex 的 approval 请求转发到指定飞书账户，并把飞书上的点击结果回传给 Codex。

本文档分两部分：

- 先说明当前代码仓库已经确认具备哪些能力
- 再给出一套在 Ubuntu 主机上逐步配置 Codex 和飞书的落地步骤

## 代码确认结论

基于当前仓库源码、类型检查和测试，已确认以下事实。

### 已由代码直接证明的能力

- `main.ts` 会监听 Codex `app-server` 发出的两类审批请求：
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
- bridge 收到审批请求后，会创建本地审批记录，并根据模式选择：
  - `terminal` 模式下在终端等待输入
  - `feishu` 模式下发送飞书交互卡片
- 飞书卡片按钮点击会被 `feishu_client.ts` 的 HTTP 回调接收，并发出内部 `action` 事件。
- `main.ts` 收到飞书动作后，会把决策映射回 Codex JSON-RPC 响应：
  - `accept`
  - `decline`
  - `cancel`
  - 可选 `acceptForSession`
- `approval_store.ts` 保证同一个审批请求只能最终提交一次，并维护 `pending / approved / declined / canceled / expired / resolved` 状态。
- 卡片按钮不会对所有飞书用户生效，只有 `ALLOWED_FEISHU_USERS` 白名单中的用户点击才会被接受。
- 代码支持把审批消息发送到一个固定飞书接收目标 `FEISHU_APPROVAL_RECEIVE_ID`。

### 已由本地命令确认的事实

- `codex --version` 返回 `codex-cli 0.118.0`
- `codex app-server --help` 确认存在 `--listen`，支持 `stdio://` 和 `ws://IP:PORT`
- `codex app-server generate-json-schema --out <DIR> --experimental` 导出的 schema 中包含：
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
  - `serverRequest/resolved`
  - `accept`
  - `acceptForSession`
  - `decline`
  - `cancel`
- `npm run check` 通过
- `npm test` 通过

### 还需要人工环境联调验证的部分

仓库内没有端到端自动化去替代真实部署，所以以下内容仍需要你在自己的 Ubuntu + Codex + 飞书环境里验证：

- Ubuntu 主机上的 `codex` 是否已正确登录并可触发 approval
- 飞书应用是否已正确开通机器人、消息卡片与卡片回调能力
- 飞书公网 HTTPS 回调地址是否能访问到本机 callback server
- 指定飞书账户是否确实能收到卡片并成功 approve / reject

结论很明确：代码路径已经具备“转发审批到飞书并回传 approve/reject”的实现；是否在你的环境中跑通，取决于 Codex、飞书应用和公网回调的配置是否正确。

## 架构

```text
Codex app-server
  <-> local bridge (Node.js / TypeScript)
        |-> terminal approver
        |-> Feishu message create
        \-> Feishu card callback HTTP endpoint
             \-> decision mapped back to Codex JSON-RPC response
```

实际闭环如下：

1. bridge 启动或连接 Codex `app-server`
2. bridge 发起 `thread/start`
3. bridge 发起 `turn/start`
4. Codex 在需要 approval 时发送 `requestApproval`
5. bridge 生成审批记录并发送飞书交互卡片
6. 用户在飞书点击“批准”或“拒绝”
7. 飞书把卡片动作通过 HTTP 回调发给 bridge
8. bridge 校验用户白名单和审批状态
9. bridge 调用 `codex.respond(requestId, { decision })`
10. Codex 继续执行或停止当前动作

## 重要限制

在开始配置之前，先确认这几个边界。

- 这不是“纯飞书长连接”方案。当前实现依赖一个本地 HTTP callback server 来接收卡片动作。
- 你必须给飞书提供一个公网 HTTPS 回调地址，并转发到本机 `FEISHU_CALLBACK_PORT` 和 `FEISHU_CALLBACK_PATH`。
- 当前代码只支持把消息发送到一个固定接收目标，不支持按仓库、线程或审批请求动态路由到不同用户。
- `ALLOWED_FEISHU_USERS` 只控制“谁的点击会生效”，不决定“消息发给谁”。
- `fileChange` 卡片只能展示保守摘要，拿不到完整 diff。
- `tool/requestUserInput` 目前没有桥接到飞书表单。
- 飞书卡片里记录的执行者名称当前实际是用户 ID；代码没有额外拉取飞书昵称。

## 目录

```text
codex-feishu-approval-bridge/
├── .env.example
├── README.md
├── approval_store.ts
├── card_builder.ts
├── codex_client.ts
├── config.ts
├── feishu_client.ts
├── main.ts
├── scripts/run_local_demo.sh
├── terminal_approver.ts
└── test/
```

## 前置条件

以下步骤按“bridge 运行在 Ubuntu 主机上”来写。

### Ubuntu 主机需要满足

- 已安装 Node.js 20 或更高版本
- 已安装 `npm`
- 已安装 `codex`
- `codex` 已经能在当前用户下正常运行
- Ubuntu 主机能访问 OpenAI 服务和飞书开放平台接口
- Ubuntu 主机有一个可被公网访问的 HTTPS 入口，能转发到本机 callback server

### 飞书侧需要满足

- 你有飞书开放平台权限，可以创建或修改一个自建应用
- 该应用开启了机器人能力
- 该应用具备发送交互消息和接收卡片回调所需的能力
- 目标审批人已经被加入应用可用范围

## 第 1 步：检查 Ubuntu 上的 Codex CLI

先在 Ubuntu 主机上确认 `codex` 命令本身没问题。

```bash
codex --version
codex app-server --help
```

你至少要确认两点：

- `codex --version` 能正常输出版本
- `codex app-server --help` 能看到 `--listen` 参数

如果这两步都失败，后面的飞书配置没有意义，因为 bridge 本身依赖 `codex app-server`。

## 第 2 步：获取项目并安装依赖

```bash
git clone <your-repo-url>
cd codex-feishu-approval-bridge
npm install
```

可选自检：

```bash
npm run check
npm test
```

## 第 3 步：先用终端模式确认 Codex approval 能被 bridge 接住

不要一上来就调飞书。先证明 Codex 审批请求已经能被 bridge 正常接住。

### 3.1 复制配置模板

```bash
cp .env.example .env
```

### 3.2 先填最小可运行配置

把 `.env` 改成至少包含这些值：

```dotenv
APPROVAL_MODE=terminal
WORKSPACE_CWD=/absolute/path/to/your/workspace
PROMPT=Run the shell command `mkdir -p /tmp/codex-feishu-approval-demo` and then tell me done.

CODEX_BIN=codex
CODEX_APPROVAL_POLICY=untrusted
CODEX_SANDBOX=workspace-write
CODEX_REASONING_EFFORT=low
```

说明：

- `WORKSPACE_CWD` 是你希望 Codex 操作的工作目录
- `PROMPT` 必须足够容易触发 approval，示例里的 `mkdir` 比较适合演示
- `CODEX_APPROVAL_POLICY=untrusted` 更容易稳定触发审批
- `CODEX_BIN=codex` 表示直接从当前环境的 `PATH` 启动 Codex

### 3.3 启动终端审批模式

```bash
./scripts/run_local_demo.sh
```

或者直接运行：

```bash
npm run start -- --approval-mode terminal --cwd /absolute/path/to/your/workspace --prompt "Run the shell command \`mkdir -p /tmp/codex-feishu-approval-demo\` and then tell me done."
```

### 3.4 终端模式的验收标准

你应该能看到类似流程：

1. bridge 启动 `codex app-server`
2. bridge 输出 `thread` 和 `turn` 日志
3. 当 Codex 需要审批时，终端打印审批信息
4. 你输入 `accept` 或 `decline`
5. bridge 记录审批日志
6. Codex 继续执行或停止

只有终端模式跑通后，再进入飞书模式。

## 第 4 步：创建飞书自建应用

在飞书开放平台创建一个自建应用，不要使用群自定义机器人。

建议按下面顺序做：

1. 创建自建应用
2. 开启机器人能力
3. 为应用开通发送消息能力
4. 开启交互卡片相关能力
5. 配置卡片回调地址
6. 把目标审批人加入应用可用范围
7. 发布应用版本

这一步的界面名称可能随飞书平台调整而变化，但 bridge 代码实际依赖的只有以下事实：

- 应用能以 bot 身份发送 `interactive` 消息
- 飞书会把卡片按钮点击回调到你的 HTTP 地址
- 目标审批人能收到该应用发送的卡片

## 第 5 步：准备飞书回调地址

`feishu_client.ts` 会在本机启动一个 HTTP 服务：

- 监听地址：`0.0.0.0`
- 端口：`FEISHU_CALLBACK_PORT`
- 路径：`FEISHU_CALLBACK_PATH`

默认值是：

```text
http://0.0.0.0:3000/webhook/card
```

飞书不能直接访问你的内网地址，所以你需要把它暴露为公网 HTTPS，例如：

- Cloudflare Tunnel
- ngrok
- 你自己的反向代理 / 域名 / Nginx

例如公网地址最终可以是：

```text
https://approval.example.com/webhook/card
```

然后把它转发到 Ubuntu 主机上的：

```text
http://127.0.0.1:3000/webhook/card
```

## 第 6 步：在飞书开放平台配置回调安全信息

在飞书应用里配置卡片回调时，你会拿到或设置安全相关信息。把它们填入 `.env`：

```dotenv
FEISHU_VERIFICATION_TOKEN=...
FEISHU_ENCRYPT_KEY=...
FEISHU_CALLBACK_PORT=3000
FEISHU_CALLBACK_PATH=/webhook/card
```

这里要满足：

- 飞书平台里配置的回调 URL 必须和公网实际地址一致
- 公网地址路径必须和 `FEISHU_CALLBACK_PATH` 一致
- token 和 encrypt key 必须和飞书应用后台的配置一致

## 第 7 步：确定消息发送目标和允许审批的账户

当前实现里，“消息发给谁”和“谁能点击生效”是两套独立配置。

### 7.1 配置消息发送目标

```dotenv
FEISHU_APPROVAL_RECEIVE_ID=ou_xxxxxxxxxx
FEISHU_APPROVAL_RECEIVE_ID_TYPE=open_id
```

说明：

- `FEISHU_APPROVAL_RECEIVE_ID` 是飞书消息接收目标
- `FEISHU_APPROVAL_RECEIVE_ID_TYPE` 说明这个 ID 的类型
- 默认推荐使用 `open_id`

当前代码会把所有审批卡片都发送到这个固定目标。

### 7.2 配置谁的点击会生效

```dotenv
ALLOWED_FEISHU_USERS=ou_xxxxxxxxxx
```

如果你希望“只允许同一个指定账户审批”，最简单的配置就是：

- `FEISHU_APPROVAL_RECEIVE_ID` 填该用户的 `open_id`
- `FEISHU_APPROVAL_RECEIVE_ID_TYPE=open_id`
- `ALLOWED_FEISHU_USERS` 也只填同一个 `open_id`

这样消息发给这个用户，且只有这个用户的点击会被接受。

## 第 8 步：填写完整飞书模式配置

下面是一份最小可运行的飞书模式 `.env` 示例：

```dotenv
# Core
APPROVAL_MODE=feishu
WORKSPACE_CWD=/absolute/path/to/your/workspace
PROMPT=Run the shell command `mkdir -p /tmp/codex-feishu-approval-demo` and then tell me done.

# Codex
CODEX_BIN=codex
CODEX_APP_SERVER_URL=
CODEX_APP_SERVER_PORT=8765
CODEX_MODEL=
CODEX_APPROVAL_POLICY=untrusted
CODEX_SANDBOX=workspace-write
CODEX_REASONING_EFFORT=low

# Feishu
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_APPROVAL_RECEIVE_ID=ou_xxx
FEISHU_APPROVAL_RECEIVE_ID_TYPE=open_id
ALLOWED_FEISHU_USERS=ou_xxx
ALLOW_ACCEPT_FOR_SESSION=true
FEISHU_CALLBACK_PORT=3000
FEISHU_CALLBACK_PATH=/webhook/card

# Optional
ENABLE_PLAN_UPDATE_NOTIFICATIONS=true
CARD_COMMAND_MAX_LEN=220
CARD_REASON_MAX_LEN=180
CARD_FILE_SUMMARY_MAX_LEN=180
```

## 第 9 步：启动飞书审批模式

```bash
npm run start -- --approval-mode feishu --cwd /absolute/path/to/your/workspace --prompt "Run the shell command \`mkdir -p /tmp/codex-feishu-approval-demo\` and then tell me done."
```

如果配置正确，启动日志里应能看到：

- 飞书 callback server 已监听指定端口和路径
- `thread/start` 成功
- `turn/start` 成功
- 审批请求已发送到飞书

## 第 10 步：在飞书中验证 approve / reject

### 验证 approve

1. 等待飞书收到卡片
2. 点击“批准”
3. 观察 bridge 日志应出现类似：
   - 审批请求 ID
   - 审批人 ID
   - `accept`
4. 观察 Codex 继续执行，最后出现 `turn/completed` 或继续输出后续日志

### 验证 reject

1. 再触发一次新的审批请求
2. 在飞书点击“拒绝”
3. 观察 bridge 日志应出现 `decline`
4. 观察对应请求不再被执行，卡片被更新为已拒绝

### 验证白名单

如果由不在 `ALLOWED_FEISHU_USERS` 中的用户点击卡片：

- bridge 会记录 unauthorized 日志
- 该点击不会回传为有效审批决策

## 代码里的审批按钮与含义

当前飞书卡片可能展示这些按钮：

- `批准` -> `accept`
- `本次会话都批准` -> `acceptForSession`
- `拒绝` -> `decline`
- `取消` -> `cancel`

其中：

- `批准` 和 `拒绝` 是你这次场景最核心的两个动作
- `本次会话都批准` 只有在 `ALLOW_ACCEPT_FOR_SESSION=true` 且当前请求本身支持时才显示
- `取消` 是否显示取决于 Codex 返回的 `availableDecisions`

## 环境变量说明

### Core

- `APPROVAL_MODE`
  - `terminal`：只在终端审批
  - `feishu`：发送到飞书审批
  - `auto`：如果飞书关键配置齐全则走飞书，否则回退终端
- `WORKSPACE_CWD`
  - Codex 执行任务时的工作目录
- `PROMPT`
  - bridge 发起 `turn/start` 时传给 Codex 的输入

### Codex

- `CODEX_BIN`
  - `codex` 可执行文件，默认是 `codex`
- `CODEX_APP_SERVER_URL`
  - 如果你要连接一个已经存在的 `app-server`，填它的 WebSocket 地址
  - 留空时，bridge 会自己启动本地 `codex app-server --listen ws://127.0.0.1:<port>`
- `CODEX_APP_SERVER_PORT`
  - bridge 自启本地 `app-server` 时使用的端口，默认 `8765`
- `CODEX_MODEL`
  - 可选，传给 `thread/start`
- `CODEX_APPROVAL_POLICY`
  - 默认 `untrusted`
  - 想稳定演示 approval，优先用 `untrusted`
- `CODEX_SANDBOX`
  - 默认 `workspace-write`
- `CODEX_REASONING_EFFORT`
  - 默认 `low`

### Feishu

- `FEISHU_APP_ID`
  - 飞书应用的 app id
- `FEISHU_APP_SECRET`
  - 飞书应用的 app secret
- `FEISHU_VERIFICATION_TOKEN`
  - 用于卡片回调校验
- `FEISHU_ENCRYPT_KEY`
  - 用于卡片回调加解密
- `FEISHU_APPROVAL_RECEIVE_ID`
  - 审批消息发送目标
- `FEISHU_APPROVAL_RECEIVE_ID_TYPE`
  - `open_id / union_id / user_id / email / chat_id`
- `ALLOWED_FEISHU_USERS`
  - 允许审批生效的飞书用户 ID 列表，逗号分隔
- `ALLOW_ACCEPT_FOR_SESSION`
  - 是否允许展示“本次会话都批准”
- `FEISHU_CALLBACK_PORT`
  - 本地回调监听端口
- `FEISHU_CALLBACK_PATH`
  - 本地回调路径

### Card display

- `ENABLE_PLAN_UPDATE_NOTIFICATIONS`
  - 是否发送计划更新卡片
- `CARD_COMMAND_MAX_LEN`
  - 命令预览最大长度
- `CARD_REASON_MAX_LEN`
  - 原因字段最大长度
- `CARD_FILE_SUMMARY_MAX_LEN`
  - 文件摘要最大长度

## 常见排查

### 飞书没收到卡片

优先检查：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否正确
- 应用是否已发布
- 目标用户是否在应用可用范围内
- `FEISHU_APPROVAL_RECEIVE_ID` 和 `FEISHU_APPROVAL_RECEIVE_ID_TYPE` 是否匹配

### 飞书点了按钮但 bridge 没反应

优先检查：

- 公网 HTTPS 回调地址是否可访问
- 公网路径是否与 `FEISHU_CALLBACK_PATH` 一致
- `FEISHU_VERIFICATION_TOKEN` / `FEISHU_ENCRYPT_KEY` 是否正确
- 反向代理是否把请求转发到了 Ubuntu 主机的正确端口

### bridge 收到了点击，但审批没生效

优先检查：

- 点击用户是否在 `ALLOWED_FEISHU_USERS`
- 同一个审批请求是否已经被别人处理过
- 当前按钮动作是否在 `availableDecisions` 里

### 一直没有 approval 请求

优先检查：

- `PROMPT` 是否真的会触发需要审批的行为
- `CODEX_APPROVAL_POLICY` 是否设置为容易触发审批的模式
- `WORKSPACE_CWD` 是否指向你真正想操作的目录

## 验收清单

满足以下 6 条，基本可以认定这套方案在你的 Ubuntu 环境里跑通：

1. `codex --version` 和 `codex app-server --help` 正常
2. `npm run check` 和 `npm test` 正常
3. 终端模式能收到 approval 并接受/拒绝
4. 飞书模式启动后，指定账户能收到卡片
5. 在飞书点击“批准”后，Codex 继续执行
6. 在飞书点击“拒绝”后，对应动作被拒绝且卡片状态更新

## 参考

- OpenAI Codex CLI app-server：本地命令 `codex app-server --help`
- OpenAI Codex schema：本地命令 `codex app-server generate-json-schema --out <DIR> --experimental`
- 飞书发送消息文档：https://open.feishu.cn/document/server-docs/im-v1/message/create
- 飞书长连接模式文档：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/long-connection-mode
- 飞书 Node SDK：https://github.com/larksuite/node-sdk
