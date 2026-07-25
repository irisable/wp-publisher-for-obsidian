# WP Publisher for Obsidian

Publish and explicitly synchronize Obsidian notes with WordPress while keeping
Markdown, front matter, media, and WordPress-native editing under your control.

This project is an independently maintained fork of
[`devbean/obsidian-wordpress`](https://github.com/devbean/obsidian-wordpress).
It has expanded from one-way publishing into a guarded editorial workflow with
Gutenberg output, media deduplication, preview, multi-site publishing, and
reviewed WordPress-to-Obsidian synchronization.

> **Release status:** The P0-P3 feature set is complete and has passed local and
> staged real-site testing. The project is currently preparing its first public
> fork release. Application Password REST and XML-RPC remain separate final
> compatibility gates.

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
[`docs/feature-map.md`](docs/feature-map.md).

## Installation

### Pre-release or manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the same GitHub
   release.
2. Place all three files in one folder under
   `<Vault>/.obsidian/plugins/`.
3. Reload Obsidian, open **Settings > Community plugins**, and enable
   **WP Publisher for Obsidian**.

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

Create a profile in **Settings > WP Publisher for Obsidian > Profiles**.
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
tags:
  - obsidian
  - wordpress
status: draft
commentStatus: open
---
```

Compatibility aliases remain readable for `focus_keyword`,
`meta_description`, `secondary_title`, and `comment_status`.

After a successful publish, the plugin may maintain these relationship and
activity properties:

- `wpProfile`
- `wpPostId`
- `wpPostType`
- `wpLastPublishedAt`
- `wpLastPublishAction`

Write-back is non-destructive: unrelated properties are preserved, while
categories remain human-readable slugs rather than WordPress IDs.

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

Install [`WP Publisher Companion`](wordpress-companion/README.md) on
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
npm run version:set -- 1.0.0  # synchronize release version files
npm run dev            # watch build for local Obsidian testing
```

See [`CHANGELOG.md`](CHANGELOG.md) for release notes and
[`docs/feature-map.md`](docs/feature-map.md) for the canonical feature map.
Release maintainers should complete the
[`docs/release-checklist.md`](docs/release-checklist.md).
Tagged builds are packaged as draft GitHub releases so the assets can be
inspected before publication.

## License And Credits

Licensed under the [Apache License 2.0](LICENSE). Historical upstream changelog
entries and authorship are retained in recognition of the original
`devbean/obsidian-wordpress` project.
