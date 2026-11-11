# WP Publisher Companion

WordPress protects Rank Math and legacy Secondary Title metadata from generic API access. This companion adds authenticated REST and XML-RPC methods for WP Publisher:

- `wpPublisher.getCapabilities`
- `wpPublisher.getSeoMeta`
- `wpPublisher.updateSeoMeta`
- `wpPublisher.getSecondaryTitle`
- `wpPublisher.updateSecondaryTitle`
- `wpPublisher.updateMediaMetadata`
- `GET /wp-json/wp-publisher/v1/capabilities`
- `GET/POST /wp-json/wp-publisher/v1/posts/{id}/seo`
- `GET/POST /wp-json/wp-publisher/v1/posts/{id}/secondary-title`

Only the two Rank Math keys, legacy `_secondary_title`, and the attachment title, alt text, caption, and description are exposed. Every post route requires WordPress authentication and an `edit_post` capability check.

Version 0.5.0 distinguishes WP Title Layer from the legacy Secondary Title plugin. When WP Title Layer is active, the companion reports `subtitleProvider: wp-title-layer` and disables its legacy subtitle route; WP Publisher then uses the post type's core REST `wptl_subtitle` field as the only writable source. It does not dual-write both subtitle fields.

The companion does not bypass Wordfence. If Wordfence disables WordPress Application Passwords, authenticated REST requests will fail until the site owner either permits Application Passwords or explicitly configures a different supported transport in a future Publisher release.

## Install

Companion is an optional **WordPress-side plugin**, not an Obsidian plugin. Installing or updating WP Publisher in Obsidian does not install or update Companion on your site. It is currently distributed through GitHub Releases, not the WordPress.org plugin directory.

### When you need it

- Install it for Publisher's protected Rank Math focus keyword and meta description fields, legacy Secondary Title access, or attachment title/alt/caption/description updates over XML-RPC. Rank Math itself must also be active for its SEO fields.
- Ordinary post publishing does not require it.
- Irisable Title Layer (formerly WP Title Layer) subtitles and Series use the post type's core REST fields. Install Title Layer itself for those features; Companion is not required and does not add Series support to XML-RPC.

### Download and activate

1. Open the [latest Publisher release](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest) and download **`wp-publisher-companion.zip`** under **Assets** ([direct download](https://github.com/irisable/wp-publisher-for-obsidian/releases/latest/download/wp-publisher-companion.zip)). Do not use the Publisher ZIP or GitHub's source-code archives.
2. Sign in to the target WordPress dashboard with permission to install plugins. Choose **Plugins → Add New Plugin → Upload Plugin**, select the ZIP, and choose **Install Now → Activate Plugin**. If you lack permission, ask the site administrator.
3. Return to WP Publisher and test the site's connection again. For multiple sites, install Companion separately on each site that needs these features.

Version 0.5.0 is recommended for correct Title Layer detection; WP Publisher continues to support older companions for legacy Secondary Title sites. Authentication and security-plugin restrictions still apply.

### Updates

Download the Companion ZIP from a newer Publisher release and upload it through the same WordPress screen, confirming replacement when prompted. Updating only the Obsidian plugin does not update this WordPress component. For installation instructions in Chinese, see the [Publisher Chinese guide](../README.zh-CN.md#可选-wordpress-companion).
