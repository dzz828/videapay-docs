# MetaMask: 添加 Polygon Amoy 测试网 & 代币地址

本指南介绍如何在 MetaMask 钱包中添加 Polygon Amoy 测试网，并导入 USDT/USDC 测试代币合约。

---

## 1. 添加 Polygon Amoy 测试网

1. 打开 MetaMask，点击左上角的网络选择器。
2. 点击 **"添加自定义网络"**（或进入 设置 > 网络 > 添加网络）。
3. 填入以下信息：

| 字段 | 值 |
|------|-----|
| 网络名称 | `Polygon Amoy Testnet` |
| RPC URL | `https://rpc-amoy.polygon.technology` |
| 链 ID | `80002` |
| 货币符号 | `POL` |
| 区块浏览器 URL | `https://amoy.polygonscan.com` |

4. 点击 **保存**。

保存后，你应该能在网络下拉菜单中看到 "Polygon Amoy Testnet"。

## 2. 获取测试 POL（Gas 代币）

在 Amoy 网络上进行交易需要 POL 作为 Gas 费。可以从以下水龙头免费领取：

- [Polygon Faucet](https://faucet.polygon.technology/) — 选择 "Amoy" 网络
- [Alchemy Faucet](https://www.alchemy.com/faucets/polygon-amoy) — 需要 Alchemy 账号

粘贴你的 MetaMask 钱包地址，点击领取即可。

## 3. 导入 USDT 代币

1. 确保当前网络已切换到 **Polygon Amoy Testnet**。
2. 在 MetaMask 的"资产"标签页底部，点击 **"导入代币"**。
3. 选择 **"自定义代币"**，填入以下信息：

| 字段 | 值 |
|------|-----|
| 代币合约地址 | `0x60D71077ab94fafb19679Fee65375d9278496278` |
| 代币符号 | `USDT` |
| 代币精度 | `6` |

4. 点击 **下一步**，然后点击 **导入**。

## 4. 导入 USDC 代币

1. 保持在 **Polygon Amoy Testnet** 网络。
2. 点击 **"导入代币"** > **"自定义代币"**，填入以下信息：

| 字段 | 值 |
|------|-----|
| 代币合约地址 | `0x5F98a845B4C60C4d157554cf53BB4e894a17e190` |
| 代币符号 | `USDC` |
| 代币精度 | `6` |

3. 点击 **下一步**，然后点击 **导入**。

## 5. 获取测试 USDT/USDC

请联系项目团队获取测试代币。

## 快速参考

| 项目 | 值 |
|------|-----|
| 链 ID | `80002` |
| RPC URL | `https://rpc-amoy.polygon.technology` |
| 区块浏览器 | `https://amoy.polygonscan.com` |
| 货币符号 | `POL` |
| USDT 地址 | `0x60D71077ab94fafb19679Fee65375d9278496278` |
| USDC 地址 | `0x5F98a845B4C60C4d157554cf53BB4e894a17e190` |
| 代币精度 | `6` |
