# WP Publisher Companion

WordPress protects Rank Math and Secondary Title metadata from generic API access. This companion adds authenticated REST and XML-RPC methods for WP Publisher:

- `wpPublisher.getCapabilities`
- `wpPublisher.getSeoMeta`
- `wpPublisher.updateSeoMeta`
- `wpPublisher.getSecondaryTitle`
- `wpPublisher.updateSecondaryTitle`
- `wpPublisher.updateMediaMetadata`
- `GET /wp-json/wp-publisher/v1/capabilities`
- `GET/POST /wp-json/wp-publisher/v1/posts/{id}/seo`
- `GET/POST /wp-json/wp-publisher/v1/posts/{id}/secondary-title`

Only the two Rank Math keys, `_secondary_title`, and the attachment title, alt text, caption, and description are exposed. Every post route requires WordPress authentication and an `edit_post` capability check.

## Install

Upload `wp-publisher-companion.zip` from WordPress **Plugins > Add New > Upload Plugin**, then activate it. Version 0.4.0 or newer is required for Secondary Title synchronization; WP Publisher detects both the companion and the Secondary Title plugin automatically.
