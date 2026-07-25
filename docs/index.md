# WP Publisher for Obsidian

WP Publisher turns an Obsidian note into a reviewed WordPress publishing target.
It publishes native Gutenberg blocks by default and supports explicit,
loss-aware synchronization back to Obsidian.

For a concise overview, installation steps, front matter examples, privacy
disclosures, and development commands, start with the
[project README](../README.md). The [feature map](feature-map.md) is the
canonical implementation and acceptance reference.

## Configure A WordPress Profile

Open **Settings > WP Publisher for Obsidian > Profiles** and create a profile.
Each profile has its own endpoint, authentication method, remembered taxonomy,
media cache, and optional publishing defaults.

### Application Password REST

This is the recommended connection for self-hosted WordPress 5.6 or newer.

1. Sign in to WordPress and open **Users > Profile**.
2. Find **Application Passwords**.
3. Create a password specifically for WP Publisher.
4. Copy it immediately and use it with your WordPress username in the profile.
5. Set the profile API type to **REST API with Application Password**.

Application Passwords are revocable and avoid storing your main WordPress
password.

### XML-RPC

Choose XML-RPC only when the site exposes `xmlrpc.php`. Some hosts and security
plugins disable XML-RPC. The default path is `/xmlrpc.php`, but it can be
changed per profile.

### miniOrange REST

The miniOrange REST authentication option is retained for compatible existing
sites. Configure the WordPress plugin for Basic Authentication with username
and password, then select the matching profile type in Obsidian.

### WordPress.com

WordPress.com is not a supported connection type in 1.0 and is not offered when
creating a profile. Existing profiles that already contain a saved token remain
readable for migration compatibility, but this release cannot authorize,
validate, or refresh that token.

## Publishing Precedence

For ordinary publishing, values are resolved in this order:

1. The choices reviewed in the current publish dialog.
2. Explicit note properties.
3. A selected publishing template.
4. Per-profile defaults.
5. Global plugin defaults.

An explicit existing target retains its linked post type. A content-only update
sends only the body and leaves title, taxonomy, status, and editorial metadata
unchanged.

## Gutenberg And Classic HTML

The default Block Editor mode serializes paragraphs, headings, lists, images,
quotes, code, tables, and separators as native WordPress blocks. Mermaid stays
in an inert code block. Content that cannot be represented safely is isolated
in a Custom HTML block rather than silently changed.

Classic HTML remains available under **Content format** for compatibility with
older sites or workflows.

## Categories And Tags

Categories are selected in a searchable hierarchy. The note stores portable
category slugs; WordPress IDs are resolved only for the selected profile during
publish. Tags are normalized from note properties, templates, or profile
defaults and are created when necessary.

## Media

Local Markdown images and Obsidian embeds are uploaded before the post. A
per-profile SHA-256 cache reuses unchanged files, verifies that the WordPress
attachment still exists, and recovers from stale attachment IDs.

Featured images can be a WordPress attachment ID or a Vault image reference.
Attachment title, Alt Text, caption, and description can be supplied through an
adjacent `wp-media` comment as documented in the [README](../README.md).

## Synchronization Safety

Remote actions are explicit:

- **Inspect linked WordPress post** reads and normalizes the remote post.
- **Pull changes from WordPress** previews selectable field changes.
- **Sync with WordPress** classifies the note and offers safe actions.
- **Resolve WordPress sync conflict** performs a reviewed three-way merge.
- **Undo last WordPress pull** restores the guarded pre-pull note revision.

Unknown Gutenberg blocks and structurally lossy HTML are stored in protected
source regions. Damaged protected regions are rejected during a later publish
instead of being dropped.

## Companion Plugin

The optional [WP Publisher Companion](../wordpress-companion/README.md) exposes
a strict authenticated allowlist for Rank Math, Secondary Title, and XML-RPC
attachment metadata. Upload its ZIP through **Plugins > Add New > Upload
Plugin** in WordPress.

## Troubleshooting

### The plugin is visible but cannot be enabled

Confirm that the folder contains the matching `main.js`, `manifest.json`, and
`styles.css`, then reload Obsidian. Disable the legacy `obsidian-wordpress`
plugin as well so duplicate commands cannot target the wrong publishing setup.

### Rank Math or Secondary Title fields are unavailable

Install and activate WP Publisher Companion, then reopen or validate the
profile. The corresponding WordPress plugin must also be active.

### A cached image returns 404

WP Publisher verifies cached attachment IDs. If the WordPress media item was
deleted, the stale cache entry is discarded and the local image is uploaded
again.

### A remote block is preserved instead of converted

This is intentional when Markdown cannot represent the source without loss.
The protected source can round-trip back to WordPress and remains inert in
Obsidian.
