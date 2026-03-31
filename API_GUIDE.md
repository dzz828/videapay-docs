# Videa 外部 API 指南

第三方 Web 应用使用 Videa 作为支付和分成引擎的集成指南。

## 目录

1. [快速开始](#1-快速开始)
2. [集成架构](#2-集成架构)
3. [身份认证](#3-身份认证)
4. [CORS 配置](#4-cors-配置)
5. [弹窗流程](#5-弹窗流程)
6. [充值流程](#6-充值流程)
7. [接口参考](#7-接口参考)
8. [链上结算](#8-链上结算)
9. [收益分成](#9-收益分成)
10. [速率限制](#10-速率限制)
11. [错误处理](#11-错误处理)

---

## 1. 快速开始

### 基础 URL

| 环境 | URL |
|------|-----|
| 生产环境 | `https://api.videa.app` |
| 开发环境 | `http://localhost:3200` |

### API 密钥

请联系 Videa 团队获取 API 密钥，格式如下：

```
videa_<48位十六进制字符>
```

### 认证类型

外部接口使用两种认证模式：

| 认证类型 | 所需请求头 | 用途 |
|---------|-----------|------|
| **Bearer + API Key** | `Authorization: Bearer <token>` + `X-API-Key: videa_...` | 用户级查询（余额、购买状态、收益） |
| **仅 API Key** | `X-API-Key: videa_...` | 平台级操作（收益方案） |

### 支持的代币和链

| 代币 | 精度 |
|------|------|
| USDT | 6（ERC-20） |
| USDC | 6（ERC-20） |

| 链 | Chain ID | 环境 |
|----|----------|------|
| Polygon | 137 | 生产环境 |
| Polygon Amoy | 80002 | 测试网 |
| BSC | 56 | 生产环境 |
| BSC Testnet | 97 | 测试网 |

---

## 2. 集成架构

```
┌─────────────────────┐     ┌──────────────────────────────────────────┐
│   你的 Web 应用      │     │              Videa 平台                  │
│                     │     │                                          │
│  ┌───────────────┐  │     │  ┌──────────────┐ ┌─────────────────┐   │
│  │ 内容管理      │  │     │  │ 弹窗         │ │ 外部 API        │   │
│  │ & 用户管理    │  │     │  │ 认证 + 充值  │ │/api/v1/external│   │
│  └───────┬───────┘  │     │  │ 购买         │ │                 │   │
│          │          │     │  │ 订阅         │ │ 购买/订阅/打赏  │   │
│  ┌───────┴───────┐  │     │  │ 打赏         │ │ 分销链接        │   │
│  │ 前端          │──┼─────┼──┤              │ │                 │   │
│  │ (postMessage) │  │     │  └──────┬───────┘ └────────┬────────┘   │
│  └───────┬───────┘  │     │         │                  │            │
│          │          │     │  ┌──────┴──────────────────┴────────┐   │
│  ┌───────┴───────┐  │     │  │ 支付引擎                         │   │
│  │ 后端          │──┼─────┼──┤ 余额 → ActionExecutor →          │   │
│  │ (REST 调用)   │  │     │  │ 链上 VimoVault 结算               │   │
│  └───────────────┘  │     │  └──────────────────────────────────┘   │
└─────────────────────┘     └──────────────────────────────────────────┘
```

### 弹窗集成

所有支付操作通过 Videa 弹窗完成——用户在弹窗中连接钱包、检查余额并确认支付，你的前端通过 `postMessage` 接收结果。无需在你的应用中处理 bearer token。

| 操作 | 弹窗 URL | 成功事件 |
|------|---------|----------|
| **认证** | `/authorize?client_id=...&redirect_uri=...&mode=popup` | `videa:authorize:success` |
| **充值** | `/deposit?client_id=...&redirect_uri=...` | `videa:deposit:success` |
| **购买** | `/purchase?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:purchase:success` |
| **订阅** | `/subscribe?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:subscribe:success` |
| **打赏** | `/tip?client_id=...&redirect_uri=...&user_id=...&intent_id=...` | `videa:tip:success` |

REST API（`/api/v1/external/*`）仅用于查询操作（余额、购买状态、收益等）和分销链接管理。

**你的应用负责：**
- 内容管理和展示
- 用户会话和权限
- 存储购买记录（或查询 Videa）
- 触发充值和支付（通过弹窗或 REST API）

**Videa 负责：**
- 钱包认证（SIWE）
- 链上充值（ERC20 → VimoVault）
- 虚拟余额管理（按链划分）
- 弹窗内完成购买、订阅、打赏流程（含余额检查和充值引导）— 三种支付类型均创建 Purchase 记录，通过 `category` 字段（`CONTENT`、`SUBSCRIPTION`、`TIP`）区分
- 支付执行和收益分成
- 通过 VimoVault 智能合约进行链上结算

---

## 3. 身份认证

用户通过 SIWE（Sign-In with Ethereum）使用 OAuth 授权码流程进行认证。

### Bearer Token 详情

- Token 有效期 **24 小时**
- 过期前使用 `POST /api/auth/token/refresh` 配合 `Authorization: Bearer <当前token>` 刷新
- **刷新次数无限制** — 在 token 有效期内及过期后 **1 小时宽限期** 内均可刷新，每次刷新返回新的 24 小时 token，可实现无限期会话
- Token 刷新受 API 速率限制约束（认证端点：30 次/分钟）
- Token 包含：`userId`、`walletAddress`、`sessionVersion`
- 若用户的 `sessionVersion` 变更（如重置密码），现有 token 将失效
- 若 API Key 被停用或过期，token 刷新将被拒绝

### 弹窗认证流程

```
你的前端                          Videa 弹窗                       Videa 后端
  │                                  │                                │
  │  window.open('/authorize         │                                │
  │    ?client_id=videa_xxx          │                                │
  │    &redirect_uri=https://app.com/callback                        │
  │    &mode=popup                   │                                │
  │    &user_id=clx... (可选)')      │                                │
  │─────────────────────────────────>│                                │
  │                                  │                                │
  │                                  │  用户连接钱包                   │
  │                                  │  (RainbowKit)                  │
  │                                  │                                │
  │                                  │  GET /api/auth/token/nonce     │
  │                                  │  ?client_id=videa_xxx          │
  │                                  │───────────────────────────────>│
  │                                  │  { nonce: "abc123..." }        │
  │                                  │<───────────────────────────────│
  │                                  │                                │
  │                                  │  用户签名 SIWE 消息             │
  │                                  │                                │
  │                                  │  POST /api/auth/authorize      │
  │                                  │  { client_id, redirect_uri,    │
  │                                  │    message, signature }        │
  │                                  │───────────────────────────────>│
  │                                  │  { code: "auth_code..." }      │
  │                                  │<───────────────────────────────│
  │                                  │                                │
  │  postMessage({                   │                                │
  │    type: 'videa:authorize:success',│                               │
  │    code                          │                                │
  │  }, targetOrigin)                │                                │
  │<─────────────────────────────────│                                │
  │                                  │                                │
你的后端                                              Videa 后端
  │                                                │
  │  POST /api/auth/token/exchange                 │
  │  X-API-Key: videa_xxx                          │
  │  { code, redirect_uri }                        │
  │───────────────────────────────────────────────>│
  │  { token, expiresAt, user }                    │
  │  user.id 即为用户 ID，用于后续                    │
  │  API 调用（creatorUserId 等）                    │
  │<───────────────────────────────────────────────│
  │                                                │
  │  安全存储 token 和 user.id                       │
  │  在过期前安排刷新                                │
```

### 授权码流程（服务端对服务端）

如果你在自己的 UI 中处理钱包签名：

```
你的前端                                           Videa 后端
  │                                                │
  │  GET /api/auth/token/nonce                     │
  │  ?client_id=<api_key_id>                       │
  │───────────────────────────────────────────────>│
  │  { nonce: "abc123..." }                        │
  │<───────────────────────────────────────────────│
  │                                                │
  │  （用户使用钱包签名 SIWE 消息）                   │
  │                                                │
  │  POST /api/auth/authorize                      │
  │  { client_id, redirect_uri,                    │
  │    message, signature }                        │
  │───────────────────────────────────────────────>│
  │  { code: "auth_code..." }                      │
  │<───────────────────────────────────────────────│
  │                                                │
你的后端                                           Videa 后端
  │                                                │
  │  POST /api/auth/token/exchange                 │
  │  X-API-Key: videa_xxx                          │
  │  { code, redirect_uri }                        │
  │───────────────────────────────────────────────>│
  │  { token, expiresAt, user }                    │
  │<───────────────────────────────────────────────│
  │                                                │
  │  POST /api/auth/token/refresh                  │
  │  Authorization: Bearer <token>                 │
  │  （24小时过期前刷新）                             │
  │───────────────────────────────────────────────>│
  │  { token, expiresAt }                          │
  │<───────────────────────────────────────────────│
```

### 代码示例

#### JavaScript / TypeScript

```typescript
const API_BASE = "https://api.videa.app";
const API_KEY = "videa_your_key_here";
const CLIENT_ID = "your_api_key_id"; // API 密钥记录 ID
const REDIRECT_URI = "https://yourapp.com/callback"; // 必须已注册

// 第1步：获取 nonce
const { nonce } = await fetch(
  `${API_BASE}/api/auth/token/nonce?client_id=${CLIENT_ID}`
).then((r) => r.json());

// 第2步：构建并签名 SIWE 消息（使用你的钱包库）
const siweMessage = buildSiweMessage({ nonce, address: walletAddress });
const signature = await wallet.signMessage(siweMessage);

// 第3步：获取授权码
const { code } = await fetch(`${API_BASE}/api/auth/authorize`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    message: JSON.stringify(siweMessage),
    signature,
  }),
}).then((r) => r.json());

// 第4步：用授权码换取 bearer token（服务端对服务端）
const { token, expiresAt, user } = await fetch(
  `${API_BASE}/api/auth/token/exchange`,
  {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
  }
).then((r) => r.json());

// 第5步：发起已认证的请求
const { balances } = await fetch(`${API_BASE}/api/v1/external/balance`, {
  headers: {
    Authorization: `Bearer ${token}`,
    "X-API-Key": API_KEY,
  },
}).then((r) => r.json());
```

#### curl

```bash
# 第1步：获取 nonce
NONCE=$(curl -s \
  "https://api.videa.app/api/auth/token/nonce?client_id=$CLIENT_ID" \
  | jq -r '.nonce')

# 第3步：获取授权码
CODE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "{\"client_id\": \"$CLIENT_ID\", \"redirect_uri\": \"$REDIRECT_URI\", \
       \"message\": \"$SIWE_MESSAGE\", \"signature\": \"$SIGNATURE\"}" \
  https://api.videa.app/api/auth/authorize | jq -r '.code')

# 第4步：用授权码换取 token（服务端对服务端）
TOKEN=$(curl -s -X POST \
  -H "X-API-Key: videa_your_key_here" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"$CODE\", \"redirect_uri\": \"$REDIRECT_URI\"}" \
  https://api.videa.app/api/auth/token/exchange | jq -r '.token')

# 第5步：使用 token
curl -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Key: videa_your_key_here" \
  https://api.videa.app/api/v1/external/balance
```

---

## 4. CORS 配置

你的 Web 应用域名必须添加到 Videa 服务器的 `ALLOWED_ORIGINS` 环境变量中：

```
ALLOWED_ORIGINS=https://myapp.example.com,https://staging.myapp.example.com
```

配置完成后，API 响应头包含：

```
Access-Control-Allow-Origin: https://myapp.example.com
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key, Idempotency-Key
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

移动端应用（iOS/Android）不发送 `Origin` 头，因此无需 CORS 配置。

---

## 5. 弹窗流程

### 弹窗认证

无需构建自己的钱包连接 UI 即可认证用户：

```
1. 你的应用打开弹窗：
   window.open('/authorize?client_id=videa_xxx&redirect_uri=https://yourapp.com/callback&mode=popup&user_id=clx...')

2. 用户在弹窗中通过 RainbowKit 连接钱包
3. 用户签名 SIWE 消息
4. 弹窗通过 postMessage 回传给你的应用：
   window.opener.postMessage({
     type: 'videa:authorize:success',
     code: 'authorization_code_here',
     state: '...'
   }, targetOrigin)
5. 你的后端用授权码换取 bearer token：
   POST /api/auth/token/exchange（需要 X-API-Key）
   { "code": "...", "redirect_uri": "https://yourapp.com/callback" }
   响应中的 user.id 应保存用于后续 API 调用（如 creatorUserId、distributorUserId）
6. 错误时：{ type: 'videa:authorize:error', error: '...' }
7. 关闭时：{ type: 'videa:authorize:closed' }

可选 URL 参数：
   - user_id：Videa 用户 ID（从 token exchange 获取），用于标识用户。弹窗会验证连接的钱包是否属于该用户
```

### 弹窗充值

让用户无需构建自己的充值 UI 即可充值。弹窗自行处理钱包认证（SIWE）——不需要从父窗口传递 bearer token：

```
1. 你的应用打开弹窗：
   window.open('/deposit?client_id=videa_xxx&redirect_uri=https://yourapp.com&user_id=clx...')

   可选 URL 参数：
   - user_id：Videa 用户 ID（从 token exchange 获取），用于标识充值用户。弹窗会验证连接的钱包是否属于该用户
   - wallet_address：指定钱包地址（弹窗会拒绝不匹配的地址）
   - state：CSRF token，会在成功消息中回传

2. 弹窗连接钱包，内部执行 SIWE 认证
3. 用户选择链/代币/金额，批准 ERC20，向 VimoVault 充值
4. 弹窗回传给父窗口：
   - 成功：{ type: 'videa:deposit:success', transactionHash, chainId, amount, token, state }
   - 错误：{ type: 'videa:deposit:error', error: '...' }
   - 关闭：{ type: 'videa:deposit:closed' }
```

**安全性：** Bearer token 在 Videa 域的弹窗中创建和使用，永远不会暴露给父窗口。父窗口只接收充值结果。

### 支付意图（Payment Intent）

所有支付弹窗（购买、订阅、打赏）**必须使用支付意图**。你的服务器通过 API 创建支付意图，弹窗只接收一个不透明的 `intent_id`。参数不经过浏览器，无法被篡改。

**流程：**

```
你的后端                          Videa API                       你的前端                    Videa 弹窗
  │                                  │                               │                          │
  │  POST /payment-intents           │                               │                          │
  │  { type, creatorUserId,          │                               │                          │
  │    amount, revenuePlan, ... }    │                               │                          │
  │─────────────────────────────────>│                               │                          │
  │                                  │                               │                          │
  │  { intentId, expiresAt }         │                               │                          │
  │<─────────────────────────────────│                               │                          │
  │                                  │                               │                          │
  │  返回 intentId 给前端            │                               │                          │
  │──────────────────────────────────────────────────────────────────>│                          │
  │                                  │                               │                          │
  │                                  │                               │  window.open('/purchase  │
  │                                  │                               │    ?intent_id=clx...')   │
  │                                  │                               │─────────────────────────>│
  │                                  │                               │                          │
  │                                  │  GET /payment-intents/{id}    │                          │
  │                                  │<─────────────────────────────────────────────────────────│
  │                                  │  返回意图参数                  │                          │
  │                                  │─────────────────────────────────────────────────────────>│
  │                                  │                               │                          │
  │                                  │                               │                          │  用户确认支付
  │                                  │  POST /purchase               │                          │
  │                                  │  { intentId, chainId, token } │                          │
  │                                  │<─────────────────────────────────────────────────────────│
  │                                  │                               │                          │
  │                                  │  意图标记为已完成（不可重用） │                          │
  │                                  │                               │  postMessage 返回结果    │
  │                                  │                               │<─────────────────────────│
```

**创建支付意图**（服务端到服务端，仅 API Key 认证）：

```
POST /api/v1/external/payment-intents
Headers: X-API-Key: videa_xxx
Content-Type: application/json

请求体（购买）：
{
  "type": "purchase",
  "creatorUserId": "clx...",
  "externalContentId": "your-content-123",
  "externalTransactionId": "your-tx-123",
  "amount": 4.99,
  "revenuePlan": "BALANCED",
  "distributionLinkCode": "abc123...",   // 可选
  "chainId": 137,                        // 可选，不传则用户在弹窗中选择
  "token": "USDT"                        // 可选
}

请求体（订阅）：
{
  "type": "subscribe",
  "creatorUserId": "clx...",
  "externalTransactionId": "your-sub-123",
  "amount": 9.99,
  "revenuePlan": "BALANCED"
}

请求体（打赏）：
{
  "type": "tip",
  "creatorUserId": "clx...",
  "externalTransactionId": "your-tip-123",
  "amount": 10,
  "revenuePlan": "BALANCED"
}

响应：
{ "intentId": "clx...", "expiresAt": "2025-01-01T00:30:00.000Z" }
```

**使用支付意图打开弹窗**（前端）：

```javascript
const popup = window.open(
  `https://api.videa.app/purchase` +
  `?client_id=${API_KEY_ID}` +
  `&redirect_uri=${encodeURIComponent(window.location.origin)}` +
  `&user_id=${encodeURIComponent(userId)}` +
  `&intent_id=${encodeURIComponent(intentId)}`,
  'videa_purchase', 'width=450,height=700,left=200,top=100'
);
// postMessage 事件与原流程完全相同
```

**意图属性：**
- 有效期 **30 分钟**
- 一个意图只能使用一次（单次使用）
- 绑定创建它的 API Key
- 支持的类型：`purchase`、`subscribe`、`tip`

---

### 支付弹窗共用事件

> **重要：** 所有支付弹窗（购买、订阅、打赏）必须使用[支付意图](#支付意图payment-intent推荐方式)。不再支持通过 URL 参数直接传递支付参数。

> **统一购买模型：** 三种支付类型（购买、订阅、打赏）均创建 Purchase 记录，通过 `category` 字段区分：`CONTENT`（购买）、`SUBSCRIPTION`（订阅）、`TIP`（打赏）。所有类型都要求 `externalTransactionId`。对于订阅和打赏，`externalTransactionId` 同时用作 `externalContentId`。所有支付状态均通过 `GET /api/v1/external/purchase/{id}` 查询。

所有支付弹窗（购买、订阅、打赏）共享以下两个事件：

| 事件类型 | 含义 |
|---------|------|
| `videa:popup:closed` | 用户在未完成操作的情况下关闭了弹窗 |
| `videa:popup:error` | SIWE 认证失败 |

所有支付弹窗的必填公共 URL 参数：

| 参数 | 说明 |
|-----|------|
| `user_id` | Videa 用户 ID（从 token exchange 获取）— 弹窗会验证连接的钱包是否属于该用户 |
| `intent_id` | 支付意图 ID（从 `POST /api/v1/external/payment-intents` 获取）— 包含所有支付参数 |

所有支付弹窗的可选公共 URL 参数：

| 参数 | 说明 |
|-----|------|
| `wallet_address` | 指定钱包地址，弹窗会拒绝不匹配的地址 |
| `state` | CSRF token，会在成功/错误消息中回传 |

### 弹窗购买

无需 bearer token，让用户通过弹窗购买内容。支付参数通过[支付意图](#支付意图payment-intent)传递，不经过浏览器：

```
URL 参数：
  必填：client_id, redirect_uri, user_id, intent_id
  可选：wallet_address, state, content_name, creator_name
```

- `content_name`：内容名称（可选），传入后弹窗会显示为 "内容名称 (content-id)"，未传入则只显示 content ID。
- `creator_name`：创作者名称（可选），传入后弹窗会在内容信息下方显示创作者名称。

**时序：**

```
你的前端                          Videa 弹窗
  │                                  │
  │  window.open('/purchase          │
  │    ?client_id=videa_xxx          │
  │    &redirect_uri=https://app.com │
  │    &user_id=clx...               │
  │    &intent_id=clx...')           │
  │─────────────────────────────────>│
  │                                  │
  │                                  │  弹窗从意图加载支付参数
  │                                  │  用户连接钱包、SIWE 签名
  │                                  │  检查是否已购买（若已购买则
  │                                  │  直接返回成功并自动关闭）
  │                                  │  检查余额，如不足可充值
  │                                  │  用户确认购买
  │                                  │  POST /api/v1/external/purchase
  │                                  │
  │  postMessage({                   │
  │    type: 'videa:purchase:success',│
  │    purchaseId: 'clx...',         │
  │    contentId: 'prod-123',        │
  │    externalTransactionId:         │
  │      'your-tx-123',              │
  │    duplicate: false,              │
  │    state: '...'                  │
  │  }, targetOrigin)                │
  │<─────────────────────────────────│
  │                                  │  2 秒后自动关闭
  │  错误时：{                        │
  │    type: 'videa:purchase:error', │
  │    error: '...'                  │
  │  }                               │
```

**JavaScript 示例：**

```javascript
const popup = window.open(
  `https://api.videa.app/purchase` +
  `?client_id=${API_KEY_ID}` +
  `&redirect_uri=${encodeURIComponent(window.location.origin)}` +
  `&user_id=${encodeURIComponent(userId)}` +
  `&intent_id=${encodeURIComponent(intentId)}`,
  'videa_purchase', 'width=450,height=700,left=200,top=100'
);

window.addEventListener('message', function handler(event) {
  const expectedOrigin = new URL('https://api.videa.app').origin;
  if (event.origin !== expectedOrigin) return;

  if (event.data.type === 'videa:purchase:success') {
    window.removeEventListener('message', handler);
    if (event.data.duplicate) {
      console.log('用户已购买过该内容', event.data.purchaseId);
    } else {
      console.log('购买成功', event.data.purchaseId);
    }
  } else if (event.data.type === 'videa:purchase:error') {
    window.removeEventListener('message', handler);
    console.error('购买失败', event.data.error);
  } else if (event.data.type === 'videa:popup:closed') {
    window.removeEventListener('message', handler);
    console.log('用户取消了购买');
  }
});
```

---

### 弹窗订阅

无需 bearer token，让用户通过弹窗订阅创作者。支付参数通过[支付意图](#支付意图payment-intent)传递。订阅创建 Purchase 记录（`category: SUBSCRIPTION`），`externalTransactionId` 同时用作 `externalContentId`。如果用户已有相同 `externalTransactionId` 的购买记录，弹窗会自动检测并直接返回成功（`duplicate: true`），无需用户操作：

```
URL 参数：
  必填：client_id, redirect_uri, user_id, intent_id
  可选：wallet_address, state
  显示自定义（可选）：
    price_label      — 价格标签（默认 "Monthly Price"）
    price_suffix     — 价格后缀（默认 "/mo"）
    price_description — 描述文字（默认 "30-day subscription period with auto-renewal"）
    button_label     — 按钮文字（默认 "Subscribe $X.XX/mo"）
```

**JavaScript 示例：**

```javascript
const popup = window.open(
  `https://api.videa.app/subscribe` +
  `?client_id=${API_KEY_ID}` +
  `&redirect_uri=${encodeURIComponent(window.location.origin)}` +
  `&user_id=${encodeURIComponent(userId)}` +
  `&intent_id=${encodeURIComponent(intentId)}` +
  `&price_label=${encodeURIComponent('Weekly Price')}` +
  `&price_suffix=${encodeURIComponent('/wk')}` +
  `&price_description=${encodeURIComponent('7-day subscription period')}`,
  'videa_subscribe', 'width=450,height=700,left=200,top=100'
);

window.addEventListener('message', function handler(event) {
  if (event.origin !== new URL('https://api.videa.app').origin) return;

  if (event.data.type === 'videa:subscribe:success') {
    window.removeEventListener('message', handler);
    // { purchaseId, externalTransactionId, duplicate?, state? }
    if (event.data.duplicate) {
      console.log('用户已有该订阅', event.data.purchaseId);
    } else {
      console.log('订阅成功', event.data.purchaseId);
    }
  } else if (event.data.type === 'videa:subscribe:error') {
    window.removeEventListener('message', handler);
    console.error('订阅失败', event.data.error);
  } else if (event.data.type === 'videa:popup:closed') {
    window.removeEventListener('message', handler);
  }
});
```

**postMessage 事件：**

| 事件类型 | 数据字段 | 说明 |
|---------|---------|------|
| `videa:subscribe:success` | `purchaseId`, `externalTransactionId`, `duplicate?`, `state?` | 订阅成功（`duplicate: true` 表示已有相同记录） |
| `videa:subscribe:error` | `error`, `state?` | 订阅失败 |
| `videa:popup:closed` | — | 用户取消 |

---

### 弹窗打赏

无需 bearer token，让用户通过弹窗向创作者打赏。打赏创建 Purchase 记录（`category: TIP`），`externalTransactionId` 同时用作 `externalContentId`。支付参数通过[支付意图](#支付意图payment-intent)传递：

```
URL 参数：
  必填：client_id, redirect_uri, user_id, intent_id
  可选：wallet_address, state, creator_name
```

`creator_name`：创作者名称（可选），传入后弹窗标题显示为 "Send a Tip to 创作者名称"。

**JavaScript 示例：**

```javascript
const popup = window.open(
  `https://api.videa.app/tip` +
  `?client_id=${API_KEY_ID}` +
  `&redirect_uri=${encodeURIComponent(window.location.origin)}` +
  `&user_id=${encodeURIComponent(userId)}` +
  `&intent_id=${encodeURIComponent(intentId)}`,
  'videa_tip', 'width=450,height=700,left=200,top=100'
);

window.addEventListener('message', function handler(event) {
  if (event.origin !== new URL('https://api.videa.app').origin) return;

  if (event.data.type === 'videa:tip:success') {
    window.removeEventListener('message', handler);
    // { purchaseId, amount, externalTransactionId, state? }
    console.log('打赏成功', event.data.purchaseId, '金额', event.data.amount);
  } else if (event.data.type === 'videa:tip:error') {
    window.removeEventListener('message', handler);
    console.error('打赏失败', event.data.error);
  } else if (event.data.type === 'videa:popup:closed') {
    window.removeEventListener('message', handler);
  }
});
```

**postMessage 事件：**

| 事件类型 | 数据字段 | 说明 |
|---------|---------|------|
| `videa:tip:success` | `purchaseId`, `amount`, `externalTransactionId`, `state?` | 打赏成功 |
| `videa:tip:error` | `error`, `state?` | 打赏失败 |
| `videa:popup:closed` | — | 用户取消 |

---

## 6. 充值流程

用户在进行支付前，必须先将稳定币（USDT/USDC）充值到 Videa 的 VimoVault 智能合约。

### 弹窗充值时序

```
你的前端                          Videa 弹窗                       Videa 后端
  │                                  │                                │
  │  window.open('/deposit           │                                │
  │    ?client_id=videa_xxx          │                                │
  │    &redirect_uri=https://app.com │                                │
  │    &user_id=clx... (可选)        │                                │
  │    &wallet_address=0x... (可选)  │                                │
  │    &state=csrf123 (可选)')       │                                │
  │─────────────────────────────────>│                                │
  │                                  │                                │
  │                                  │  用户连接钱包                   │
  │                                  │  (RainbowKit)                  │
  │                                  │                                │
  │                                  │  （若指定了 wallet_address，    │
  │                                  │   验证地址匹配）                │
  │                                  │                                │
  │                                  │  GET /api/auth/token/nonce     │
  │                                  │  ?client_id=videa_xxx          │
  │                                  │───────────────────────────────>│
  │                                  │  { nonce: "abc123..." }        │
  │                                  │<───────────────────────────────│
  │                                  │                                │
  │                                  │  用户签名 SIWE 消息             │
  │                                  │                                │
  │                                  │  POST /api/auth/authorize      │
  │                                  │  { message, signature,         │
  │                                  │    client_id, redirect_uri,    │
  │                                  │    response_type: "token" }    │
  │                                  │───────────────────────────────>│
  │                                  │  { token: "eyJ..." }           │
  │                                  │<───────────────────────────────│
  │                                  │                                │
  │                                  │  用户选择链/代币/金额           │
  │                                  │  1. ERC20 授权（链上）          │
  │                                  │  2. vault.deposit()（链上）     │
  │                                  │                                │
  │                                  │  POST /api/account/deposits    │
  │                                  │  Authorization: Bearer <token> │
  │                                  │  { txHash, chainId, token,     │
  │                                  │    amount }                    │
  │                                  │───────────────────────────────>│
  │                                  │  201 { status: "PENDING" }     │
  │                                  │<───────────────────────────────│
  │                                  │                                │
  │  postMessage({                   │    DepositWatcher 监控          │
  │    type: 'videa:deposit:success',│    链上确认                     │
  │    transactionHash, chainId,     │    PENDING → CONFIRMING        │
  │    amount, token, state          │    → CREDITED（余额已更新）     │
  │  }, targetOrigin)                │                                │
  │<─────────────────────────────────│                                │
```

### 余额查询

充值确认后，查询用户余额：

```
GET /api/v1/external/balance
Authorization: Bearer <token>
X-API-Key: videa_xxx

响应：
{
  "balances": [
    {
      "chainId": 137,
      "token": "USDT",
      "availableBalance": "100.000000",
      "pendingBalance": "0.000000"
    }
  ]
}
```

---

## 7. 接口参考

所有外部接口位于 `/api/v1/external/` 路径下。

### 收益方案

#### GET /api/v1/external/revenue-plans

**认证：** 仅 API Key

列出可用的收益分成方案。

**响应：**

```json
{
  "plans": [
    { "id": "BALANCED", "name": "Balanced", "creatorPercent": 70, "distributorPercent": 20, "platformPercent": 10 },
    { "id": "CHANNEL_PRIORITY", "name": "Channel Priority", "creatorPercent": 60, "distributorPercent": 30, "platformPercent": 10 },
    { "id": "STRONG_CHANNEL", "name": "Strong Channel", "creatorPercent": 50, "distributorPercent": 40, "platformPercent": 10 },
    { "id": "CREATOR_PRIORITY", "name": "Creator Priority", "creatorPercent": 80, "distributorPercent": 10, "platformPercent": 10 }
  ]
}
```

---

### 用户资料

#### GET /api/v1/external/user/{userId}/profile

**认证：** Bearer Token + API Key

获取用户资料。认证用户必须与 URL 中的 userId 匹配。

**响应：**

```json
{
  "nickname": "用户昵称"
}
```

> `nickname` 可能为 `null`（用户尚未设置昵称时）。

---

### 用户昵称

#### PUT /api/v1/external/user/{userId}/nickname

**认证：** Bearer Token + API Key

更新用户昵称。认证用户必须与 URL 中的 userId 匹配。

**请求体：**

```json
{
  "nickname": "新昵称"
}
```

**验证规则：**
- `nickname`：必填，字符串，去除首尾空格后 1-100 个字符

**响应：**

```json
{
  "nickname": "新昵称"
}
```

---

### 购买（统一支付模型）

所有支付（购买、订阅、打赏）均创建 Purchase 记录，通过 `category` 字段区分类型：`CONTENT`（购买）、`SUBSCRIPTION`（订阅）、`TIP`（打赏）。购买通过[弹窗购买](#弹窗购买)完成。以下 GET 接口用于查询所有支付类型的状态。

#### GET /api/v1/external/purchase/{id}

**认证：** Bearer + API Key。获取购买/订阅/打赏详情和链上结算状态。`{id}` 为 `externalTransactionId`。

**响应：**

```json
{
  "purchase": {
    "id": "clx...",
    "category": "CONTENT",
    "externalContentId": "product-123",
    "externalTransactionId": "your-tx-123",
    "creatorId": "clx...",
    "amount": "19.990000",
    "currency": "USDT",
    "chainId": 137,
    "createdAt": "2026-03-07T..."
  },
  "action": {
    "id": "clx...",
    "status": "COMPLETED",
    "executionTxHash": "0x...",
    "explorerUrl": "https://polygonscan.com/tx/0x...",
    "executedAt": "2026-03-07T...",
    "errorMessage": null
  }
}
```

`category` 值：`CONTENT`（购买）、`SUBSCRIPTION`（订阅）、`TIP`（打赏）。

操作状态流转：`PENDING` → `EXECUTING` → `COMPLETED`（或 `FAILED` / `PERMANENTLY_FAILED`）。

订阅和打赏均创建 Purchase 记录，状态查询使用 `GET /api/v1/external/purchase/{id}`（`{id}` 为 `externalTransactionId`）。Purchase 记录的 `category` 字段标识支付类型：`CONTENT`（购买）、`SUBSCRIPTION`（订阅）、`TIP`（打赏）。

订阅通过[弹窗订阅](#弹窗订阅)完成。打赏通过[弹窗打赏](#弹窗打赏)完成。禁止自我购买、自我订阅和自我打赏。

---

### 余额

#### GET /api/v1/external/balance

**认证：** Bearer + API Key。获取认证用户的按链余额。

**响应：**

```json
{
  "balances": [
    {
      "chainId": 137,
      "token": "USDT",
      "availableBalance": "100.000000",
      "pendingBalance": "0.000000",
      "totalDeposited": "150.000000",
      "totalSpent": "50.000000",
      "totalWithdrawn": "0.000000"
    }
  ]
}
```

---

### 分销链接

#### POST /api/v1/external/distribution-links

**认证：** Bearer + API Key。创建外部分销链接。

外部应用独立管理自己的授权——创建分销链接前无需调用授权接口。

**请求体：**

```json
{
  "creatorUserId": "clx...",
  "distributorUserId": "clx..."
}
```

**响应 (201)：**

```json
{
  "success": true,
  "link": {
    "id": "clx...",
    "linkCode": "a1b2c3d4e5f6...",
    "linkType": "external",
    "creatorId": "clx...",
    "distributorId": "clx...",
    "isActive": true,
    "createdAt": "2026-03-07T..."
  }
}
```

在购买/订阅/打赏请求中将 `linkCode` 作为 `distributionLinkCode` 传入，以追踪推荐并分成。

#### 分销交易流程

```
你的后端                                    Videa API
  │                                               │
  │  ① 创建分销链接                                │
  │  POST /api/v1/external/distribution-links     │
  │  Authorization: Bearer <token>                │
  │  X-API-Key: videa_xxx                         │
  │  { creatorUserId: "clxCreator",               │
  │    distributorUserId: "clxDist" }             │
  │──────────────────────────────────────────────>│
  │  201 { link: { linkCode: "a1b2c3..." } }     │
  │<──────────────────────────────────────────────│
  │                                               │
  │  ② 创建支付意图时带上 linkCode 和 revenuePlan   │
  │  POST /api/v1/external/payment-intents        │
  │  { ...,                                       │
  │    distributionLinkCode: "a1b2c3...",         │
  │    revenuePlan: "BALANCED" }                  │
  │──────────────────────────────────────────────>│
  │  201 { intent: { id: "clx..." } }            │
  │<──────────────────────────────────────────────│
  │                                               │
  │  ③ 弹窗仅使用 intent_id                        │
  │  /purchase?...&intent_id=clx...               │
  │                                               │
  │  收益按方案分配：                               │
  │  创作者：70%，分销商：20%，平台：10%            │
  │                                               │
  │  ④ 通过分销商的首次支付会锁定一个 2 年的        │
  │  佣金关系。该粉丝对该创作者的所有后续支付        │
  │  都会自动包含分销商的分成。                      │
  │                                               │
  │  revenuePlan 控制创建新的粉丝-分销商关系时       │
  │  锁定的方案。若省略，使用创作者的默认方案。       │
  │  已锁定的关系不受影响。                         │
```

#### DELETE /api/v1/external/distribution-links

**认证：** Bearer + API Key。停用分销链接，使其无法再用于新的推荐。认证用户必须是该链接的创作者或分销商。

**请求体：**

```json
{
  "linkCode": "a1b2c3d4e5f6..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `linkCode` | string | 二选一 | 32 位十六进制链接码 |
| `linkId` | string | 二选一 | 链接记录 ID |

提供 `linkCode` 或 `linkId` 其中之一即可。

**响应 (200)：**

```json
{
  "success": true,
  "link": {
    "id": "clx...",
    "linkCode": "a1b2c3d4...",
    "isActive": false
  }
}
```

若链接已停用，响应包含 `"alreadyDeactivated": true`。

#### GET /api/v1/external/distribution-links

**认证：** Bearer + API Key。列出分销链接。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `creatorUserId` | string | 二选一 | 按创作者筛选 |
| `distributorUserId` | string | 二选一 | 按分销商筛选 |
| `limit` | number | 否 | 每页条数（默认：20，最大：100） |
| `offset` | number | 否 | 分页偏移量（默认：0） |

至少提供 `creatorUserId` 或 `distributorUserId` 其中之一。

**响应：**

```json
{
  "links": [
    {
      "id": "clx...",
      "linkCode": "a1b2c3d4...",
      "linkType": "external",
      "creatorId": "clx...",
      "distributorId": "clx...",
      "isActive": true,
      "clickCount": 150,
      "conversionCount": 12,
      "totalRevenue": "240.000000",
      "distributorEarnings": "48.000000",
      "creatorNickname": "Creator Name",
      "distributorNickname": "Distributor Name",
      "authorizationRevokedAt": null,
      "createdAt": "2026-03-07T..."
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### 收益

#### GET /api/v1/external/creator/earnings

**认证：** Bearer + API Key。获取创作者收益摘要和交易历史。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `creatorUserId` | string | 是 | 创作者用户 ID |
| `limit` | number | 否 | 每页条数（默认：20） |
| `offset` | number | 否 | 分页偏移量（默认：0） |

**响应：**

```json
{
  "summary": {
    "totalEarnings": 1500.50,
    "thisMonth": 250.00
  },
  "breakdown": {
    "purchases": { "total": 1000.00, "thisMonth": 150.00, "count": 50 },
    "subscriptions": { "total": 400.50, "thisMonth": 80.00, "count": 40 },
    "tips": { "total": 100.00, "thisMonth": 20.00, "count": 20 }
  },
  "transactions": [
    {
      "id": "clx...",
      "type": "purchase",
      "amount": 13.993,
      "totalAmount": 19.99,
      "currency": "USDT",
      "buyerNickname": "Fan123",
      "buyerAddress": "0x...",
      "contentTitle": "External Content",
      "transactionHash": "0x...",
      "explorerUrl": "https://polygonscan.com/tx/0x...",
      "chainId": 137,
      "createdAt": "2026-03-07T...",
      "hasDistributor": true
    }
  ]
}
```

#### GET /api/v1/external/distributor/earnings

**认证：** Bearer + API Key。获取分销商收益摘要和交易历史。

**查询参数：** `distributorUserId`（必填），`limit`，`offset`

**响应：** 与创作者收益格式相同。

---

---

## 8. 链上结算

支付扣除用户虚拟余额后，系统创建一个状态为 `PENDING` 的 `AccountAction`。ActionExecutor 后台 Worker 负责处理：

```
支付 API                        数据库                           链上（VimoVault）
  │                               │                               │
  │  创建 AccountAction           │                               │
  │  （状态：PENDING）             │                               │
  │──────────────────────────────>│                               │
  │                               │                               │
  │                    ActionExecutor Worker                       │
  │                               │                               │
  │                    ┌──────────┴──────────┐                    │
  │                    │  阶段 1：准备        │                    │
  │                    │  （无锁）            │                    │
  │                    │  读取 DB，构建合约   │                    │
  │                    │  调用参数            │                    │
  │                    └──────────┬──────────┘                    │
  │                               │                               │
  │                    ┌──────────┴──────────┐                    │
  │                    │  阶段 2：提交        │                    │
  │                    │  （按链加锁）        │                    │
  │                    │  发送交易到链上      │────────────────────>
  │                    └──────────┬──────────┘                    │
  │                               │                               │
  │                    ┌──────────┴──────────┐                    │
  │                    │  阶段 3：确认        │                    │
  │                    │  （无锁）            │                    │
  │                    │  等待回执            │<────────────────────
  │                    │  更新 DB 状态        │                    │
  │                    │  → COMPLETED        │                    │
  │                    └─────────────────────┘                    │
```

### 结算状态

| 状态 | 含义 |
|------|------|
| `PENDING` | 已排队等待链上执行 |
| `EXECUTING` | 交易已提交到链上 |
| `COMPLETED` | 交易已在链上确认 |
| `FAILED` | 交易失败，将重试 |
| `PERMANENTLY_FAILED` | 重试次数耗尽（5 次），等待对账退款 |
| `REFUNDED` | 结算永久失败后，对账系统已自动退还用户余额并修正 totalSpent |

### 重试策略

- 指数退避：30秒 × 2^重试次数（单次重试最长 2 分钟）
- 3 次重试：触发 `SETTLEMENT_STALLED` 告警
- 5 次重试（约 7.5 分钟）：标记为 `PERMANENTLY_FAILED`
- 对账系统自动退款：检测到链上正向漂移后，恢复 `availableBalance`，修正 `totalSpent`，并将操作标记为 `REFUNDED`

### 轮询结算状态

购买、订阅、打赏均通过统一的购买接口，使用 `externalTransactionId` 查询结算状态：

```
GET /api/v1/external/purchase/{externalTransactionId}
Authorization: Bearer <token>
X-API-Key: videa_xxx

响应：
{
  "purchase": {
    "id": "clx...",
    "category": "CONTENT",          // "CONTENT" | "SUBSCRIPTION" | "TIP"
    "externalContentId": "prod-123",
    "externalTransactionId": "your-tx-123",
    ...
  },
  "action": {
    "status": "COMPLETED",           // PENDING | EXECUTING | COMPLETED | FAILED | PERMANENTLY_FAILED | REFUNDED
    "executionTxHash": "0xabc...",
    "explorerUrl": "https://polygonscan.com/tx/0xabc...",
    "executedAt": "2026-03-07T..."
  }
}
```

---

## 9. 收益分成

### 运作方式

1. 通过 `POST /api/v1/external/distribution-links` 创建**分销链接**。
2. 在购买、订阅或打赏请求中传入 `distributionLinkCode`。
3. 指定 `revenuePlan` 控制创建新的粉丝-分销商关系时的收益分成比例。
4. 收益根据锁定的方案自动分配。
5. 佣金关系从粉丝通过该分销商首次支付起持续 **2 年**。

### 分成公式

```
平台费用      = 金额 × (platformFeeBps / 10000)     // 默认：10% = 1000 bps
分销商收益    = 有分销商 ? 金额 × (distributorBps / 100) : 0
创作者收益    = 金额 - 平台费用 - 分销商收益
```

### 收益分成方案

所有方案平台费为 10%，剩余 90% 由创作者和分销商分配：

| 方案 | 创作者 | 分销商 | 平台 |
|------|--------|--------|------|
| BALANCED | 70% | 20% | 10% |
| CHANNEL_PRIORITY | 60% | 30% | 10% |
| STRONG_CHANNEL | 50% | 40% | 10% |
| CREATOR_PRIORITY | 80% | 10% | 10% |

无分销商时，创作者获得 90%，平台获得 10%。

### 分成示例（$100 购买，BALANCED 方案）

```
有分销商：                    无分销商：
  平台   (10%) → $10          平台   (10%) → $10
  分销商 (20%) → $20          创作者 (90%) → $90
  创作者 (70%) → $70
```

### 佣金锁定

- 通过分销商的首次支付锁定收益分成方案
- 锁定 **2 年**（`FanDistributorRelation.commissionExpiryDate`）
- 该窗口期内，该粉丝对该创作者的所有支付都包含分销商的分成
- 创作者可选择"使用创作者默认"以动态跟随当前方案

---

## 10. 速率限制

速率限制采用滑动窗口算法，按客户端 IP 应用。

| 层级 | 限制 | 适用于 |
|------|------|--------|
| 认证 | 10 次/分钟 | `/api/auth/*`（token 交换） |
| 写操作 | 30 次/分钟 | 所有 POST、PUT、PATCH、DELETE 请求 |
| 读操作 | 120 次/分钟 | 所有 GET 请求 |

### 响应头

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
```

### 被限流时 (429)

```json
{ "error": "Too many requests. Please try again later." }
```

`Retry-After` 头表示限制重置的秒数。

---

## 11. 错误处理

### 标准错误格式

```json
{ "error": "Error message" }
```

部分错误包含机器可读的 `code`：

```json
{ "error": "Insufficient balance", "code": "INSUFFICIENT_BALANCE" }
```

### HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 400 | 请求错误——无效输入、校验失败 |
| 401 | 未认证——缺少或无效的认证信息 |
| 403 | 禁止访问——已认证但无权限 |
| 404 | 未找到——资源不存在 |
| 409 | 冲突——资源重复或余额验证中 |
| 429 | 被限流——请求过多 |
| 500 | 服务器内部错误 |

### 支付错误码

| 错误码 | 含义 | 处理方式 |
|--------|------|----------|
| `INSUFFICIENT_BALANCE` | 账户余额不足 | 用户需要充值更多资金 |
| `RECONCILIATION_HOLD` | 余额验证进行中，支付暂停 | 系统正在验证链上余额，请稍后重试。响应包含 `reconciliationLogId` 供排查 |

---

## 接口汇总表

| 方法 | 接口 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/v1/external/revenue-plans` | API Key | 列出收益分成方案 |
| POST | `/api/v1/external/payment-intents` | API Key | 创建支付意图 |
| GET | `/api/v1/external/payment-intents/{id}` | Bearer+Key | 查询支付意图 |
| GET | `/api/v1/external/purchase/{id}` | Bearer+Key | 购买/订阅/打赏详情 + 结算状态（`{id}` 为 `externalTransactionId`） |
| GET | `/api/v1/external/user/{userId}/profile` | Bearer+Key | 获取用户资料 |
| PUT | `/api/v1/external/user/{userId}/nickname` | Bearer+Key | 更新用户昵称 |
| GET | `/api/v1/external/balance` | Bearer+Key | 获取用户余额 |
| POST | `/api/v1/external/distribution-links` | Bearer+Key | 创建分销链接 |
| DELETE | `/api/v1/external/distribution-links` | Bearer+Key | 停用分销链接 |
| GET | `/api/v1/external/distribution-links` | Bearer+Key | 列出分销链接 |
| GET | `/api/v1/external/creator/earnings` | Bearer+Key | 创作者收益 |
| GET | `/api/v1/external/distributor/earnings` | Bearer+Key | 分销商收益 |

