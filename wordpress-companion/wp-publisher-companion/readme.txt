=== WP Publisher Companion ===
Contributors: wp-publisher-for-obsidian
Tags: obsidian, xml-rpc, rank-math, secondary-title
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 0.4.0
License: Apache-2.0

Allows WP Publisher for Obsidian to read or update a small whitelist of SEO, subtitle, and attachment metadata through authenticated REST and XML-RPC calls.

== Installation ==

1. In WordPress, open Plugins > Add New > Upload Plugin.
2. Upload wp-publisher-companion.zip and activate it.
3. Keep Rank Math active if you want to publish Focus Keyword and SEO Description.
4. Keep Secondary Title active if you want to synchronize the `secondaryTitle` property.

The companion uses the same WordPress credentials already configured in Obsidian. Every REST and XML-RPC route checks authentication and edit permissions; no public unauthenticated metadata endpoint is exposed.

== Changelog ==

= 0.4.0 =
* Adds authenticated Secondary Title reads, writes, and capability detection.

= 0.3.0 =
* Adds authenticated Rank Math SEO reads for explicit bidirectional sync.
* Adds authenticated REST capability and SEO routes for application-password profiles.

= 0.2.0 =
* Adds allowlisted SEO and attachment metadata updates.
