# WP Publisher

**English** | [简体中文](#简体中文)

## English

Publish and explicitly synchronize Obsidian notes with WordPress while keeping
Markdown, front matter, media, and WordPress-native editing under your control.

This project is an independently maintained fork of
[`devbean/obsidian-wordpress`](https://github.com/devbean/obsidian-wordpress).
It has expanded from one-way publishing into a guarded editorial workflow with
Gutenberg output, media deduplication, preview, multi-site publishing, and
reviewed WordPress-to-Obsidian synchronization.

> **Release status:** WP Publisher is available from Obsidian's Community
> Plugins directory. The P0-P3 feature set has passed local, clean-Vault, and
> real-site testing.

## Highlights

- Publish common Markdown structures as native Gutenberg blocks by default.
- Keep classic HTML output available for older WordPress workflows.
- Create or update posts with an explicit target banner and full or
  content-only update modes.
- Publish titles, slugs, excerpts, categories, tags, featured images, scheduled
  dates, comments, post types, Rank Math fields, and Secondary Title metadata.
- Reuse unchanged media by content hash and update attachment metadata.
- Preview rendered content, metadata, Gutenberg blocks, and HTML fallbacks
  before publishing.
- Save per-profile defaults and reusable publishing templates.
- Publish one frozen note revision to multiple sites or run a reviewed batch.
- Inspect, pull, compare, and merge remote WordPress changes without background
  overwrite or last-write-wins behavior.
- Preserve unrelated front matter and keep category slugs portable.

The complete implementation map and acceptance history are in
[`docs/feature-map.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/feature-map.md).

## Installation

### Install From Obsidian

1. Open **Settings > Community plugins**.
2. Select **Browse** and search for **WP Publisher**.
3. Select **Install**, then **Enable**.

You can also open the
[WP Publisher community directory page](https://community.obsidian.md/plugins/wp-publisher).

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the same GitHub
   [release](https://github.com/irisable/wp-publisher-for-obsidian/releases).
2. Place all three files in one folder under
   `<Vault>/.obsidian/plugins/`.
3. Reload Obsidian, open **Settings > Community plugins**, and enable
   **WP Publisher**.

Disable the legacy `obsidian-wordpress` plugin while using this fork to avoid
duplicate commands and publishing through the wrong plugin.

### Build from source

```bash
npm ci
npm test
npm run build
```

For local development, run `npm run dev` and link this repository into a test
Vault's plugin directory. Use a dedicated test Vault rather than a primary
Vault while developing.

## Connect WordPress

Create a profile in **Settings > WP Publisher > Profiles**.
Supported transports are:

- WordPress REST API with an Application Password, recommended for WordPress
  5.6 or newer.
- WordPress REST API protected by miniOrange basic authentication.
- XML-RPC for sites where XML-RPC remains enabled.

Use a dedicated, revocable WordPress Application Password rather than your main
account password whenever possible.

WordPress.com is not a supported connection type in 1.0. New profiles cannot
select it. A profile that already contains a saved legacy token remains readable
for migration compatibility, but the token cannot be authorized, validated, or
refreshed by this release.

## Publish A Note

Open a Markdown note and run **Publish to WordPress** from the command palette.
The publish dialog shows whether the action will create a new post or update an
existing one. Existing posts can use a full update or a content-only update.

The faster **Publish with default options** command uses the default profile,
profile defaults, note properties, and any resolved publishing controls without
opening the full dialog.

Gutenberg Block Editor output is the default. Change **Content format** in the
plugin settings only when a site requires classic HTML.

## Front Matter

All fields are optional. Canonical note-controlled properties include:

```yaml
---
title: A WordPress title
secondaryTitle: An optional subtitle
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
  - Obsidian publishing
  - WordPress workflow
status: draft
commentStatus: open
---
```

Compatibility aliases remain readable for `focus_keyword`,
`meta_description`, `secondary_title`, and `comment_status`.

`wpTags` contains WordPress tag names and may include spaces. The transport
resolves them to the selected site's term IDs and slugs, so site-specific
identifiers are not stored in the note. Obsidian's `tags` property and inline
`#tags` stay local and are never changed or published by the plugin. For
existing notes, front matter `tags` is accepted as a legacy fallback only when
`wpTags` is absent; the next successful full publish of a post writes `wpTags`.
Use `wpTags: []` to publish no WordPress tags.

After a successful publish, the plugin may maintain these relationship and
activity properties:

- `wpProfile`
- `wpPostId`
- `wpPostType`
- `wpLastPublishedAt`
- `wpLastPublishAction`

Write-back is non-destructive: unrelated properties are preserved, categories
remain human-readable slugs, and `wpTags` uses WordPress tag names rather than
site-specific IDs.

## Media Metadata

Normal Markdown alt text is sent as image Alt Text and does not become a visible
caption automatically:

```markdown
![A descriptive Alt Text](Images/cover.png)
```

Add an adjacent `wp-media` comment when attachment metadata is needed:

```markdown
![A descriptive Alt Text](Images/cover.png)
%% wp-media
title: Cover image title
altText: A more specific accessible description
caption: =alt
description: Media-library description
%%
```

`caption: =alt` explicitly reuses the final Alt Text as both the WordPress
attachment caption and the editable Gutenberg figcaption.

## Explicit Synchronization

Synchronization is always user initiated. The command palette provides:

- Remote post inspection without writing either side.
- A selective pull preview.
- Sync-state classification using a bounded common baseline.
- Reviewed three-way merge for diverged notes.
- Guarded undo for the most recent pull.
- Explicit baseline clearing without unlinking posts.

The plugin deliberately does not perform timer-based sync, automatic deletion
propagation, silent conflict selection, batch pull, or binary media merge.

## Optional WordPress Companion

Install [`WP Publisher Companion`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/wordpress-companion/README.md) on
self-hosted WordPress when you need protected Rank Math fields, Secondary Title,
or XML-RPC attachment metadata. Ordinary post publishing continues without it;
unsupported controls are shown as unavailable rather than silently failing.

## Privacy And Network Use

- The plugin includes no telemetry, analytics, advertising, or third-party AI
  service.
- It sends note content and selected media only to WordPress endpoints that you
  configure. A pre-existing legacy WordPress.com token profile may contact the
  WordPress.com REST API, but this release opens no OAuth authorization endpoint.
- Explicit remote-media download can request image URLs contained in the linked
  WordPress post.
- Profiles, bounded history, sync baselines, media hashes, and OAuth tokens are
  stored locally in the plugin's `data.json`.
- Remembered passwords are encrypted locally, but the encryption material is
  stored with the plugin data and is not an operating-system keychain. Treat the
  Vault configuration directory as sensitive and prefer revocable Application
  Passwords.

## Development

```bash
npm run lint           # TypeScript lint
npm test               # behavioral regression suite
npm run build          # TypeScript validation and production bundle
npm run check          # lint, tests, and production build
npm run release:check  # release metadata, docs, translations, and packages
npm run version:set -- 1.2.3  # synchronize release version files
npm run dev            # watch build for local Obsidian testing
```

See [`CHANGELOG.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/CHANGELOG.md) for release notes and
[`docs/feature-map.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/feature-map.md) for the canonical feature map.
Release maintainers should complete the
[`docs/release-checklist.md`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/docs/release-checklist.md).
Tagged builds are packaged as draft GitHub releases so the assets can be
inspected before publication.

## License And Credits

Licensed under the [Apache License 2.0](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/LICENSE). Historical upstream changelog
entries and authorship are retained in recognition of the original
`devbean/obsidian-wordpress` project.

---

## 简体中文

[English](#english) | **简体中文**

将 Obsidian 笔记发布到 WordPress，并通过明确触发的同步流程保持两端一致，
同时让 Markdown、Front Matter、媒体文件和 WordPress 原生编辑始终处于你的掌控之中。

本项目是
[`devbean/obsidian-wordpress`](https://github.com/devbean/obsidian-wordpress)
的独立维护分支。它已从单向发布工具扩展为一套受保护的编辑工作流，支持
Gutenberg 输出、媒体去重、发布预览、多站点发布，以及经过审阅的
WordPress 到 Obsidian 同步。

> **发布状态：** WP Publisher 已进入 Obsidian 社区插件目录。P0-P3
> 功能集已经通过本地测试、空白 Vault 测试和真实站点测试。

## 主要功能

- 默认将常见 Markdown 结构发布为原生 Gutenberg 区块。
- 保留经典 HTML 输出，以兼容较旧的 WordPress 工作流。
- 明确显示将要新建还是更新文章，并支持完整更新或仅更新正文。
- 发布标题、别名、摘要、分类、标签、特色图片、计划时间、评论状态、
  文章类型、Rank Math 字段和 Secondary Title 副标题。
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

### 从 Obsidian 安装

1. 打开 **设置 > 第三方插件**。
2. 选择 **浏览**，搜索 **WP Publisher**。
3. 选择 **安装**，然后启用插件。

也可以打开
[WP Publisher 社区插件页面](https://community.obsidian.md/plugins/wp-publisher)。

### 手动安装

1. 从同一个 [GitHub Release](https://github.com/irisable/wp-publisher-for-obsidian/releases)
   下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 将三个文件放入 `<Vault>/.obsidian/plugins/` 下的同一个文件夹。
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

1.0 版不支持新建 WordPress.com 连接。新账号不能选择 WordPress.com。
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
secondaryTitle: An optional subtitle
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

插件仍兼容读取 `focus_keyword`、`meta_description`、`secondary_title`
和 `comment_status` 等旧属性名。

`wpTags` 专门保存 WordPress 标签名称，可以包含空格；发布时再解析为所选站点的
term ID 和 slug，不把站点专属标识存入笔记。Obsidian 自身的 `tags` 属性和正文内
的 `#标签` 只留在本地，插件不会修改或发布它们。对于旧笔记，仅当 `wpTags`
不存在时，front matter 的 `tags` 才会作为兼容输入；下次对文章执行完整发布后
会写入 `wpTags`。如需明确不发布任何 WordPress 标签，请设置 `wpTags: []`。

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

## 显式双向同步

同步始终由用户主动触发。命令面板提供以下功能：

- 只检查远端文章，不写入任何一端。
- 预览并选择要拉取的字段。
- 使用有容量限制的共同基线判断同步状态。
- 对已经分歧的笔记执行经过审阅的三方合并。
- 撤销最近一次拉取。
- 清除同步基线，但不解除笔记与文章的关联。

插件刻意不提供定时后台同步、自动传播删除、静默选择冲突结果、批量拉取，
或二进制媒体合并。

## 可选 WordPress Companion

当自托管 WordPress 需要写入受保护的 Rank Math 字段、Secondary Title，
或通过 XML-RPC 更新附件元数据时，请安装
[`WP Publisher Companion`](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/wordpress-companion/README.md)。
不安装 Companion 仍可正常发布普通文章；不受支持的控制项会明确显示为不可用，
而不是静默失败。

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
