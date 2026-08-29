# WP Publisher Companion 升级设计
## 可替换 Transport、认证解耦与 WP Title Layer 副标题适配

> 2026-08-29 实施决定：当前工作树只完成 Companion 0.5.0 的副标题 provider
> 边界、WP Title Layer canonical 字段接管和 REST 认证失败诊断。Companion 不绕过
> Wordfence，也不静默回退 XML-RPC。完整 Transport/AuthProvider 抽象、SSH/WP-CLI
> 和其他认证方案继续作为独立架构任务，不纳入本轮发布候选。

**文档目的**

供 WP Publisher / WP Publisher Companion 后续版本修改时使用。
本次不是为了迁移 AWS Lightsail 临时打补丁，而是借现有兼容问题，把 Publisher 的“内容映射”和“传输/认证”从结构上拆开，避免以后继续互相牵制。

---

## 一、背景

目前 WP Publisher 的推荐发布路径大致是：

```text
本地 WP Publisher
    ↓
WordPress REST API
    ↓
Application Password / Basic Auth
    ↓
WP Publisher Companion
    ↓
WordPress 内容、媒体、metadata
```

Lightsail 测试中暴露了两个彼此独立的问题：

### 1. REST 认证与 Wordfence 策略冲突

WordPress REST API 本身工作正常，但当前 Wordfence 设置关闭了 WordPress Application Password。
因此 WP Publisher 使用 Application Password 的认证 REST 请求会得到：

```text
401 rest_not_logged_in
```

这不是 Lightsail 或 REST API 的性能问题，而是认证策略冲突。

### 2. 副标题写入仍停留在旧字段

当前 WP Publisher Companion 虽然能够识别 WP Title Layer 的兼容环境，但实际仍读写：

```text
_secondary_title
```

而 WP Title Layer 当前 canonical 字段为：

```text
wptl_subtitle
```

因此 Publisher 侧即使 REST 返回成功，也可能只修改旧字段，而没有修改真正用于显示的 canonical subtitle。

---

# 二、核心判断

这两个问题不应该被当成一个问题修。

真正需要拆开的，是两个维度：

```text
WP Publisher Core
      │
      ├── Content Mapping
      │      ├── title
      │      ├── subtitle
      │      ├── categories / tags
      │      ├── Rank Math metadata
      │      ├── featured image
      │      └── media
      │
      └── Transport / Authentication
             ├── REST
             ├── REST Auth
             └── future transports
```

**“写什么、写到哪里”** 与 **“怎样把数据送过去”** 不应继续耦合。

这次修改建议以此为基本方向。

---

# 三、设计目标

## 目标 1：REST 保留为默认 Transport

不建议因为 Wordfence 关闭 Application Password 就放弃 REST。

REST 仍然是：

- WordPress 官方现代接口；
- 适合跨机器发布；
- 易调试；
- 易扩展；
- 比 XML-RPC 更适合作为长期主路径。

因此本次修改不要把目标设成“去掉 REST”，而应设成：

> **让 Transport 可以替换，让 REST 不再成为业务逻辑的一部分。**

## 目标 2：Transport 抽象化

建议在 WP Publisher 客户端侧定义明确的 Transport interface。

概念上例如：

```text
PublisherTransport
├── authenticate()
├── test_connection()
├── create_post()
├── update_post()
├── upload_media()
├── fetch_post()
├── fetch_media()
└── delete_or_cleanup_temp_resource()
```

首个实现：

```text
RestTransport
```

未来可以增加：

```text
SshWpCliTransport
CustomApiTransport
```

但本次不要求立即实现所有 Transport。

关键是 **Core 不再直接依赖 REST request 细节**。

---

# 四、认证也应从 REST Transport 中再拆一层

REST 本身不等于 Application Password。

建议概念上形成：

```text
RestTransport
    ↓
AuthProvider
    ├── ApplicationPasswordAuth
    └── future auth provider
```

当前可以继续使用：

```text
Application Password + HTTPS
```

但不要把 Application Password 写死为整个 Publisher 的唯一认证模型。

---

# 五、当前推荐认证方案

## 方案 A：继续 REST + Application Password

这是当前最务实的主方案。

建议为 WP Publisher 创建独立 WordPress 用户，而不是使用 Administrator。

例如：

```text
user: wp-publisher
role: custom publisher role
```

权限只授予 Publisher 实际需要的 capability，例如：

- create/edit/publish posts
- upload_files
- edit relevant taxonomy
- 写入 WP Title Layer / Rank Math 所需 metadata
- 其他确实需要的最小权限

原则：

> **即使 Application Password 泄露，也不应自动等同于 Administrator 权限泄露。**

同时应明确记录：

- Application Password 可单独撤销；
- 不使用主账户密码；
- HTTPS 必须开启；
- 不在日志中打印完整 Authorization header；
- 不在测试报告中保存 credential。

---

# 六、Wordfence 冲突的处理

当前 Wordfence 设置：

```text
Disable WordPress application passwords = ON
```

这会阻断 WP Publisher 当前推荐认证方式。

这里不建议由 Companion 暗中绕过 Wordfence。

应该由系统明确选择：

### Choice A
允许 WordPress Application Password，并使用低权限 `wp-publisher` 用户。

### Choice B
继续禁用 Application Password，改用另一种明确实现并经过验收的 AuthProvider / Transport。

**不要把 401 当成 Publisher bug，也不要静默 fallback 到 XML-RPC。**

如果以后支持 fallback，必须是用户明确配置的 transport，而不是失败后自动换协议。

---

# 七、副标题适配：必须从 legacy field 转向 WP Title Layer

这是本次升级应实际完成的功能。

当前：

```text
WP Publisher
    ↓
_secondary_title
```

目标：

```text
WP Publisher
    ↓
Subtitle Adapter
    ↓
WP Title Layer canonical subtitle
```

当前 canonical 字段：

```text
wptl_subtitle
```

建议不要在 Publisher Core 中散布：

```text
wptl_subtitle
_secondary_title
```

而是建立统一的 subtitle adapter。

概念：

```text
SubtitleProvider
├── WpTitleLayerProvider
└── LegacySecondaryTitleProvider
```

逻辑建议：

```text
如果 WP Title Layer active
    → 使用 WP Title Layer canonical 存储/API
否则如果兼容旧站模式
    → 使用 _secondary_title
否则
    → subtitle unsupported
```

注意：

**不要同时双写两个字段作为长期方案。**

双写只会继续制造 shadow state：

```text
wptl_subtitle = A
_secondary_title = B
```

最终再次出现“REST 成功但页面显示不是那个值”的问题。

如确有迁移期兼容需求，应明确：

- canonical source 是谁；
- shadow field 是否只读；
- 是否需要一次性迁移；
- 何时停止兼容。

---

# 八、Content Mapping 层

建议把 Publisher 内部内容模型先统一，再交给 WordPress adapter。

例如：

```text
PublisherPost
├── title
├── subtitle
├── content
├── status
├── slug
├── excerpt
├── categories
├── tags
├── featured_image
├── seo
│   ├── title
│   ├── description
│   └── focus_keywords
└── series / custom taxonomy
```

然后：

```text
PublisherPost
    ↓
WordPressContentAdapter
    ↓
WordPress REST payload / metadata
```

这样以后：

- WP Title Layer 改字段；
- Rank Math 改 metadata；
- Series taxonomy 改结构；

只需要修改 WordPress adapter，而不需要同时修改 Transport。

---

# 九、Media 也应属于 Content/WordPress Adapter，而不是 Transport

目前正式站使用 Media Cloud Sync → Cloudflare R2。

因此媒体流程应理解为：

```text
本地图片
   ↓
Transport 上传
   ↓
WordPress 创建 attachment
   ↓
WordPress hooks / Media Cloud Sync
   ↓
R2
   ↓
WordPress 返回最终 attachment identity / URL
```

Transport 的职责只是：

> 把文件可靠地交给 WordPress。

它不应该自己猜 R2 URL，也不要直接生成最终媒体链接。

Publisher 应尽量依赖：

```text
attachment ID
```

作为稳定身份，再读取 WordPress 返回的最终 URL。

这也有助于避免 Phoenix Media Rename / R2 URL 变化时出现 literal URL stale 的问题。

---

# 十、未来可选：SSH + WP-CLI Transport

AWS Lightsail 当前已经证明 SSH 可由本地 Agent 自动使用。

因此未来可以考虑增加：

```text
SshWpCliTransport
```

大致流程：

```text
本地 WP Publisher
    ↓ SSH
服务器
    ↓ WP-CLI
WordPress
```

媒体：

```text
local file
    ↓ SCP/SFTP
temporary server path
    ↓ wp media import
    ↓ attachment ID
    ↓ WordPress / Media Cloud Sync
```

优点：

- 不依赖 Application Password；
- 不需要新增公网认证端点；
- SSH key 认证成熟；
- 对自有 Lightsail 环境很适合。

缺点：

- 并非所有 WordPress hosting 都提供 SSH/WP-CLI；
- 产品通用性较差；
- Media Cloud Sync 等插件对 WP-CLI media import 的 hook 行为必须实测。

因此建议：

> **现在先把 Transport interface 留出来，不要求本版立即实现 SSH/WP-CLI。**

---

# 十一、不建议的方向

## 1. 不建议为了绕开 Wordfence 改回 XML-RPC

除非明确需要兼容旧 hosting，否则不应把它作为新的主要架构。

## 2. 不建议自己匆忙造认证协议

HMAC、nonce、自定义 token 都能做，但意味着以后自己维护安全协议。

除非 Application Password / SSH 都无法满足需求，否则暂时没有必要。

## 3. 不建议把 Wordfence 设置自动关掉

Companion 不应为了让自己工作而偷偷修改安全插件策略。

## 4. 不建议长期双写 subtitle

`wptl_subtitle` 和 `_secondary_title` 必须有明确 canonical / legacy 边界。

---

# 十二、本次建议实现范围

建议下一个 WP Publisher / Companion release 控制在以下范围：

### 必做

- [ ] 把 Publisher Core 与 REST request 逻辑解耦。
- [ ] 引入 Transport interface。
- [ ] 当前 REST 实现迁入 `RestTransport`。
- [ ] 把认证封装为 REST Transport 的 AuthProvider。
- [ ] Application Password 仍作为默认实现。
- [ ] WP Title Layer active 时，subtitle 写入 canonical `wptl_subtitle`。
- [ ] legacy `_secondary_title` 不再作为 WP Title Layer 环境下的 canonical 写入目标。
- [ ] 增加 subtitle read-back 验证。
- [ ] REST create/update 后验证返回对象与实际 canonical metadata 一致。
- [ ] 更新测试。

### 建议做

- [ ] 增加独立 `wp-publisher` 低权限角色/用户的使用文档。
- [ ] Connection Test 显示：
  - REST 可达
  - Authentication 可用
  - 当前用户身份
  - 必要 capability
  - WP Title Layer detected
  - Media upload capability
- [ ] 当 Wordfence 禁用 Application Password 时给出明确诊断，不只显示 generic 401。
- [ ] 日志自动遮盖 credential。

### 暂不做

- [ ] SSH/WP-CLI Transport
- [ ] 自定义 HMAC Auth
- [ ] XML-RPC fallback
- [ ] 自动修改 Wordfence
- [ ] 历史 subtitle 批量迁移

---

# 十三、测试要求

## REST / Auth

至少验证：

```text
connection
identity
create draft
update draft
read-back
delete/cleanup test draft
```

并验证：

```text
Wordfence Application Password ON  → success
Wordfence Application Password OFF → clear actionable error
```

## Subtitle

至少测试：

### Case 1：WP Title Layer active

Publisher 写：

```text
subtitle = "ABC"
```

最终必须满足：

```text
wptl_subtitle == "ABC"
前端显示 == "ABC"
REST/read-back == "ABC"
```

不能只检查 HTTP 200。

### Case 2：修改 subtitle

```text
ABC → XYZ
```

必须确认 canonical value、编辑器显示和前端一致。

### Case 3：清空 subtitle

必须确认真正清除 canonical value，而不是留下 legacy shadow。

### Case 4：没有 WP Title Layer

根据产品定义确认：

- fallback `_secondary_title`
- 或明确 unsupported

二选一，不要模糊处理。

## Media

使用一次性测试图片：

```text
upload
→ attachment created
→ Media Cloud Sync / R2
→ final URL
→ insert post
→ reload/read-back
→ cleanup disposable object
```

验证 Publisher 以 attachment identity 为主，不依赖旧 literal URL。

---

# 十四、验收原则

这一版不是以：

> “REST 返回 200”

作为成功标准。

真正的成功标准是：

```text
Publisher intent
      ↓
Transport success
      ↓
WordPress canonical state correct
      ↓
read-back correct
      ↓
front-end result correct
```

四层一致才算完成。

---

# 十五、长期结构建议

最终希望形成：

```text
                   WP Publisher Core
                          │
          ┌───────────────┴────────────────┐
          │                                │
  Content / WordPress Adapter          Transport
          │                                │
    ┌─────┼────────┐              ┌────────┴────────┐
    │     │        │              │                 │
 Subtitle SEO    Media          REST          SSH/WP-CLI
    │                        ┌─────┴─────┐        (future)
WP Title Layer              AuthProvider
                             │
                     Application Password
```

这样以后任何一层变化：

- Wordfence 改认证策略；
- WP Title Layer 改 subtitle；
- Rank Math 改 metadata；
- hosting 改成 SSH-only；
- Media Cloud 改 R2 路径；

都不需要重新改整个 Publisher。

---

## 一句话目标

> **WP Publisher 应该知道“我要发布什么”，WordPress Adapter 决定“这些内容在 WordPress 里是什么”，Transport 决定“怎样送过去”，Auth 决定“凭什么允许送”。四者不要再混成一个问题。**
