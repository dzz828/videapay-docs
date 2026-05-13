# 中继器密钥引导 — AWS 控制台操作指引

本指引面向 **AWS 账户的根用户(Root Account Owner)**(或持有生产 AWS 账户管理员凭据的人)。它会一步步地为区块链 **中继器私钥(relayer private key)** 建立一个加固的存储位置,使得:

- ECS Fargate 工作进程在启动时可以读取该密钥,以对链上交易进行签名。
- 根账户拥有者可以轮换或销毁该密钥。
- **其他任何人** —— 包括能够运行 `cdk deploy` 的工程师 —— 都无法读取、轮换或复制它。

本流程**每个环境只需执行一次**(通常仅生产环境 `production` 需要)。完成后,工程师只需把它的 ARN 写入 `cdk.json` 并照常部署。

你**可以在工程师从未部署过该堆栈之前就执行此引导** —— 你即将编写的策略通过名称(而不是直接的 ARN 绑定)来引用工作进程角色,因此即便该角色尚不存在,AWS 也会接受这些策略。(这正是下文 `aws:PrincipalArn` `Condition` 模式带来的效果。)这意味着引导是完全自助的:工程师不需要先做一次"第 0 阶段"部署。

无需命令行,无需 CDK,无需 Terraform。下面所有步骤都在 AWS 管理控制台中点击完成。预计耗时 **约 30 分钟**。

---

## 目录

- [开始之前](#开始之前)
- [你将搭建什么](#你将搭建什么)
- [步骤 1 — 以根用户身份登录](#步骤-1--以根用户身份登录)
- [步骤 2 — 创建客户管理的 KMS 密钥(锁)](#步骤-2--创建客户管理的-kms-密钥锁)
- [步骤 3 — 创建 Secret](#步骤-3--创建-secret)
- [步骤 4 — 用资源策略锁定 Secret](#步骤-4--用资源策略锁定-secret)
- [步骤 5 — 把 ARN 交给工程师](#步骤-5--把-arn-交给工程师)
- [步骤 6 — 验证锁是否生效](#步骤-6--验证锁是否生效)
- [日后轮换密钥](#日后轮换密钥)
- [紧急情况:撤销密钥](#紧急情况撤销密钥)
- [术语表](#术语表)
- [常见问题](#常见问题)

---

## 开始之前

你需要准备:

- **根账户凭据** —— 当初开通 AWS 账户用的那个邮箱 + 密码,以及 MFA 设备(硬件密钥或 Authenticator 应用)。
- **中继器私钥本身** —— 一个以 `0x` 开头、长度为 64 字符的十六进制字符串(连同 `0x` 共 66 字符)。从生成中继器钱包的工程师处获取。把它当作密码对待:**不要**把它粘贴到聊天工具、邮件,或者除了 AWS 控制台标签页以外的任何浏览器页面中。最好让它躺在你能直接复制的密码管理器里。
- **12 位的 AWS 账户 ID**。登录 AWS 控制台后,点击右上角的账户名,在 "Account ID" 下方就能看到这串 12 位数字(无短横线)。复制下来 —— 后面会粘贴到多个策略中。
- **工作进程所在的 AWS 区域**。VideaPay 生产环境是 `eu-north-1`(斯德哥尔摩)。请向工程师确认。下文每一步都假设你在该区域中操作 —— 如果在中途切换了区域,你创建的资源对工作进程将不可见。
- **30 分钟不被打扰的时间**,在一台你信任的电脑前。

你**不需要**事先从工程师那里拿到任何信息。工作进程角色的 ARN 完全可由环境名预测出来:

> **工作进程角色 ARN 格式**:
> `arn:aws:iam::<账户ID>:role/videapay-production-workers-secret-reader`
>
> (开发环境的角色名是去掉 `production` 段的 `videapay-workers-secret-reader`,但开发环境通常并不走这套加固引导流程。)

该角色不必现在就存在 —— 你即将编写的策略通过 *字符串匹配*(`aws:PrincipalArn` `Condition`)来锁定它,而不是通过 IAM 解析器,所以无论该角色当前是否存在,AWS 都会接受这些策略。

如果你缺少上述任何一项,**请先停下来询问**。不要"灵机一动"自行替代。

---

## 你将搭建什么

```
                +--------------------------------+
                |  KMS 客户管理密钥(CMK)       |
                |  别名: alias/videapay-relayer  |   ← 仅 root + ECS 可使用
                +----------------+---------------+
                                 | (用于加密)
                                 v
                +--------------------------------+
                |  Secrets Manager 密钥          |
                |  videapay/production/workers/  |   ← 仅 root + ECS 可读
                |     sc-relayer-private-key     |
                +--------------------------------+
                                 |
                                 v
              ECS Fargate 工作进程在启动时读取
                                 |
                                 v
              用于为 VideaPay 在链上签署交易
```

两个 AWS 资源,均归 root 所有,且各自的策略都把 ECS 工作进程角色列为唯一可被允许的另一个读者。工程师可以把该 secret 的 ARN 接入部署,但无法触碰它的值。

---

## 步骤 1 — 以根用户身份登录

1. 在一个全新的浏览器窗口中打开 <https://console.aws.amazon.com/>
   (建议使用隐私/无痕模式 —— 避免不小心以另一个用户身份登录)。
2. 点击右上角 **Sign in** → **Root user**。
3. 输入 **根账户邮箱**。
4. 输入 **根账户密码**。
5. 完成 **MFA** 验证。
6. 在右上角的区域选择器中选对区域。VideaPay 生产环境是
   **Europe (Stockholm) eu-north-1**。下文每一步都假设你在该区域。

> 如果登录失败、或区域选择器是灰色的,请先停止操作并联系工程师。
> 不要"为了能干活"而创建一个 IAM 用户 —— 这条流程的全部意义就在于
> 把它隔离在工程师的凭据路径之外。

---

## 步骤 2 — 创建客户管理的 KMS 密钥(锁)

这是整个流程中最重要的一步。KMS 密钥是真正的密码学锁;即便日后 secret
的权限被削弱了,只要没有这把 KMS 密钥的使用权,里面的数据依然无法解密。

1. 在 AWS 控制台顶部搜索栏中输入 **KMS**,点击 **Key Management Service**。
2. 左侧栏 → **Customer managed keys**。
3. 点击右上角 **Create key**。
4. **Step 1 — Configure key**:
   - Key type:**Symmetric**
   - Key usage:**Encrypt and decrypt**
   - 点击 **Next**。
5. **Step 2 — Add labels**:
   - Alias:`videapay-relayer-key`
   - Description:`Encrypts the VideaPay relayer private key. Owned by root. ECS workers may decrypt via Secrets Manager.`
   - Tags(点 **Add tag**):
     - Key:`Purpose`,Value:`relayer-key-encryption`
     - Key:`Owner`,Value:`root`
   - 点击 **Next**。
6. **Step 3 — Define key administrative permissions**:
   - **保持所有项不勾选。** 是的,真的不要勾。不要在这里挑任何 IAM 用户
     或角色。根账户始终是隐式管理员;在这里再列出任何人,都意味着对方
     可以删除这把密钥或修改谁可以使用它。这两件事我们都不想要。
   - 点击 **Next**。
7. **Step 4 — Define key usage permissions**:
   - **同样保持所有项不勾选。** 这一步本意是让你挑选已存在的 IAM 主体作
     为密钥使用者,但工作进程角色现在可能还不存在;就算存在,把 ARN 当作
     `Principal` 硬编码进去也会把策略和具体那一版角色绑死。我们将在下
     一步用更好的、基于 `Condition` 的写法。
   - 点击 **Next**。
8. **Step 5 — Review**:
   - 滚动到 **Key policy** 部分。点击该 JSON 旁的 **Edit**。
   - **整体替换**为下方 JSON。把 `<account-id>` 换成你的 12 位 AWS 账户
     ID,并确认 `<region>` 与工作进程所在区域一致(VideaPay 生产为
     `eu-north-1`)。两个占位符必须都被替换 —— 不要带着字面上的
     `<...>` 提交。

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "EnableRootFullControl",
         "Effect": "Allow",
         "Principal": { "AWS": "arn:aws:iam::<account-id>:root" },
         "Action": "kms:*",
         "Resource": "*"
       },
       {
         "Sid": "AllowAccessViaSecretsManager",
         "Effect": "Allow",
         "Principal": { "AWS": "*" },
         "Action": [
           "kms:Encrypt",
           "kms:Decrypt",
           "kms:ReEncrypt*",
           "kms:GenerateDataKey*",
           "kms:CreateGrant",
           "kms:DescribeKey"
         ],
         "Resource": "*",
         "Condition": {
           "StringEquals": {
             "kms:CallerAccount": "<account-id>",
             "kms:ViaService": "secretsmanager.<region>.amazonaws.com"
           }
         }
       }
     ]
   }
   ```

   - 点击 **Finish**。

9. 把 **Key ARN** 复制到一个安全的地方(比如密码管理器的笔记里)。它形如
   `arn:aws:kms:eu-north-1:<account>:key/abcd1234-...`。本指引中你不会再
   把它粘到别处(secret 是通过别名引用密钥的),但日后若要轮换密钥则会
   用到。

> **为什么 "Allow access via Secrets Manager" 用的是 `Principal: { "AWS": "*" }`?**
> 真正起到限制作用的是两个 `Condition` 键:
> `kms:CallerAccount` 把范围限制在你这个账户内,`kms:ViaService` 把范围
> 限制在通过该区域的 Secrets Manager 服务路由过来的请求。*直接* 调
> 用 KMS(绕过 Secrets Manager)仍然受上面 `EnableRootFullControl` 块的
> 约束 —— 只有 root 能这么干。**Secret 自己** 的资源策略(步骤 4)才是
> 真正决定"谁可以一开始去调用 Secrets Manager"的守门员。两层防御。

> **为什么不指定 Key administrators?** Key administrators 可以删除这把
> 密钥(7–30 天等待期之后)或修改它的策略。Root 通过隐式的 `kms:*` 已经
> 都能做到。在这里额外加管理员是客户管理密钥被意外破坏最常见的方式之一。

---

## 步骤 3 — 创建 Secret

1. AWS 控制台搜索栏 → **Secrets Manager** → 点击进入。
2. 点击 **Store a new secret**。
3. **Step 1 — Choose secret type**:
   - Secret type:**Other type of secret**。
   - 切换到 **Plaintext** 标签(不要用 "Key/value pairs")。把中继器私钥
     (完整的 66 字符 `0x…` 字符串)粘贴到文本框中。**不要** 用 JSON
     包裹它(比如 `{"key": "0x..."}`)—— 工作进程要的是原始字符串。
   - **Encryption key**:点击下拉框,选择 `videapay-relayer-key`(你在
     步骤 2 创建的别名)。**不要** 留在 `aws/secretsmanager` —— 那是
     默认密钥,会让 Secrets Manager 把过多的 AWS 服务也带进访问范围。
     选你自己的 CMK 才让这把锁真正生效。
   - 点击 **Next**。
4. **Step 2 — Configure secret**:
   - Secret name:`videapay/production/workers/sc-relayer-private-key`
     (一字不差地用这个名字,包括斜线 —— 工程代码就认这个名字)。
   - Description:`VideaPay relayer private key. Owned by root. Read by ECS workers only.`
   - Tags:
     - Key:`Purpose`,Value:`relayer-key`
     - Key:`Environment`,Value:`production`
   - Resource permissions:**先留空** —— 我们在步骤 4 才填。
   - 点击 **Next**。
5. **Step 3 — Configure rotation**:保持 **Disabled**。我们只做手动轮换;
   自动轮换需要一个 Lambda,而我们不希望它出现在这条链路里。点击
   **Next**。
6. **Step 4 — Review**:逐项确认,特别看一下 encryption key 显示为
   `videapay-relayer-key`,然后点击 **Store**。
7. 在出现的 secret 详情页顶部,**复制 Secret ARN**。它形如
   `arn:aws:secretsmanager:eu-north-1:<account>:secret:videapay/production/workers/sc-relayer-private-key-AbCdEf`。
   把它保存到 KMS ARN 旁边 —— 步骤 5 工程师会用到。

---

## 步骤 4 — 用资源策略锁定 Secret

默认情况下,账户里任何持有 `secretsmanager:GetSecretValue` IAM 权限的人
都能读这个 secret。部署角色就有这个权限。我们要加一条资源级策略,只允许
工作进程角色 + root 访问,并显式拒绝其他所有人。

1. 仍停留在步骤 3 的 secret 详情页,滚到 **Resource permissions**(大约
   半页位置)。点击 **Edit permissions**。
2. 粘贴下面这段 JSON,把 `<account-id>` 替换成你的 12 位 AWS 账户 ID。
   **请注意没有别的占位符** —— 工作进程角色的 ARN 已经按照可预测的名字
   硬编码好了。即便那个角色现在还不存在,也直接提交就好;基于
   `Condition` 的主体写法只是一次字符串匹配,AWS 会接受。

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowWorkerRoleAndRoot",
         "Effect": "Allow",
         "Principal": "*",
         "Action": [
           "secretsmanager:GetSecretValue",
           "secretsmanager:DescribeSecret"
         ],
         "Resource": "*",
         "Condition": {
           "StringEquals": {
             "aws:PrincipalArn": [
               "arn:aws:iam::<account-id>:role/videapay-production-workers-secret-reader",
               "arn:aws:iam::<account-id>:root"
             ]
           }
         }
       },
       {
         "Sid": "DenyEveryoneElse",
         "Effect": "Deny",
         "Principal": "*",
         "Action": [
           "secretsmanager:GetSecretValue",
           "secretsmanager:PutSecretValue",
           "secretsmanager:UpdateSecret",
           "secretsmanager:DeleteSecret",
           "secretsmanager:PutResourcePolicy",
           "secretsmanager:DeleteResourcePolicy"
         ],
         "Resource": "*",
         "Condition": {
           "StringNotEquals": {
             "aws:PrincipalArn": [
               "arn:aws:iam::<account-id>:role/videapay-production-workers-secret-reader",
               "arn:aws:iam::<account-id>:root"
             ]
           }
         }
       }
     ]
   }
   ```

3. 点击 **Save**。
4. AWS 会显示绿色确认横幅。如果出现红色错误,例如 "the policy denies all
   access",说明你只复制了 deny 块、没复制 allow 块 —— 重新粘贴上面的
   完整 JSON。

> **为什么是 `Principal: "*"` + Condition,而不是 `Principal: { "AWS": "<role-arn>" }`?**
> 直接在 `Principal` 字段里写 ARN 要求保存策略时该角色 *已经存在*,否
> 则 AWS 会以 "Invalid principal in policy" 拒绝。`Condition` 形式只是
> 在请求发生时对 `aws:PrincipalArn` 做字符串比较,因此即便该角色还没
> 创建也能保存。这就是为什么引导顺序可以独立:你今天创建 secret,工程师
> 明天部署角色,明天的工作进程请求依然能匹配通过。

> **为什么还要 Deny 块?**
> 账户中其它地方的 IAM 身份策略可以给部署角色赋 `secretsmanager:*`。
> 身份策略中的 `Allow` + 资源策略中的 `Allow` = 授权。该资源策略中的
> `Deny` 才是真正能压制掉那条路径的 —— IAM 评估中 `Deny` 总是优先。
> 没有它的话,有 `cdk deploy` 权限的工程师依然可以用自己的身份在 AWS
> 控制台把 secret 读出来。

---

## 步骤 5 — 把 ARN 交给工程师

把 **步骤 3 中得到的 Secret ARN**(不是 KMS ARN —— 工程师不需要 KMS
ARN;工作进程取 secret 时它会自动解析)发送给负责部署的工程师。

请通过公司的密码管理器或安全通道发送 —— 不要走聊天工具或邮件。这个 ARN
本身不是凭据,但它指向一个高价值资产,不应公开传播。

工程师将会:

1. 把该 ARN 粘贴到 `infra/cdk.json` 的
   `context.environments.production.relayerKeyArn` 下。
2. 运行 `cdk deploy` —— 接下来这次部署会引用你这个 secret(而不是在
   CloudFormation 里再创建一个),并且会创建你在步骤 2、4 里所瞄准的
   `videapay-production-workers-secret-reader` IAM 角色。

他们部署完成后,工作进程就会开始读取你存进去的那个值。

---

## 步骤 6 — 验证锁是否生效

工程部署上线后,**做一次** 这个验证,以确认锁确实生效。(本质上是在
证明:有部署角色权限的人确实读不到这个 secret。)

1. 保持 root 身份登录。
2. 打开 AWS CloudTrail → **Event history**(左侧栏)。
3. 在 **Lookup attributes** 中选 **Event name**,值设为
   `GetSecretValue`,时间范围设为最近一小时。
4. 你应该看到 `User name` 或角色会话中包含
   `videapay-production-workers-secret-reader` 的条目 —— 那是工作进程在
   启动时读取 secret。这是好事。
5. 你**不应该**看到用户/角色名中带有 `cdk` 或 `CloudFormation` 的条目。
   如果看到了,说明 deny 块没有生效 —— 立即联系工程师。

可选的双重验证(只有当你能让一位非 root 工程师在线配合时才做):

1. 让该工程师在他们正常的 AWS 凭据下运行:
   ```
   aws secretsmanager get-secret-value \
     --secret-id videapay/production/workers/sc-relayer-private-key \
     --region eu-north-1
   ```
2. 他们应该收到 `AccessDeniedException`。如果他们能拿到 secret 值,说明
   deny 块没有生效 —— 回到步骤 4 重新保存资源策略。**然后必须轮换密
   钥**(见下面的"日后轮换密钥"),因为它曾短暂可读。

---

## 日后轮换密钥

下列任一情况发生时执行轮换:怀疑密钥被泄露;或按例行计划(每季度一次
比较合理)。

1. 生成一个新的中继器密钥。工程师会负责生成,并通过密码管理器把新值告诉
   你。
2. **给新钱包充值** —— 把工作进程结算所用每条链上的原生 gas 代币转入
   (工程师会给你一份清单)。新密钥在轮换后会立即被用来签署交易;如果
   它没有 gas,所有结算都会失败,直到充值为止。
3. 以 **root** 身份登录 AWS 控制台。
4. 进入 Secrets Manager → 找到名为
   `videapay/production/workers/sc-relayer-private-key` 的 secret。
5. 点击 **Retrieve secret value** → **Edit**。
6. 把值替换为新密钥(保持同样的明文格式,不要 JSON 包裹)。点击 **Save**。
7. 通知工程师。他们会执行一次 ECS "force new deployment",让正在运行的
   任务取到新值(已运行任务里缓存的还是 *旧* 值,在进程启动时就读完了)。
8. 重新部署稳定之后,如果 **旧** 钱包上还有可观的余额,把残留的 gas
   代币从旧钱包转走;并将旧密钥视为永久失陷 —— 永不再用。

---

## 紧急情况:撤销密钥

如果你掌握具体证据表明密钥已经失陷(资金在未授权情况下被转出、密钥值
出现在某次泄露中、知道密钥的某位员工变成了敌对方):

1. 立即以 **root** 身份登录。
2. KMS 控制台 → Customer managed keys → `videapay-relayer-key` →
   **Key actions** → **Disable**。
3. 这会让 secret 立即变得不可读。工作进程会在数秒内开始无法完成交易 ——
   这正是预期行为。**正在挂起的链上结算会堆积起来;它们不会自动用新密
   钥重放。**
4. 联系工程师走事件响应流程。他们将:轮换密钥(见上文步骤)、重新启用
   KMS 密钥、强制工作进程重新部署、并人工修复任何超时卡住的结算。

> **不要删除 KMS 密钥。** 删除有强制 7–30 天的等待期,并且在该等待期
> 内密钥不可恢复。Disable 是可撤销的;Delete 不是。

---

## 术语表

| 术语 | 含义 |
|------|------|
| **Root account** | 最初开通 AWS 账户的拥有者 —— 登录方式是邮箱 + 密码 + MFA,而不是 IAM 用户。对所有资源拥有不可剥夺的全权。 |
| **IAM role** | 一组权限,可以被某个 AWS 服务(比如 ECS)或某个人临时承担。"ECS task execution role" 就是工作进程容器运行时用来取 secret、拉 Docker 镜像的那个角色。 |
| **CMK / customer-managed key** | 你自己在 KMS 中创建并掌控的加密密钥,与 `aws/secretsmanager` 这种 AWS 托管的默认密钥相对。 |
| **Resource policy** | 附着在某个资源(这里是 secret)上的权限文档,规定谁能对它做什么。它会与 IAM 身份策略合并;任意一边出现 `Deny` 都会胜出。 |
| **`aws:PrincipalArn` Condition** | 一个全局 IAM 条件键,允许策略在请求发生时根据请求者的 ARN 进行匹配 —— 而不要求该 ARN 在策略保存时就存在。"先引导,后部署"的故事就靠它。 |
| **CloudFormation deploy role** | CDK / CloudFormation 用来创建和修改 AWS 资源的 IAM 角色。工程师可以触发它去执行操作,但无法直接承担它。它默认拥有相当宽泛的权限。 |
| **ECS Fargate** | 运行工作进程容器的服务。工作进程在启动时从 Secrets Manager 取一次中继器密钥。 |

---

## 常见问题

**问:我把中继器私钥的值弄丢了。可以从 AWS 控制台找回来吗?**
可以 —— 用 root 登录,进入 Secrets Manager,点击 secret 名称,再点
**Retrieve secret value** → **Plaintext**。看到的值就当作刚刚被新泄露的
凭据来对待 —— 除非是为了轮换,否则不要把它粘贴到任何别处。

**问:工程师为了排查问题需要读这个 secret。**
其实不应该。正确做法是:他们告诉你需要什么,你要么自己复现这个问题,
要么以 root 身份登录、在他们在场的情况下替他们运行那条读取命令、并仅在
本次排查期间使用。整套架构的前提就是工程师永远看不到这个值。

**问:能不能让某位特定的工程师(不是部署角色,是个具体的人)在紧急情
况下能读到密钥?**
可以 —— 把他们的 IAM 用户/角色 ARN 加到步骤 4 中两个 `aws:PrincipalArn`
数组里(Allow 块和 Deny 块都要加)。慎用。更好的做法是:需要的时候你
自己以 root 身份登录。

**问:工程师反馈 `cdk deploy` 报 "secret not found"。**
检查工程师粘到 `cdk.json` 的 ARN 是否与你创建的 secret 的 ARN 完全一致。
区域不匹配是最常见的原因(比如你在 `us-east-1` 创建了 secret,但工作
进程在 `eu-north-1` 跑)。Secret 必须和工作进程在同一区域。

**问:我不小心在错误的区域创建了 secret,怎么办?**
以 root 身份登录。在错误那个区域里把 secret 删掉(Secrets Manager →
secret 名称 → Actions → Delete secret → 选择最少的 7 天计划删除)。
然后到正确区域重做步骤 2–4。告知工程师重新更新 `cdk.json` 中的 ARN。
错误区域的那个 secret 会在 7 天后自动彻底消失。

**问:工作进程角色名在策略里是硬编码的。如果工程师把它改名了怎么办?**
角色名在 CDK 代码里被钉死(`workers-stack.ts`,
`videapay-{env}-workers-secret-reader`),正是为了不会漂移。如果工程师
确实需要改这个名字,他们必须在改名之前与你协调,先更新 KMS 密钥策略
(步骤 2)和 secret 资源策略(步骤 4),否则工作进程将无法读取该 secret。
`infra/test/stacks.test.ts` 里有相应的测试("workers shared execution
role (deterministic name)"),如果名字被无意改动测试会大声失败。

**问:为什么不直接把密钥放到 AWS Parameter Store / GitHub Secrets / `.env` 文件里?**
Parameter Store 不支持等同强度的客户管理密钥加密隔离,也对资源策略支持
较弱。GitHub Secrets 任何能修改 workflow 文件的人都能读。`.env` 文件
任何能访问代码仓库的人都能读。Secrets Manager + CMK + 资源策略是 AWS
原生方案中唯一能达到"只允许 ECS 和 root 访问"标准的。

---

## 相关文档

- [../infra/README.md#relayer-key-ownership](../infra/README.md#relayer-key-ownership)
  —— 工程师视角下对同一套部署的描述,包括 `relayerKeyArn` CDK context
  的接线方式以及让本引导得以成立的可预测角色命名。
