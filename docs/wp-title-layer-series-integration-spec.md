# WP Title Layer Series 集成规格

> 状态：**Implemented and accepted for 1.1.0 / 自动化、独立 QA 与人工验收已通过**
>
> 目标项目：WP Publisher for Obsidian
>
> 对接插件：WP Title Layer
>
> 审核基线：2026-08-29 两个项目的当前工作区代码
>
> 本文记录 1.1.0 的数据契约、实现边界和验收依据。

## 1. 结论摘要

WP Publisher 应把一篇文章在 WP Title Layer 中的归属视为一个完整的
**Series placement（系列位置）**，而不是一组彼此无关的自定义字段。

建议增加以下五个 canonical frontmatter 属性：

```yaml
series: incarnational-communication
seriesSeason: 2
seriesRole: article
seriesScope: season
seriesLabel: "15"
```

但五项并非都要填写：

- 平铺 Series 的普通正文只需 `series`。
- 分季 Series 的普通正文只需 `series` 和 `seriesSeason`。
- `seriesRole`、`seriesScope`、`seriesLabel` 构成完整契约，但高级角色只有在目标站点能明确报告已启用书籍式结构时才能开放；不能从私有 marker 猜测。
- 不增加常规的 `seriesOrder`、`seriesPosition` 或 rank 属性。
- Series、Season 必须预先在 WordPress 中定义；文章发布流程不得自动创建或修改定义。
- Application Password REST 是第一实现目标；包含 Series 属性的 XML-RPC 发布暂不支持，并且必须在写文章之前明确报错。

## 2. 目标

完成后，作者可以在 Obsidian 中声明一篇文章：

- 属于哪个现有 Series；
- 属于哪个现有 Season；
- 是普通正文、序文、尾文还是附录；
- 非普通正文作用于整个 Series 还是某一 Season；
- 是否有一个特殊的公开篇号或结构标签。

WP Publisher 负责把可移植的 frontmatter 值解析成当前目标站点的 WordPress
ID 和 WP Title Layer canonical metadata，并在发布前验证组合是否合法。

## 3. 范围与非目标

### 3.1 本规格包含

- Frontmatter 读取、规范化和非破坏性回写。
- 按目标 profile 解析 Series slug。
- 将 Season 稳定数字 `public_id` 映射成站点内部 Season key。
- WordPress 核心 REST 文章 payload。
- 发布前校验、错误提示和发布后对公开 Series placement 的强回读。
- Inspect、Pull、Diff、Merge、同步 baseline 的往返支持。
- 多站点发布时逐站点解析，不共享 term ID。
- WP Title Layer canonical Subtitle 写入的相邻兼容任务。

### 3.2 本规格不包含

- 从 Obsidian 创建、重命名或删除 Series。
- 从 Obsidian创建、重命名、重排或删除 Season。
- 修改 Series 的 ordered/unordered、flat/seasoned、Archive、模板、图标、封面或父分类等定义。
- 从 Obsidian 写入 WP Title Layer 的内部 rank、revision、schema marker 或迁移记录。
- 在 frontmatter 中手工维护托管篇序。
- 通过文章发布自动修复 Series 与 Category 的组织关系。
- 第一阶段的 XML-RPC Series 支持。

## 4. 数据所有权

| 数据 | 所有者 | WP Publisher 的职责 |
| --- | --- | --- |
| Series 名称、slug、模式、结构及设置 | WP Title Layer / WordPress | 只读解析，不创建、不修改 |
| Season 定义、内部 key、稳定 `public_id` | WP Title Layer / WordPress | 读取并完成 ID 到 key 的映射 |
| 文章的 Series/Season/role/scope/label | 作者与 WP Publisher | 经过校验后写入，并支持安全往返 |
| 托管篇序 rank、revision、迁移 marker | WP Title Layer | 绝不读取后猜测，绝不外部写入；公开 REST 不能验证其内部写入结果 |
| Category | WordPress 文章分类工作流 | 与 Series 分开处理；不匹配只提示 |

Series 是单一主 Series：一篇文章最多属于一个 WP Title Layer Series。因此
frontmatter 的 `series` 必须是标量，不能设计为数组。

## 5. Canonical frontmatter 契约

### 5.1 属性定义

| 属性 | 类型 | 允许值 | 语义 |
| --- | --- | --- | --- |
| `series` | string | 一个现有 Series 的 slug | Series placement 的入口和所有权标志 |
| `seriesSeason` | positive integer | Season 的稳定 `public_id` | 仅用于分季 Series；Publisher 映射为内部 key |
| `seriesRole` | string | `article`, `intro`, `epilogue`, `appendix` | 缺省按 `article` 处理 |
| `seriesScope` | string | `series`, `season` | 分季非正文角色必须明确填写 |
| `seriesLabel` | string | 纯文本，例如 `0-2`, `15A`, `Appendix A` | 公开显示覆盖值，不参与排序 |

### 5.2 命名决定

- Canonical 名称使用 `series`，不使用站点 term ID，也不使用 Series 名称。
- 不为新字段同时引入 snake_case aliases，避免一开始就形成双重所有权。
- `series` 不需要改名为 `wpSeries`：它没有类似 Obsidian `tags` 的系统级语义冲突。
- 如果未来发现真实 Vault 已普遍占用 `series` 表达其他含义，再单独设计迁移，不在第一版预埋猜测逻辑。

### 5.3 值规范化

- `series`：接受非空字符串，trim 后按 WordPress 返回的 slug 原样保存；不得在客户端重新生成 slug。
- `seriesSeason`：可兼容读取 YAML number 或只包含数字的 string，但 canonical 回写为正整数。
- `seriesRole`、`seriesScope`：trim 后转为小写，并严格限制在允许值内。
- `seriesLabel`：接受可转成字符串的单个标量，trim 后保存为字符串；数字篇号也建议在 YAML 中加引号。
- 数组、对象、布尔值或非法枚举不得静默转换，应在发布预检中指出具体属性。

## 6. 合法组合

| 场景 | 必需属性 | 不应出现或应为空 |
| --- | --- | --- |
| 无 Series 的普通文章 | 无 | 所有 Series 属性 |
| 平铺 Series 普通正文 | `series` | `seriesSeason`; role/scope 可省略 |
| 分季 Series 普通正文 | `series`, `seriesSeason` | `seriesScope: series` |
| 平铺 Series 序文/尾文/附录 | `series`, 非 `article` 的 `seriesRole` | `seriesSeason`; scope 可省略或为 `series` |
| 分季、Season 级序文/尾文/附录 | `series`, `seriesSeason`, 非正文 `seriesRole`, `seriesScope: season` | — |
| 分季、全 Series 序文/尾文/附录 | `series`, 非正文 `seriesRole`, `seriesScope: series` | `seriesSeason` |

补充规则：

- 普通正文的 scope 由目标 Series 结构决定：平铺正文属于 Series，分季正文属于所选 Season。
- 分季普通正文不得显式声明 `seriesScope: series`。
- `seriesScope: season` 必须同时有合法 `seriesSeason`。
- `seriesScope: series` 与 `seriesSeason` 同时出现属于矛盾输入，应报错而不是猜测。
- `seriesRole` 缺省或显式为 `article` 均表示普通正文；回写时可省略默认值。
- `seriesLabel` 可以用于任一合法 placement，但它不是排序号。
- 序文、尾文和附录的正式轨道语义以目标 Series 已启用 WP Title Layer 书籍式结构为前提。

当前 WPTL 把 `wptl_book_structure_version` 设为私有 metadata，标准 REST term
response 不会报告 `bookStructureEnabled`。因此第一发布切片应只承诺普通正文
placement。若要在 UI 或自动发布中支持 `intro`、`epilogue`、`appendix`，必须二选一：

1. 由 WPTL 增加不暴露内部版本值的只读语义能力，例如
   `bookStructureEnabled: true|false`；或
2. 把高级 role/scope 明确留在后续阶段，不因 frontmatter 中出现这些值就猜测已启用。

本规格倾向方案 1，但该只读能力尚不存在，实施时必须把它列为前置依赖。

## 7. 示例

### 7.1 平铺 Series 正文

```yaml
---
title: 道成肉身的沟通学
series: incarnational-communication
---
```

### 7.2 分季 Series 正文

```yaml
---
title: 抵达
subtitle: 沟通不是把答案送到对方手里
series: incarnational-communication
seriesSeason: 2
---
```

### 7.3 某一 Season 的第二篇序文

```yaml
---
title: 写在抵达之前（二）
series: incarnational-communication
seriesSeason: 2
seriesRole: intro
seriesScope: season
seriesLabel: "0-2"
---
```

### 7.4 全 Series 的尾文

```yaml
---
title: 全书后记
series: incarnational-communication
seriesRole: epilogue
seriesScope: series
seriesLabel: Afterword
---
```

## 8. 属性缺失、显式空值与更新语义

Series placement 必须作为一个原子字段组处理，不能分别更新出半个合法状态。

### 8.1 新建文章

- `series` 不存在：建立普通文章，不带 Series。
- `series` 非空：按本地整组 Series 属性建立 placement。
- `series` 为空：等同没有 Series，但应在预览中显示“明确无 Series”。

### 8.2 更新已有文章

- `series` 属性不存在：不触碰远端已有的 Series、Season、role、scope、label。
- `series:`、`series: ""` 或 `series: null`：明确解除 Series，并清空所有依赖字段。
- `series` 非空：本地 frontmatter 接管整个 Series placement：
  - 缺少 `seriesRole` 表示 `article`；
  - 缺少 `seriesLabel` 表示没有公开标签覆盖；
  - Season/scope 必须按第 6 节构成完整合法组合。
- 从一个 Series 改到另一个 Series 时，必须根据新 Series 重新解析 Season；不得保留旧 Series 的内部 key。

### 8.3 更新策略

- Content-only update：无条件保留远端 Series placement。
- Full update：遵守上述“`series` 是否存在”的语义。
- Reviewed merge：Series placement 作为一个可选择的原子 diff 项；UI 可以展示五个子字段，但不能只应用会造成无效组合的一部分。
- Pull：只写回经过用户确认的 Series placement，并保留无关 frontmatter。

同步模型必须保存一个独立的 `present/owned` 状态：

- 本地没有 `series` 属性时，该字段组是“未纳入本地所有权”，不参与删除比较；
- 不能把 missing 规范化成空 Series，也不能据此产生本地删除或冲突；
- 只有用户确认 Pull 并写入 `series` 后，本地才开始拥有这组字段；
- `series` 键明确存在且为空，才表示受审阅的删除意图；
- baseline 必须保存该存在性状态，而不只是保存一个可能为空的字符串。

实现时不能使用“取值为空即视为属性不存在”的通用 helper；必须先用
`hasOwnProperty` 区分 missing、null 和 empty。

## 9. WordPress REST 解析与保存

### 9.1 能力与 Series 解析

第一版支持 WP Title Layer 默认的 `wptl_series` taxonomy。

提交 Series placement 前，还必须确认当前目标 post type 实际注册了该 taxonomy。
WPTL 默认只为普通 `post` 注册 Series；`page` 或 custom post type 只有在站点通过
WPTL filter 明确启用后才可使用。不能因为 taxonomy endpoint 存在，就假设当前
post type 可分配 Series。

对每个目标 profile，Publisher 应使用该 profile 的凭据执行精确查询：

```http
GET /wp-json/wp/v2/wptl_series?slug=incarnational-communication&context=edit
```

要求：

1. 返回且仅返回一个匹配 term。
2. 使用返回的 term `id` 作为该目标站点本次请求的临时 ID。
3. 读取 term metadata：
   - `wptl_series_mode`
   - `wptl_series_structure`
   - `wptl_seasons`
4. 不把 term ID 写入 frontmatter、模板或跨站共享缓存。
5. Series 不存在时终止包含 Series 的文章写入，不自动创建 term。

WPTL 当前 term metadata 的授权要求用户能够 `edit_term`。仅有 `assign_terms`
能力的作者可能能给文章选择 Series，却无法通过标准 REST 读取 Season 定义。
第一版应明确要求所用 WordPress 凭据具有读取这些编辑态 term metadata 的权限；
收到 401/403 或 meta 不可见时显示权限错误。若未来需要支持 assign-only 作者，
应由 WPTL 提供经过权限审计的只读 publishing-context endpoint，而不是放宽全部
Series definition 的写权限。

如果站点通过 `wptl_series_taxonomy_key` 采用了非默认 taxonomy，第一版应明确
提示“不支持自定义 Series taxonomy”，不能根据显示名称猜测。未来若需要支持，
应先增加稳定的语义化 discovery contract。

### 9.2 Season 映射

`seriesSeason` 对应 `wptl_seasons` 数组中稳定的 `public_id`：

```json
{
  "key": "arrival",
  "label": "抵达篇",
  "sort": 20,
  "public_id": 2
}
```

Publisher 把 `seriesSeason: 2` 映射为文章 metadata：

```json
{
  "wptl_season_key": "arrival"
}
```

不得把数字 `2` 直接写进 `wptl_season_key`，也不得把 Season label 当作稳定标识。
Season 改名或重排后，同一 `public_id` 仍应解析到同一 Season。

旧 Season 可能还没有 `public_id`。此时不得退回 label 或内部 key；应提示用户到
WordPress 的 Series 编辑页保存一次，或先完成相应的 Sequence 初始化，使 WPTL
建立稳定 Season ID，然后重试。

`public_id` 只保证在一个站点内稳定，并不是跨站 UUID。多站点发布时，每个 profile
必须分别显示 `public_id` 实际解析到的 Season label。若同一数字在不同站点解析到
不同 Season，必须要求用户逐站点复核或中止，不得把“数字相同”当作跨站语义相同。

### 9.3 文章 REST payload

全部预检完成后，在**同一次**文章 create/update 请求中发送 taxonomy 与 metadata：

```json
{
  "wptl_series": [123],
  "meta": {
    "wptl_subtitle": "沟通不是把答案送到对方手里",
    "wptl_season_key": "arrival",
    "wptl_series_role": "article",
    "wptl_series_scope": "",
    "wptl_sequence_label": ""
  }
}
```

“同一次请求”只用于减少分两次调用造成的不一致，不代表数据库事务。WordPress
REST 可能已经创建/更新文章，随后才在 taxonomy、meta 或 WPTL after-insert 处理中
失败；draft 状态也不会经过 WPTL 针对 publish/future/private 的全部结构校验。
Publisher 必须保留发布后回读和部分失败恢复，不能把单个 2xx 或同一 payload
描述为原子提交。

Frontmatter 到 REST 的映射：

| Frontmatter | WordPress REST | 说明 |
| --- | --- | --- |
| `series` | `wptl_series: [termId]` | 零或一个 term ID |
| `seriesSeason` | `meta.wptl_season_key` | 先由 `public_id` 映射成内部 key |
| `seriesRole` | `meta.wptl_series_role` | 默认正文可写 `article` 或 canonical empty |
| `seriesScope` | `meta.wptl_series_scope` | 普通正文可留空，由 WPTL 解释 |
| `seriesLabel` | `meta.wptl_sequence_label` | 仅为公开标签 |
| `subtitle` | `meta.wptl_subtitle` | WPTL canonical Subtitle；兼容读取 `secondaryTitle` 与 `secondary_title` |

明确解除 Series 时发送：

```json
{
  "wptl_series": [],
  "meta": {
    "wptl_season_key": "",
    "wptl_series_role": "",
    "wptl_series_scope": "",
    "wptl_sequence_label": ""
  }
}
```

### 9.4 发布后强回读

成功响应后必须重新读取文章和 Series 定义，确认：

- 文章实际只有所选的一个 Series；
- Season key 能反向映射回同一 `public_id`；
- role、scope、label 与预期一致；
- Subtitle 已写入 `wptl_subtitle`。

只有这些**公开且属于 Publisher 所有权**的字段强回读成功后，才能建立或更新
Series placement 的 sync baseline。不得仅凭第一次 POST 返回 2xx 就认定它们已同步。

标准 REST 不能读取 `wptl_sequence_rank` 或 managed schema marker，所以回读无法
证明 WPTL 已成功追加内部篇序。篇序不属于 Publisher baseline；没有语义化 WPTL
健康状态 endpoint 时，记录为“placement 已确认，managed append 未由 Publisher
验证”，不能在 UI 中显示为已验证成功。

## 10. 篇序边界

### 10.1 正常托管 Series

WP Publisher 不写顺序。WP Title Layer 在 REST 保存 taxonomy、Season、role 和
scope 后，按其自身运行时契约尝试把新文章追加到相应 Series、Season 或书籍角色
轨道末尾。

当前 WPTL 的 append 在 REST after-insert 阶段执行；内部失败只触发 WPTL action，
不会自动改写核心 REST 响应。Publisher 因此只能验证公开 placement，不能把内部
rank 声明为已验证。若将来确实需要自动证明篇序健康，应由 WPTL 提供只读布尔状态
（例如 `sequenceManaged`、`rankAssigned`），仍不得暴露或允许写入实际 rank。

需要插入或移动文章时，作者使用 WordPress 中的 Sequence & Structure Manager。
持久化 frontmatter 不适合表达“放在某篇之前/之后”这种会随远端结构变化的动作。

### 10.2 未初始化的旧 ordered Series

标准 REST 不公开 managed schema marker。因此 Publisher 不猜测下一个 legacy
position，也不在常规 frontmatter 中加入 `seriesPosition`。

若 WordPress 返回：

```text
wptl_missing_sequence_position
```

应转换成可操作提示：

> 该旧有序 Series 尚未由 Sequence Manager 初始化。请先在 WordPress 的
> WP Title Layer → Sequence & Structure 中初始化篇序，然后重新发布。

不得为了绕过错误而自动写 `wptl_sequence_position`。

### 10.3 永不外部写入的字段

- `wptl_sequence_rank`
- `wptl_sequence_source_position`
- `wptl_sequence_schema_version`
- `wptl_sequence_revisions`
- `wptl_season_public_id_highwater`
- `wptl_book_structure_version`

也不得通过文章发布修改 Series definition metadata，包括 `wptl_seasons`。

## 11. Category 边界

Series 的父 Category 是编辑组织信息，并不使 Series 成为 Category 的子分类。

- 现有 `categories` frontmatter 继续独立发布。
- 不增加 `seriesCategory`。
- Publisher 可以把“文章 Category 不在 Series 父 Category 分支中”显示为预检警告。
- 警告不阻止发布，除非未来 WP Title Layer 明确升级为强约束。
- Publisher 不自动添加、删除或替换文章 Category 来迎合 Series 设置。

## 12. Secondary Title 相邻兼容任务

该任务与 Series 集成相邻，但应作为独立变更和测试组追踪。

现状：WP Publisher Companion 的 `secondaryTitle` 仍写入旧字段
`_secondary_title`。WP Title Layer 只在 canonical `wptl_subtitle` 从未存在时读取
旧字段；canonical 字段即使明确为空也具有优先权。

目标行为：

- Frontmatter 首选名称改为 `subtitle`；继续兼容读取 `secondaryTitle` 与
  `secondary_title`，且不自动删除已有兼容属性。
- 检测到 WP Title Layer canonical meta 时，通过文章核心 REST 写入
  `meta.wptl_subtitle`。
- 只有仍使用旧 Secondary Title 插件、且没有 WP Title Layer canonical 能力的
  站点，才继续通过 Companion 写 `_secondary_title`。
- Pull、Diff、Merge 和 baseline 必须使用与写入相同的 owner，不能同时把两个
  WordPress meta 当作可写真源。
- 明确清空 `subtitle` 时写 canonical empty，防止旧值重新浮现。

能力判定必须来自目标 post type 的核心 REST schema 是否公开
`meta.wptl_subtitle`，或来自未来明确的 `wpTitleLayer` capability。Companion 当前的
`secondaryTitle: true` 不能用于判定：它以 `get_secondary_title()` 是否存在为依据，
而 WPTL 的兼容 API 也定义该函数，会把 WPTL 误认成旧 Secondary Title 插件。
检测优先级应为：WPTL canonical meta → legacy Companion fallback → unsupported。

## 13. 传输与降级矩阵

| 连接类型 | Series 第一版 | 要求 |
| --- | --- | --- |
| REST API with Application Password | 支持 | 主实现和完整验收目标 |
| miniOrange REST | 条件支持 | 复用 REST 实现，但必须单独完成认证与写入测试 |
| XML-RPC | 暂不支持 | 发现非空/显式空 Series 属性时，在任何文章写入前报错 |
| WordPress.com legacy profile | 不支持 | 延续当前产品边界，不新增声明 |

降级规则：

- 笔记没有 `series` 属性时，即使 WP Title Layer 不存在，也不得影响普通发布。
- 笔记有 `series` 属性而目标站点没有 WPTL taxonomy/meta 能力时，必须在写入文章
  前失败，不能“文章成功但悄悄丢掉 Series”。
- 如果一个多站点发布目标不支持 Series，其他站点不得复用其 term ID 或解析结果；
  每个站点分别预检、分别报告。
- UI 和文档只能声明实际经过测试的传输；未测必须标为未测或暂不支持。

## 14. 错误、部分失败与恢复

### 14.1 必须在写文章前发现

- `series` 类型错误或为空但带有其他非空 Series 属性。
- Series slug 不存在。
- Series 查询结果不唯一。
- 平铺 Series 带 `seriesSeason`。
- 分季正文缺少 `seriesSeason`。
- Season `public_id` 不存在或不唯一。
- role/scope 枚举非法。
- scope 与 Season 的组合矛盾。
- 目标连接不支持 Series。
- 当前用户无法读取/分配 Series 或编辑文章。

### 14.2 WordPress 权威错误

WP Title Layer 的 REST 校验仍是最终权威。Publisher 至少应识别并转译：

- `wptl_multiple_series`
- `wptl_missing_series_scope`
- `wptl_main_article_series_scope`
- `wptl_missing_season`
- `wptl_undefined_seasons`
- `wptl_invalid_season`
- `wptl_flat_series_season_scope`
- `wptl_missing_sequence_position`
- `wptl_duplicate_sequence_position`

未知 WPTL 错误应保留原 code，并显示经过转义的服务端 message。

### 14.3 部分失败

单次核心 REST 请求只能减少“文章成功、Series 第二次调用失败”，不能提供事务保证。
taxonomy、meta、draft 后续发布校验、WPTL after-insert append、媒体或受保护 SEO 均
可能形成部分成功。遇到部分失败时：

- 明确列出已成功和失败的部分；
- 不建立新的强 sync baseline；
- 不自动回滚或删除已发布文章；
- 重试时遵守现有发布历史和幂等目标，不重复创建文章；
- 不因 Series 失败而改写本地 frontmatter 为猜测状态。

如果回读发现文章主体已创建/更新，但公开 Series placement 不完整：

- 保留已知 post ID，防止重试重复创建；
- 把本次结果标为部分失败而非完整成功；
- 显示远端实际状态和建议重试动作；
- 不自动执行反向写入或删除文章；
- draft 在转为 publish/future/private 前必须重新执行完整结构预检。

## 15. Publish、Inspect、Pull 与 Merge

Series 不能只出现在发布弹窗。完整发布版本至少应覆盖：

1. **Publish preview**：显示 Series 名称、slug、Season label/ID、role、scope、label。
2. **Remote Inspector**：显示远端 canonical Series placement 和公开可证实的能力状态；不得把私有 managed/book marker 猜成已启用。
3. **Pull**：将远端 term ID 转回 slug，将内部 Season key 转回 `public_id`。
4. **Diff**：把整个 Series placement 作为原子字段组比较。
5. **Three-way merge**：本地、baseline、远端分别比较完整结构；不产生非法混合组合。
6. **Writeback**：只更新经过确认的 canonical Series 属性，保留无关 frontmatter。
7. **Baseline**：保存规范化后的可移植值，不保存站点 term ID 或内部 rank。

本地 missing 的 Series 字段组在 Diff/Merge 中保持“unowned”，不等于远端空值；
只有确认 Pull 或本地显式出现 `series` 键后才进入双方比较。

如果首个开发迭代只完成 push，必须在版本说明和 UI 中明确标注
“Pull/Sync 尚不包含 Series”，并且不得把该版本描述为完整往返支持。

## 16. 推荐实现入口

WP Publisher 当前代码中的主要落点：

- Frontmatter 解析与安全回写：[src/front-matter.ts](../src/front-matter.ts)
- 传输无关发布模型：[src/wp-client.ts](../src/wp-client.ts)
- REST term 查询与文章请求：[src/wp-rest-client.ts](../src/wp-rest-client.ts)
- 发布字段策略：[src/publish-strategy.ts](../src/publish-strategy.ts)
- 远端规范化与能力：[src/remote-post.ts](../src/remote-post.ts)
- 字段差异：[src/sync-diff.ts](../src/sync-diff.ts)
- 三方合并：[src/three-way-merge.ts](../src/three-way-merge.ts)
- 发布与同步 UI：[src/wp-publish-modal.ts](../src/wp-publish-modal.ts)、[src/wp-sync-modal.ts](../src/wp-sync-modal.ts)
- 英文与简体中文文案：[src/i18n/en.json](../src/i18n/en.json)、[src/i18n/zh-cn.json](../src/i18n/zh-cn.json)

建议新建一个传输无关的 `src/series.ts`，集中负责：

- frontmatter 类型规范化；
- 合法组合校验；
- Series/Season portable model；
- REST model 与 portable model 的映射；
- 原子 equality/diff；
- 用户可操作错误的统一 code。

不要让发布弹窗、REST client 和同步代码各自复制一套 Series 判断。

## 17. 分阶段开发建议

### 阶段 A：数据契约与 REST 写入

- 增加五个 frontmatter 属性及类型。
- 完成 Series slug 查询、Season `public_id` 映射和发布前校验。
- 第一切片只承诺普通 `article` placement；高级 role/scope 等待可验证的
  `bookStructureEnabled` 语义能力。
- 在同一文章 REST payload 中写 taxonomy 与 canonical meta。
- 处理明确解除 Series。
- 禁止外部篇序字段。
- 将 WPTL 站点的 `subtitle` 写入 `wptl_subtitle`。

### 阶段 B：发布 UI 与强回读

- 发布弹窗支持可搜索 Series 和依 Series 联动的 Season。
- 普通字段默认简洁显示；只有目标明确报告书籍式结构已启用时，才显示高级
  role/scope；`seriesLabel` 可作为独立高级显示项。
- 发布预览显示最终可移植值及目标站点解析结果。
- 发布后强回读公开 placement；失败不建立 baseline；篇序 append 明确标为不可验证。

### 阶段 C：完整同步闭环

- Remote Inspector、Pull、Diff、Merge、Writeback、baseline 全面覆盖。
- Series placement 使用原子冲突解决。
- baseline 保留 missing/unowned 与 explicit empty 的区别。
- 多站点分别解析并报告差异。

### 阶段 D：发布与兼容验证

- 补齐 Application Password REST 和 miniOrange 实站测试。
- XML-RPC 保持明确的前置阻止，直至另立规格实现。
- 更新 README、feature map、release checklist 和中英文文案。
- 通过现有确定性构建、打包和安装测试后，再进入人工验收。

## 18. 自动化验收清单

### 18.1 Frontmatter

- [ ] `series` 单值 slug 正常读取和回写。
- [ ] 属性不存在、null、empty string 三种状态可区分。
- [ ] `seriesSeason` 同时兼容读取 number 和 numeric string，canonical 回写为整数。
- [ ] 非法数组、对象、布尔值和枚举在写入前失败。
- [ ] 默认 `article` 不需要冗余写回。
- [ ] 无关 frontmatter 和 Obsidian `tags` 不受影响。

### 18.2 组合与映射

- [ ] 平铺正文、分季正文均生成正确 payload。
- [ ] Season 级和 Series 级非正文只有在可验证的
  `bookStructureEnabled` capability 下才生成 payload；否则在写入前失败。
- [ ] 所有非法 role/scope/Season 组合均被拒绝，且没有文章写入。
- [ ] Season label 改名、sort 重排后，同一 `public_id` 仍映射到同一 key。
- [ ] 旧 Season 缺少 `public_id` 时提示到 Series 编辑页保存或初始化，不回退到 label/key。
- [ ] 不同 profile 中相同 slug、不同 term ID 分别解析。
- [ ] 多站点中同一 `public_id` 解析到不同 Season 时要求逐站点复核或中止。
- [ ] 目标 post type 未注册 `wptl_series` 时在写文章前失败。
- [ ] 仅有 assign、无法读取编辑态 term meta 的凭据得到明确权限提示。
- [ ] Series 或 Season 不存在时不自动创建。

### 18.3 更新语义

- [ ] 更新文章且 `series` 缺失时保留远端 Series placement。
- [ ] 显式空 `series` 时清除 taxonomy 关系和依赖 meta。
- [ ] Content-only update 永不修改 Series。
- [ ] 更换 Series 时不泄漏旧 Season key、role、scope 或 label。
- [ ] 原子 merge 不会把本地 Series 与远端 Season 拼成非法组合。
- [ ] missing/unowned 不会被 diff 或 baseline 误判成显式删除。
- [ ] 确认 Pull 写入 `series` 后才建立本地字段组所有权。

### 18.4 篇序

- [ ] Publisher payload 不含 rank、schema marker 或 sequence revision。
- [ ] 没有语义化 WPTL 状态 endpoint 时，Publisher 不声称已验证 managed append。
- [ ] 若未来增加 `rankAssigned` 只读状态，只验证布尔结果，不读取或缓存实际 rank。
- [ ] `wptl_missing_sequence_position` 转换为 Sequence Manager 初始化提示。
- [ ] 代码和测试 fixture 中不存在对私有 rank/schema/revision 字段的写入。
- [ ] 特殊 `seriesLabel` 不影响实际排序。

### 18.5 Subtitle

- [ ] WPTL 站点把 `subtitle` 写入 `wptl_subtitle`。
- [ ] 明确空 Subtitle 能覆盖旧 `_secondary_title`，旧值不会重新显示。
- [ ] 只有旧 Secondary Title 插件继续使用 Companion legacy endpoint。
- [ ] Companion 的 `secondaryTitle: true` 不会覆盖核心 REST schema 的 WPTL 判定。
- [ ] Pull、Diff、Merge 不同时暴露两个 Subtitle owner。

### 18.6 传输与失败

- [ ] Application Password REST 完成 create、update、clear、readback。
- [ ] miniOrange 只有在单独验证后才标记支持。
- [ ] XML-RPC 遇到 Series placement 时在文章写入前失败。
- [ ] WPTL 缺失但笔记没有 `series` 时普通发布不受影响。
- [ ] WPTL 缺失但笔记有 `series` 时不会静默丢字段。
- [ ] 核心 REST 部分落盘时保留 post ID、显示远端实际状态且不重复创建。
- [ ] 公开 placement 强回读失败或 follow-up 部分失败时不建立 Series baseline。
- [ ] draft 转 publish/future/private 前重新执行完整结构预检。

## 19. NAS 人工验收清单

在测试 WordPress 中创建专用临时 Series 和文章，不在正式站点构造破坏性场景。

- [ ] 选择一个平铺无序 Series，新建文章并检查后台与前台。
- [ ] 选择一个已托管的平铺有序 Series，确认文章追加到末尾。
- [ ] 选择一个分季有序 Series，确认 Season、题头、Archive 和导航一致。
- [ ] 发布 Season 级 intro/epilogue/appendix，检查结构轨道。
- [ ] 发布 Series 级 intro/epilogue/appendix，检查其不属于具体 Season。
- [ ] 使用 `seriesLabel: "0-2"`，确认显示变化但篇序未被改写。
- [ ] 从 Series A 改到 Series B，确认旧 Season/role/scope 不残留。
- [ ] 显式解除 Series，确认前台题头与导航消失，文章内容和 Category 保留。
- [ ] Season 改名后从同一 Obsidian 属性重发，确认仍指向原 Season。
- [ ] 在 Sequence Manager 中移动文章后再次 content-only publish，确认顺序不回退。
- [ ] 用未初始化旧 ordered Series 验证可操作错误提示。
- [ ] 停用 WPTL 后验证：无 Series 笔记可发布，有 Series 笔记在写入前被阻止。
- [ ] 检查浏览器控制台、WordPress debug log、Obsidian console 无新增错误。
- [ ] 执行 Inspect、Pull、Diff、Merge，并确认 frontmatter 往返稳定。
- [ ] 在至少两个 profile 上验证相同 slug 的站点内独立解析。

其中“确认文章追加到末尾”属于 WordPress/WPTL 人工验收证据，不能由 Publisher
对公开 REST 字段的回读替代。

无法安全完成的项目必须记录为“未测”，不能用自动化结果替代实际 UI 验收。

## 20. 完成定义

只有同时满足以下条件，才能把 WP Title Layer Series 集成描述为“完整可用”：

1. 数据契约、REST 写入、公开 placement 强回读和清空语义通过自动化测试。
2. Publish、Inspect、Pull、Diff、Merge、Writeback 和 baseline 形成闭环。
3. 不自动创建 Series/Season，不写任何私有篇序字段。
4. 至少 Application Password REST 通过安装包上的 NAS 人工验收。
5. Unsupported transport 在文章写入前明确阻止，不静默降级。
6. WPTL canonical Subtitle 与 legacy Secondary Title fallback 分工明确。
7. 高级 role/scope 只有在 `bookStructureEnabled` 可验证时才被声明支持。
8. Publisher 不把 placement 回读冒充 managed append 验证。
9. `npm run check`、发布检查、确定性包校验和 Companion PHP 检查全部通过。
10. 文档只声明已经验证的连接类型和行为。

## 21. 对接代码依据

WP Title Layer 当前契约的主要代码位置：

- Canonical taxonomy 与 metadata：
  `wp-title-layer/includes/Core/Schema.php`（WP Title Layer 源码仓库）
- REST 可见 metadata 与私有字段边界：
  `wp-title-layer/includes/Core/Meta.php`
- Series taxonomy、单一 Series 与 REST 发布校验：
  `wp-title-layer/includes/Core/Series.php`
- role/scope 解释：
  `wp-title-layer/includes/Core/BookStructure.php`
- 托管篇序追加：
  `wp-title-layer/includes/Core/SequenceRuntime.php`
  与 `wp-title-layer/includes/Core/Sequence.php`
- Canonical Subtitle 与 legacy fallback：
  `wp-title-layer/includes/Presentation/Renderer.php`

实现前应重新核对目标 WP Title Layer 版本；如果这些契约发生变化，应优先更新本
规格和兼容测试，而不是在 WP Publisher 中加入静默猜测。
