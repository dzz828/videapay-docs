# Videa 外部 API 文档

将 Videa 集成为你网站的**支付和分成引擎**。你的应用负责管理内容和用户；Videa 负责钱包认证、稳定币充值、支付、收益分成以及 F2C 佣金系统。

## 文档

| 文件 | 说明 |
|------|------|
| [API_GUIDE.md](API_GUIDE.md) | 完整的接口参考、交易流程图和集成指南 |
| [openapi.yaml](openapi.yaml) | OpenAPI 3.1 规范（机器可读） |
| [example-app/](example-app/) | 可运行的示例应用（Express + 原生 HTML），演示所有集成流程 |

## 示例应用

`example-app/` 目录包含一个可运行的示例，演示了对接本地或远程 Videa 服务器的认证、充值、购买、订阅和打赏流程。

```bash
cd example-app
npm install
VIDEA_URL=http://localhost:3200 VIDEA_API_KEY=videa_xxx VIDEA_API_KEY_ID=clxxx npm start
```

应用运行在 `http://localhost:4000`（可通过 `PORT` 配置）。

| 环境变量 | 用途 | 默认值 |
|----------|------|--------|
| `VIDEA_URL` | Videa 服务器基础 URL | `http://localhost:3200` |
| `VIDEA_API_KEY` | 完整 API 密钥（`videa_...`） | —（必填） |
| `VIDEA_API_KEY_ID` | API 密钥数据库 ID（弹窗 URL 中用作 `client_id`） | —（弹窗必填） |
| `PORT` | 示例应用端口 | `4000` |

Express 服务端将 API 密钥保留在服务端，对外暴露两个代理接口：
- `POST /api/create-intent` — 创建支付意图（转发至 Videa）
- `POST /api/proxy` — 通用代理，可调用任意 Videa API（自动附加 API 密钥和可选的 Bearer Token）

前端页面（`public/index.html`）演示了打开弹窗、监听 `postMessage` 事件以及发起代理 API 请求的完整流程——可作为 [API_GUIDE.md](API_GUIDE.md) 中所述流程的参考实现。

## 快速开始

### 1. 获取 API 密钥

联系 Videa 团队获取 API 密钥（格式：`videa_<48位十六进制字符>`），并将你的域名添加到 Videa 服务器的 `ALLOWED_ORIGINS` 配置中。

### 2. 通过弹窗集成

所有面向用户的操作均通过 Videa 弹窗完成。你的前端打开弹窗，并通过 `postMessage` 接收结果：

| 操作 | 弹窗 URL | 成功事件 |
|------|---------|----------|
| **认证** | `/authorize?client_id=...&redirect_uri=...&mode=popup` | `videa:authorize:success` |
| **充值** | `/deposit?client_id=...&redirect_uri=...&user_id=...` | `videa:deposit:success` |
| **购买** | `/purchase?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:purchase:success` |
| **订阅** | `/subscribe?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:subscribe:success` |
| **打赏** | `/tip?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:tip:success` |

支付弹窗（购买/订阅/打赏）需要先在服务端创建**支付意图**——详见 [API_GUIDE.md §5](API_GUIDE.md#5-弹窗流程)。

### 3. 通过 REST API 查询

使用 REST API（`/api/v1/external/*`）查询余额、轮询支付状态、查询收益和管理分销链接。完整接口参考详见 [API_GUIDE.md §7](API_GUIDE.md#7-接口参考)。

## 核心概念

- **统一购买模型：** 三种支付类型（购买、订阅、打赏）均创建 Purchase 记录，通过 `category` 字段（`CONTENT`、`SUBSCRIPTION`、`TIP`）区分。状态统一通过 `GET /purchase/{externalTransactionId}` 查询。
- **链上结算：** 支付立即扣除虚拟余额；链上结算异步进行。结算失败后由对账系统自动退款。详见 [API_GUIDE.md §8](API_GUIDE.md#8-链上结算)。
- **收益分成：** 四种收益分成方案控制支付在创作者、分销商和平台之间的分配。详见 [API_GUIDE.md §9](API_GUIDE.md#9-收益分成)。
- **身份认证：** 两种模式——Bearer + API Key 用于用户操作，仅 API Key 用于平台操作。详见 [API_GUIDE.md §3](API_GUIDE.md#3-身份认证)。
