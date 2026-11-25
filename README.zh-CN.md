# WP Publisher

[English](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/README.md) | **简体中文**

将 Obsidian 笔记发布到 WordPress，并通过明确触发的同步流程保持两端一致，
同时让 Markdown、Front Matter、媒体文件和 WordPress 原生编辑始终处于你的掌控之中。

本项目是
[`devbean/obsidian-wordpress`](https://github.com/devbean/obsidian-wordpress)
的独立维护分支。它已从单向发布工具扩展为一套受保护的编辑工作流，支持
Gutenberg 输出、媒体去重、发布预览、多站点发布，以及经过审阅的
WordPress 到 Obsidian 同步。

[WP Publisher 1.2.0](https://github.com/irisable/wp-publisher-for-obsidian/releases/tag/1.2.0)
加入了原生 MP3 音频区块、系列内容分组和高级系列角色。
[1.2.1](https://github.com/irisable/wp-publisher-for-obsidian/releases/tag/1.2.1)
会在本地媒体找不到或上传失败时停止提交文章。

## 主要功能

- 默认将常见 Markdown 结构发布为原生 Gutenberg 区块。
- 保留经典 HTML 输出，以兼容较旧的 WordPress 工作流。
- 明确显示将要新建还是更新文章，并支持完整更新或仅更新正文。
- 发布标题、别名、摘要、分类、标签、特色图片、计划时间、评论状态、
  文章类型、Rank Math 字段、Irisable Title Layer 副标题和可移植的系列归属。
- 按内容哈希复用未变化的媒体，并可更新附件元数据。
- 发布前预览渲染内容、元数据、Gutenberg 区块和 HTML 回退。
- 保存各账号的默认发布设置和可复用发布模板。
- 将冻结后的同一笔记版本发布到多个站点，或运行经过确认的批量发布。
- 检查、拉取、比较和合并 WordPress 远端修改，不进行后台覆盖，
  也不采用最后写入者胜出的策略。
- 保留无关 Front Matter 属性，并以可移植的分类 slug 存储分类。

完整实现地图和验收记录请参阅
[`docs/feature-map.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/feature-map.md)。

## 安装

需要 Obsidian 1.8.7 或更高版本。

### 从 Obsidian 安装

1. 打开 **设置 > 第三方插件**。
2. 选择 **浏览**，搜索 **WP Publisher**。
3. 选择 **安装**，然后启用插件。

也可以打开
[WP Publisher 社区插件页面](https://community.obsidian.md/plugins/wp-publisher)。

### 手动安装

1. 从同一个 [GitHub 发布页](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest)
   下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 将三个文件放入 `<Vault>/.obsidian/plugins/wp-publisher/`。
   更新时保留原有的 `data.json`。
3. 重新加载 Obsidian，打开 **设置 > 第三方插件**，启用
   **WP Publisher**。

使用本分支时请禁用旧版 `obsidian-wordpress` 插件，以免出现重复命令，
或误用旧插件执行发布。

### 从源码构建

```bash
npm ci
npm test
npm run build
```

本地开发时可运行 `npm run dev`，并将本仓库链接到测试 Vault 的插件目录。
开发期间请使用专用测试 Vault，不要直接使用主要 Vault。

## 连接 WordPress

在 **设置 > WP Publisher > WordPress 账户** 中创建账号配置。
支持以下连接方式：

- 使用 Application Password 的 WordPress REST API，推荐用于
  WordPress 5.6 或更高版本。
- 受 miniOrange Basic Authentication 保护的 WordPress REST API。
- 在仍启用 XML-RPC 的站点上使用 XML-RPC。

如条件允许，请使用专用、可撤销的 WordPress Application Password，
不要使用 WordPress 账号主密码。

Wordfence 可以禁用 WordPress Application Password。此时 REST API 本身仍可访问，
但 Publisher 的认证请求会被拒绝。插件会显示 HTTP 状态和 WordPress 错误 code；
Companion 不会绕过该策略，也不会静默切换到 XML-RPC。

当前版本不支持新建 WordPress.com 连接。新账号不能选择 WordPress.com。
如果已有账号保存了旧版 token，插件仍可读取它以便迁移，但本版本不能授权、
验证或刷新该 token。

## 发布笔记

打开一个 Markdown 笔记，然后从命令面板运行 **发布当前笔记**。
发布窗口会明确显示本次操作将新建文章还是更新已有文章。更新已有文章时，
可以选择完整更新或仅更新正文。

更快捷的 **使用默认参数发布当前笔记** 命令不会打开完整发布窗口，
而是直接使用默认账号、账号默认值、笔记属性和已经解析出的发布控制项。

默认使用 Gutenberg 区块编辑器格式。只有当站点需要经典 HTML 时，
才应在插件设置中修改 **WordPress 内容格式**。

## Front Matter

所有字段均为可选。由笔记控制的标准属性包括：

```yaml
---
title: A WordPress title
subtitle: An optional subtitle
series: an-existing-series-slug
seriesSeason: 2
seriesLabel: "15A"
seriesGroup: W1 看见人的软弱
slug: a-portable-slug
excerpt: A short WordPress excerpt
metaDescription: A Rank Math SEO description
focusKeyword:
  - first keyword
  - second keyword
featuredImage: Images/cover.jpg
categories:
  - parent-category
  - child-category
wpTags:
  - Obsidian 发布
  - WordPress 工作流
status: draft
commentStatus: open
---
```

插件仍兼容读取 `focus_keyword`、`meta_description`、`secondaryTitle`、
`secondary_title` 和 `comment_status` 等旧属性名。

副标题与系列由 [Irisable Title Layer](https://wordpress.org/plugins/irisable-title-layer/)
（原 WP Title Layer）提供。当所选文章类型公开相应 REST 字段时，
`subtitle` 写入 `wptl_subtitle`。旧 Secondary Title 站点仍可通过 Companion
读写旧字段，每次只写入当前提供方的字段。已有笔记可继续沿用兼容属性名，
新笔记及新拉取的副标题首选 `subtitle`。

`series` 指向 WordPress 中已存在的系列。平铺系列只需 slug；分季系列
还需填写该分季稳定的公开 `seriesSeason` ID。更新文章时省略 `series` 会保留远端
归属，`series: ""` 表示明确移出系列。系列归属需要 REST 账号。启用书籍式结构
的系列还可以使用 `seriesRole`（`intro`、`epilogue`、`appendix`）。非正文角色用
`seriesScope: series` 或 `season` 区分全系列和分季范围。选择全系列范围时不填写
分季。插件会依据系列公开的书籍式结构能力决定是否允许写入高级角色。
分季 Series 的多站点发布须逐站执行，以便分别核对各站的 Season 名称。系列定义
和篇序仍完全由 WordPress 管理。

`seriesGroup: "W1 看见人的软弱"` 指定所选系列和季内的内容分组，需要支持该
REST 字段的文章类型。省略属性保留远端分组；
`seriesGroup: ""` 明确取消分组。只接受字符串，不能用 YAML 空值代替清空。
发布后读取规范组名，仅在笔记中的原属性未被你修改时回写。目标站不支持时会
明确提示并停止此次发布。拉取和冲突合并也可单独选择内容分组字段。
分组仅作用于主要文章；非正文不显示分组输入框，保留历史值但不发送或清空。

`wpTags` 专门保存 WordPress 标签名称，可以包含空格；发布时再解析为所选站点的
标签，不把站点专属标识存入笔记。Obsidian 正文内的 `#标签` 留在本地。插件保留
`tags` 属性，仅在旧笔记缺少 `wpTags` 时才把它作为兼容输入。完整发布成功后，
启用了笔记回写的操作会写入 `wpTags`。如需明确不发布 WordPress 标签，请设置
`wpTags: []`。

发布成功后，插件可能维护以下关联和活动记录属性：

- `wpProfile`
- `wpPostId`
- `wpPostType`
- `wpLastPublishedAt`
- `wpLastPublishAction`

回填操作是非破坏性的：无关属性会被保留，分类仍使用便于阅读和迁移的 slug，
`wpTags` 使用 WordPress 标签名称，二者都不会替换为站点内部 ID。

## 媒体元数据

普通 Markdown 图片的替代文字会作为图片 Alt Text 发送到 WordPress，
不会自动成为可见图注：

```markdown
![A descriptive Alt Text](Images/cover.png)
```

需要设置附件元数据时，可在图片后加入相邻的 `wp-media` 注释：

```markdown
![A descriptive Alt Text](Images/cover.png)
%% wp-media
title: Cover image title
altText: A more specific accessible description
caption: =alt
description: Media-library description
%%
```

`caption: =alt` 会明确要求插件将最终 Alt Text 同时用作 WordPress
附件说明文字和可编辑的 Gutenberg `figcaption`。

显式 `title` 只作为媒体库中的附件标题，不会再被拼到可见 `figcaption` 前面；
字面 `caption` 的可见内容就是它本身。

当 `featuredImage` 指向的图片不在正文显示时，可将一个不带图片的
`wp-media` 块放在正文第一个非空位置。该块只为特色图片提供元数据，发布时会从
正文移除。因为正文中没有这张图片，`caption` 只更新 WordPress 附件说明文字，
不会生成 `figcaption`：

```markdown
%% wp-media
title: 封面图片标题
altText: 便于无障碍阅读的封面说明
caption: 媒体库说明文字
description: 更完整的附件说明
%%
```

### MP3 音频

将 `![[audio/reading.mp3]]` 或标准 Markdown 嵌入单独放在一个段落，区块编辑器
模式会生成 WordPress 原生音频区块。

```markdown
![](audio/reading.mp3)
%% wp-media
title: 文章朗读
caption: 收听本文
description: 本文的朗读版。
%%
```

`caption` 显示在播放器下方。本地上传和复用的附件可以同步媒体库中的
`title`、`caption` 和 `description`。填写完整的远程 MP3 网址也可显示正文图注。
更新远程音频的附件元数据需要当前账号缓存中有对应附件。没有映射时，
可在 WordPress 媒体库填写这些字段。`altText` 适用于图片。

## 显式双向同步

同步始终由用户主动触发。命令面板提供以下功能：

- 只检查远端文章，不写入任何一端。
- 预览并选择要拉取的字段。拉取时，音频区块以受保护的 WordPress 源码保留。
- 使用有容量限制的共同基线判断同步状态。
- 对已经分歧的笔记执行经过审阅的三方合并。
- 撤销最近一次拉取。
- 清除同步基线，但不解除笔记与文章的关联。

插件刻意不提供定时后台同步、自动传播删除、静默选择冲突结果、批量拉取，
或二进制媒体合并。

## 可选 WordPress Companion

当自托管 WordPress 需要写入受保护的 Rank Math 字段、旧 Secondary Title，
或通过 XML-RPC 更新附件元数据时，请安装
[`WP Publisher Companion`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/wordpress-companion/README.md)。
Irisable Title Layer 的副标题和系列归属使用文章类型的核心 REST 字段。
Companion 0.5.0 会报告当前副标题提供方，并在 Title Layer 激活时停用旧
`_secondary_title` 写入。
不安装 Companion 仍可正常发布普通文章；不受支持的控制项会明确显示为不可用，
而不是静默失败。

Companion 是独立的 **WordPress 端插件**，安装 Obsidian 中的 WP Publisher
不会自动在网站上安装或启用它。目前通过 GitHub Releases 分发，暂未上架
WordPress.org 插件目录。

1. 打开 [Publisher 最新发布页](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest)，
   在 **Assets** 中下载 **`wp-publisher-companion.zip`**
   （[直接下载](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest/download/wp-publisher-companion.zip)）。
   不要选择 Publisher 安装包或 GitHub 的源码压缩包。
2. 进入目标网站的 WordPress 后台，选择 **插件 → 安装插件 → 上传插件**，
   选择该 ZIP，点击 **现在安装 → 启用插件**。
   需要具备安装插件权限；没有权限时请联系网站管理员。
3. 回到 WP Publisher，重新测试该网站的连接。若向多个网站发布，
   请在需要这些功能的网站上分别安装 Companion。

需要副标题或系列功能的网站请另行安装 Irisable Title Layer。Companion 遵循站点的
认证和安全设置。
更新时，从新版发布页下载 Companion ZIP，在同一 WordPress 上传界面安装并按提示替换旧版；
只更新 Obsidian 插件不会更新网站上的 Companion。

## 隐私与网络访问

- 插件不包含遥测、分析、广告或第三方 AI 服务。
- 插件只会将笔记内容和选中的媒体发送到你配置的 WordPress 端点。
  旧版 WordPress.com token 账号可能访问 WordPress.com REST API，
  但本版本不会打开 OAuth 授权端点。
- 明确执行远端媒体下载时，插件可能请求关联 WordPress 文章中包含的图片 URL。
- 账号配置、有容量限制的历史记录、同步基线、媒体哈希和 OAuth token
  均保存在插件本地的 `data.json` 中。
- 被记住的密码会在本地加密，但加密材料也保存在插件数据中，
  并未使用操作系统钥匙串。请将 Vault 配置目录视为敏感数据，
  并优先使用可撤销的 Application Password。

## 开发

```bash
npm run lint           # TypeScript lint
npm test               # 行为回归测试
npm run build          # TypeScript 验证和生产构建
npm run check          # lint、测试和生产构建
npm run release:check  # 发布元数据、文档、翻译和安装包检查
npm run version:set -- 1.2.3  # 同步发布版本文件
npm run dev            # 为本地 Obsidian 测试启动监听构建
```

版本说明请参阅
[`CHANGELOG.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/CHANGELOG.md)，
标准功能地图请参阅
[`docs/feature-map.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/feature-map.md)。
发布维护者还应完成
[`docs/release-checklist.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/release-checklist.md)。
带标签的构建会被打包为 GitHub Draft Release，以便在公开发布前检查附件。

## 许可证与致谢

本项目采用
[Apache License 2.0](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/LICENSE)。
历史上游变更记录和作者信息继续保留，以致谢原始
`devbean/obsidian-wordpress` 项目。
