# WP Publisher

WP Publisher turns an Obsidian note into a reviewed WordPress publishing target.
It publishes native Gutenberg blocks by default and supports explicit,
loss-aware synchronization back to Obsidian.

For a concise overview, installation steps, front matter examples, privacy
disclosures, and development commands, start with the
[project README](https://github.com/irisable/wp-publisher-for-obsidian#english)
or [Chinese guide](https://github.com/irisable/wp-publisher-for-obsidian/blob/main/README.zh-CN.md).
The [feature map](feature-map.md) is the
canonical implementation and acceptance reference.

## Configure A WordPress Profile

Open **Settings > WP Publisher > Profiles** and create a profile.
Each profile has its own endpoint, authentication method, remembered taxonomy,
media cache, and optional publishing defaults.

### Application Password REST

This is the recommended connection for self-hosted WordPress 5.6 or newer.

1. Sign in to WordPress and open **Users > Profile**.
2. Find **Application Passwords**.
3. Create a password specifically for WP Publisher.
4. Copy it immediately and use it with your WordPress username in the profile.
5. Set the profile API type to **REST API Authentication by application passwords**.

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

WordPress.com is not a supported connection type in the current release and is not offered when
creating a profile. Existing profiles that already contain a saved token remain
readable for migration compatibility, but this release cannot authorize,
validate, or refresh that token.

## Publishing Precedence

The form starts from note properties and account defaults. Selecting a template
sets status, comment status, post type, and tags. A linked post type and explicit
WordPress tags in the note take precedence over the template. Review the form
before publishing. The default-options command uses note, profile, and global
defaults without opening the form.

An explicit existing target retains its linked post type. A content-only update
sends only the body and leaves title, taxonomy, status, and editorial metadata
unchanged.

## Gutenberg And Classic HTML

The default Block Editor mode serializes paragraphs, headings, lists, images,
standalone MP3 embeds, quotes, code, tables, and separators as native WordPress blocks. Mermaid stays
in an inert code block. Content that cannot be represented safely is isolated
in a Custom HTML block rather than silently changed.

Classic HTML remains available under **Content format** for compatibility with
older sites or workflows.

## Categories And Tags

Categories are selected in a searchable hierarchy. The note stores portable
category slugs; WordPress IDs are resolved only for the selected profile during
publish. Use `wpTags` for WordPress tag names, including names with spaces.
Legacy notes without `wpTags` can use the `tags` property as a fallback. Tags
can also come from templates or profile defaults and are created as needed.

## Media

Local images and MP3 files embedded in Markdown are uploaded before the post. A
per-profile SHA-256 cache reuses unchanged files, verifies that the WordPress
attachment still exists, and recovers from stale attachment IDs.

Featured images can be a WordPress attachment ID or a Vault image reference.
Attachment title, Alt Text, caption, and description can be supplied through an
adjacent `wp-media` comment. Audio uses `title`, `caption`, and `description`.
See the [image and MP3 examples](https://github.com/irisable/wp-publisher-for-obsidian#media-metadata).

## Subtitles And Series

[Irisable Title Layer](https://wordpress.org/plugins/irisable-title-layer/)
provides subtitles and Series over REST. WP Publisher 1.2.0 supports content
groups and advanced roles on supported Series. Set `subtitle`, `series`, and
the applicable Season, role, scope, and group properties in the note, or review
their values in the publish form. WordPress manages Series definitions and order.

## Synchronization Safety

Remote actions are explicit:

- **Inspect linked WordPress post** reads and normalizes the remote post.
- **Pull changes from WordPress** previews selectable field changes.
- **Sync with WordPress** classifies the note and offers safe actions.
- **Resolve WordPress sync conflict** performs a reviewed three-way merge.
- **Undo last WordPress pull** restores the guarded pre-pull note revision.

Audio, unknown Gutenberg blocks, and structurally lossy HTML are stored in
protected source regions. A later publish rejects damaged regions.

## Companion Plugin

The optional [WP Publisher Companion](https://github.com/irisable/wp-publisher-for-obsidian/tree/main/wordpress-companion)
allows authenticated access to protected Rank Math and legacy Secondary Title
fields, as well as attachment metadata over XML-RPC. Download its separate
[Companion ZIP](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest/download/wp-publisher-companion.zip)
and install it through **Plugins > Add New > Upload Plugin** in WordPress.

## Troubleshooting

### The plugin is visible but cannot be enabled

Confirm that the folder contains the matching `main.js`, `manifest.json`, and
`styles.css`, then reload Obsidian. Disable the legacy `obsidian-wordpress`
plugin as well so duplicate commands cannot target the wrong publishing setup.

### Rank Math or legacy Secondary Title fields are unavailable

Install and activate WP Publisher Companion, then reopen or validate the
profile. The corresponding WordPress plugin must also be active. For Irisable
Title Layer subtitles or Series, check the REST profile and the post type's
capabilities.

### A cached image returns 404

WP Publisher verifies cached attachment IDs. If the WordPress media item was
deleted, the stale cache entry is discarded and the local image is uploaded
again.

### A remote block is preserved instead of converted

This is intentional when Markdown cannot represent the source without loss.
The protected source can round-trip back to WordPress and remains inert in
Obsidian.
