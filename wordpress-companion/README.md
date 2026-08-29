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

Upload `wp-publisher-companion.zip` from WordPress **Plugins > Add New > Upload Plugin**, then activate it. Version 0.5.0 is recommended for correct WP Title Layer detection; WP Publisher continues to support older companions for legacy Secondary Title sites.
