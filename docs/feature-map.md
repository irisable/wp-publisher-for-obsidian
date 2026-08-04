# Feature Map

This document is the canonical map of current user-facing behavior, major code entry points, completed roadmap work, and work that is still only a candidate. Detailed P0-P3 task cards are retained as implementation and acceptance history; the sections before them describe the product as it exists now.

## Current Product Status

* P0, P1, P2, and P3 are completed.
* P3-1 through P3-7 passed staged real-site acceptance on 2026-07-21.
* The current automated baseline is 204 passing tests plus lint, TypeScript validation, and a production build.
* There is no formal P4 roadmap or unfinished development task card.
* The supported-transport release matrix remains a separate compatibility gate, not an open P3 feature.

## Entry Layer

Plugin startup, command registration, ribbon handling, settings migration, and note-rename reconciliation are in [src/main.ts](../src/main.ts).

Registered commands:

* `defaultPublish`: publish the current note immediately with the default profile and resolved defaults.
* `publish`: open the standard publish flow for the current note.
* `publishMultiSite`: publish one frozen note revision to several explicitly selected profiles.
* `publishBatch`: publish an explicitly selected set of notes through a single-worker queue.
* `publishHistory`: inspect and search the bounded local activity history.
* `remoteInspector`: fetch and inspect the linked WordPress post without writing either side.
* `syncWithWordPress`: classify the current note and offer only the safe push, pull, or merge action.
* `pullChangesFromWordPress`: preview and selectively apply remote changes to the current note.
* `resolveWordPressSyncConflict`: review and resolve a diverged note with a three-way merge.
* `undoLastWordPressPull`: restore the guarded pre-pull note revision when the current file is still eligible.
* `clearSyncBaselines`: remove the bounded agreement cache after confirmation without unlinking posts.

The settings tab is registered here; its UI lives in [src/settings.ts](../src/settings.ts).

## Settings And Local State

Settings structures, defaults, and migration are defined in [src/plugin-settings.ts](../src/plugin-settings.ts).

User-facing settings cover:

* WordPress profile and publishing-template management
* Sidebar ribbon visibility
* Global post-status and comment-status defaults
* Remembered categories and the optional post-publish edit prompt
* Block Editor output or traditional HTML compatibility mode
* MathJax output, Obsidian comment conversion, and raw HTML parsing
* Optional replacement of local media links after upload

Plugin-local state also contains bounded publishing templates, activity history, per-note multi-site targets, guarded pull restore snapshots, and synchronization baselines. These stores exclude post bodies where they are not required, never retain arbitrary remote responses, and keep authentication data confined to profile-specific credential fields.

## Profiles And Authentication

Profile data is defined in [src/wp-profile.ts](../src/wp-profile.ts), while client selection is handled in [src/wp-clients.ts](../src/wp-clients.ts).

Supported connection types:

* XML-RPC
* REST API with miniOrange authentication
* REST API with Application Passwords

WordPress.com is excluded from 1.0 support and cannot be selected for a new profile. Existing saved-token profiles remain readable as legacy migration data and may continue through the retained REST context, but the plugin contains no client ID, secret, authorization callback, validation, or token-refresh flow.

Each profile has a stable local ID that survives renames. Profiles can keep their own status, comment, post-type, and tag defaults; remembered category IDs; SHA-256 media cache; and an optional Vault folder for explicitly downloaded remote media.

Profile editing, authentication, and defaults live mainly in:

* [src/wp-profile-manage-modal.ts](../src/wp-profile-manage-modal.ts)
* [src/wp-profile-modal.ts](../src/wp-profile-modal.ts)
* [src/wp-login-modal.ts](../src/wp-login-modal.ts)
* [src/profile-publishing-defaults.ts](../src/profile-publishing-defaults.ts)

## Publishing Pipeline

The shared publish workflow is centered in [src/abstract-wp-client.ts](../src/abstract-wp-client.ts). Explicit source files and frozen note revisions allow the same pipeline to support standard, default, multi-site, batch, retry, and synchronization-driven publishes without following whichever editor happens to be active.

The pipeline coordinates:

* Stable profile and target resolution with explicit create-versus-update behavior
* Front matter, profile defaults, and optional named-template precedence
* Full update, content-only update, and reviewed merge field scopes
* Credential, schedule, post type, taxonomy, editorial metadata, and featured-image validation
* Per-profile media deduplication, attachment metadata updates, and stale-cache recovery
* Native Gutenberg serialization by default, with classic HTML compatibility available
* Transport-specific publish payloads and protected metadata follow-up calls
* Non-destructive note write-back, multi-site target updates, activity history, and strong sync baselines after verified success

## Publish Modal And Preview

The main publish UI is implemented in [src/wp-publish-modal.ts](../src/wp-publish-modal.ts), with local preview in [src/wp-publish-preview-modal.ts](../src/wp-publish-preview-modal.ts).

The modal provides:

* A clear Create or Update target banner and visible submit progress
* Full update or Content only selection for existing posts
* Named publishing templates
* Post status, validated schedule, comment status, and post type
* Slug, Secondary Title, excerpt, and featured image
* Rank Math Focus Keyword and SEO Description when supported
* Tags and hierarchy-aware searchable categories
* A local-only preview of metadata, rendered Markdown, Gutenberg block counts, and Custom HTML fallbacks

## WordPress API And Companion

Shared client interfaces are in [src/wp-client.ts](../src/wp-client.ts). The primary implementations are [src/wp-rest-client.ts](../src/wp-rest-client.ts) and [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts).

The transport-independent model covers posts and pages, status, comments, taxonomy, slug, excerpt, featured media, Focus Keyword, SEO Description, Secondary Title, editable remote source, modification markers, and field-level capabilities.

The optional [WP Publisher Companion](../wordpress-companion/README.md) exposes a strict authenticated allowlist for Rank Math SEO values, Secondary Title, and attachment title, Alt Text, caption, and description. Every route checks authentication and edit capability; unsupported protected metadata remains visible without blocking ordinary content publishing.

## Front Matter Integration

Canonical front matter parsing and write-back are implemented in [src/front-matter.ts](../src/front-matter.ts) and coordinated by [src/abstract-wp-client.ts](../src/abstract-wp-client.ts).

Note-controlled fields:

* `title`, with the note filename as fallback
* `tags` and portable category slugs in `categories`
* `slug`, `excerpt`, and `featuredImage`
* `focusKeyword`, with `focus_keyword` as a read-compatible alias
* `metaDescription`, with `meta_description` as a read-compatible alias
* `secondaryTitle`, with `secondary_title` as a read-compatible alias
* `status` and `commentStatus`, with `comment_status` as a read-compatible alias

Plugin-owned scalar relationship and activity fields:

* `wpProfile`, `wpPostId`, and `wpPostType`
* `wpLastPublishedAt` and `wpLastPublishAction`

Legacy `profileName`, `postId`, and `postType` remain readable and are migrated on successful write-back. Publishing and sync modify only explicitly owned or reviewed fields, preserve unrelated properties, and keep site-specific IDs in bounded plugin-local stores whenever a portable slug or local path is available.

## Media Handling

Media resolution, upload, reuse, metadata, and reference rewriting are centered in [src/media-cache.ts](../src/media-cache.ts), [src/media-metadata.ts](../src/media-metadata.ts), and [src/abstract-wp-client.ts](../src/abstract-wp-client.ts).

Current behavior:

* Standard Markdown images and Obsidian embeds are supported with dimensions preserved where possible.
* A per-profile SHA-256 cache reuses unchanged uploads and verifies cached attachment IDs before reuse.
* Featured images accept a WordPress attachment ID or Vault image reference and share the media cache with body images.
* Markdown image alt text becomes post and attachment Alt Text without becoming a visible caption by default.
* An adjacent `%% wp-media ... %%` block can set attachment title, Alt Text, caption, and description.
* `caption: =alt` explicitly reuses the final Alt Text as the attachment caption and editable figcaption.
* Filename-derived attachment titles remain in the media library but appear in a figcaption only when the author explicitly supplies a title.
* Sync restores safe cached local references, keeps unmatched remote URLs valid, and offers explicit validated downloads into a configured Vault folder.

## Content Conversion And Synchronization

The shared Markdown parser is configured in [src/app-state.ts](../src/app-state.ts) and [src/utils.ts](../src/utils.ts).

Forward publishing uses [src/wordpress-blocks.ts](../src/wordpress-blocks.ts) to serialize common Markdown structures as native core blocks. Paragraphs, headings, lists, images, quotes, code, tables, and separators remain independently editable; Mermaid stays inert in a Code block; structures that cannot be represented safely use an explicit Custom HTML fallback.

Reverse conversion uses [src/wordpress-block-parser.ts](../src/wordpress-block-parser.ts) and [src/wordpress-to-markdown.ts](../src/wordpress-to-markdown.ts). Supported blocks become loss-aware Markdown, while unknown or structurally lossy source is preserved in inert protected regions instead of disappearing silently.

The explicit synchronization workflow combines normalized remote snapshots, field-level diffs, guarded local transactions, bounded restore data, common baselines, six-state classification, and reviewed three-way merge. It supports title, body, slug, excerpt, status, comments, categories, WordPress tag names including spaces through `wpTags`, featured image, Focus Keyword, SEO Description, and Secondary Title without background overwrite. Obsidian `tags` and inline `#tags` remain local-only.

## Documentation

Current documentation and packaging references:

* [README.md](../README.md)
* [docs/index.md](../docs/index.md)
* [CHANGELOG.md](../CHANGELOG.md)
* [Release checklist](release-checklist.md)
* [WP Publisher Companion README](../wordpress-companion/README.md)

## Remaining Candidate Work

These items are not scheduled, are not P3 leftovers, and require separate prioritization before becoming task cards:

* Author selection, sticky-post support, and deliberately allowlisted custom fields or post meta
* A canonical front matter schedule field, Canonical URL, and additional SEO metadata
* Portable category presets for profiles or templates, plus optional editorial and SEO template fields with explicit precedence rules
* Earlier preflight checks for unresolved local media, inconsistent post types, and taxonomy failures
* Per-publish control over local media-link replacement instead of only the global setting

## Intentionally Deferred Scope

The current product deliberately excludes:

* Timer-based or background synchronization and unattended push
* Batch pull or batch conflict merge
* Automatic local or remote deletion propagation
* Silent conflict selection or last-write-wins behavior
* Visual editing of every arbitrary third-party Gutenberg block in Obsidian
* Binary media merge

These exclusions are safety boundaries, not unfinished task cards. Any future change requires a new roadmap and explicit acceptance criteria.

## Release Acceptance

Staged real-site acceptance for P3-1 through P3-7 passed on 2026-07-21, and the automated suite currently passes 204 tests with lint, TypeScript validation, and a production build. `npm run release:check` additionally verifies release identity and versions, documentation links, translation parity, command-map parity, required assets, and the companion package before a tag can produce a draft GitHub release.

The complete Application Password REST and XML-RPC workflow matrix remains the final release-level compatibility gate. miniOrange requires a credential smoke test when included in release claims. Each supported transport should exercise fetch, inspect, push, pull, merge, metadata, media, retry, and recovery behavior.

## P0 Task Cards

Status: Completed

These cards preserve the implementation scope and acceptance history for the completed P0 reliability and metadata work.

### P0-1: Add Slug, Excerpt, Featured Image, And Focus Keyword

Status: Completed

Goal:

* Expand the publish model so users can send more complete editorial metadata to WordPress

Primary areas:

* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [src/wp-client.ts](../src/wp-client.ts)
* [src/wp-rest-client.ts](../src/wp-rest-client.ts)
* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)
* [src/wp-api.ts](../src/wp-api.ts)

Scope:

* Add fields for `slug`, `excerpt`, `featuredImage`, and `focusKeyword`
* Pass those values through the publish pipeline
* Support WordPress transports where the target API can accept them
* Define expected fallback behavior when a specific connection type cannot support every field

Acceptance criteria:

* Users can enter these values in the publish flow
* Values are correctly sent to supported WordPress endpoints
* Unsupported fields fail gracefully instead of silently corrupting publish behavior
* Existing publish behavior remains unchanged when the new fields are left empty

Implementation notes:

* `slug`, `excerpt`, and featured media are mapped to each transport's native fields
* Featured images accept a WordPress media ID or a Vault image path/link; Vault images are uploaded before publishing
* Remote image URLs are rejected with a clear message instead of being silently ignored
* XML-RPC profiles use WP Publisher Companion for Rank Math Focus Keyword and SEO description because WordPress filters protected Rank Math keys from generic custom fields
* Companion capability is detected after login; unsupported SEO controls are visibly disabled rather than failing silently
* WordPress.com metadata transport keeps its existing metadata mapping
* Common WordPress REST connections disable Rank Math fields when that metadata is not exposed as writable
* P0-2 subsequently added front matter defaults for these fields after P0-1 established the shared publish model

### P0-2: Expand Front Matter Mapping For Editorial Metadata

Status: Completed

Goal:

* Let advanced users control more publishing behavior directly from note properties

Primary areas:

* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/front-matter.ts](../src/front-matter.ts)
* [src/types.ts](../src/types.ts)

Scope:

* Read `slug`, `excerpt`, `featuredImage`, and `focusKeyword` from front matter
* Define canonical property names and document them
* Make sure modal defaults and front matter values combine predictably

Acceptance criteria:

* A note can publish without manually re-entering metadata that already exists in front matter
* Front matter values override modal defaults in a consistent and documented way
* Missing fields do not break publish behavior

Implementation notes:

* Canonical properties are `slug`, `excerpt`, `featuredImage`, `focusKeyword`, and `metaDescription`
* `meta_description` remains readable as a compatibility alias; `metaDescription` wins when both are present
* If `excerpt` is empty, `metaDescription` also supplies the WordPress excerpt; an excerpt is not copied into Rank Math because Rank Math already falls back to it
* `focusKeyword` accepts either one text value or an Obsidian list and sends lists to Rank Math as comma-separated keywords
* `focus_keyword` remains readable as a compatibility alias; `focusKeyword` wins when both are present
* The publish modal is prefilled from these properties, while edits made in the modal remain authoritative for that publish
* Publish-with-default-options uses these properties in preference to plugin defaults
* Note `tags` are normalized and prefilled in the publish modal so they can be reviewed before publishing
* `featuredImage` accepts a WordPress media ID or a Vault image path/link
* The first image in the note body is not selected automatically; this avoids silently choosing decorative or incidental images
* Missing, empty, or unsupported property values are ignored without changing existing publish behavior

### P0-3: Preserve Existing Front Matter During Publish Write-Back

Status: Completed

Goal:

* Ensure publishing only updates the plugin-owned properties and never removes unrelated user metadata

Primary areas:

* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/front-matter.ts](../src/front-matter.ts)

Scope:

* Review current publish write-back behavior
* Keep unrelated note properties intact
* Define exactly which fields the plugin may create or update
* Avoid destructive normalization of existing front matter

Acceptance criteria:

* Existing front matter keys unrelated to publishing remain unchanged after publish
* Publishing updates only plugin-owned relationship and activity fields plus portable category slugs
* Re-publishing the same note does not progressively degrade front matter structure

### P0-4: Improve Category Representation In Front Matter And UI

Status: Completed

Goal:

* Make category data understandable both in the note and in the publish interface

Primary areas:

* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [src/wp-api.ts](../src/wp-api.ts)

Scope:

* Preserve human-readable category slugs in note-facing metadata
* Map category slugs to WordPress IDs only during publish
* Replace the flat single-category selector with a hierarchy-aware multi-select list
* Show category search when the taxonomy is too long for quick visual scanning

Acceptance criteria:

* Users can understand and select multiple categories without knowing raw WordPress IDs
* Nested categories are visually distinguishable in the publish UI
* Long category lists can be searched by name, slug, or full parent path without losing hierarchy context
* Category mapping remains reliable while note properties retain portable slugs

### P0-5: Add Create-Versus-Update Publish Clarity

Status: Completed

Goal:

* Reduce uncertainty before publish by making it explicit whether the action will create a new post or update an existing one

Primary areas:

* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)

Scope:

* Detect whether `postId` is present and valid for the current profile
* Show a clear pre-publish status such as create or update
* Warn when the note metadata suggests an unexpected target state
* Disable the submit button and show progress immediately after it is clicked

Acceptance criteria:

* Users can tell before submission whether the plugin will create a new post or update an existing one
* Profile mismatch or ambiguous publish state is surfaced clearly
* Default publish and modal publish use the same decision logic
* A publish click has visible loading feedback and cannot submit twice

### P0-6: Fix Markdown List Spacing Fidelity

Status: Completed

Goal:

* Eliminate extra blank lines or paragraph artifacts in WordPress when publishing Markdown lists

Primary areas:

* [src/app-state.ts](../src/app-state.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/markdown-it-image-plugin.ts](../src/markdown-it-image-plugin.ts)
* [src/markdown-it-comment-plugin.ts](../src/markdown-it-comment-plugin.ts)
* [src/markdown-it-mathjax3-plugin.ts](../src/markdown-it-mathjax3-plugin.ts)

Scope:

* Reproduce the extra-spacing problem with representative Markdown notes
* Identify whether the issue comes from Markdown rendering, WordPress formatting filters, or block conversion
* Adjust output so list rendering is stable in WordPress
* Remove direct paragraph wrappers from single-paragraph list items while preserving intentional multi-paragraph items
* Add regression coverage for common list shapes

Acceptance criteria:

* Standard unordered and ordered lists render without unexpected blank lines in WordPress
* Nested lists and mixed list-plus-paragraph content are verified
* The fix does not regress other Markdown output such as images, comments, or math

Implementation note:

* The extra spacing came from loose Markdown lists emitting direct `<p>` wrappers inside `<li>` elements
* Token-level normalization removes only redundant single-paragraph wrappers and leaves true multi-paragraph list items intact

### P0-7: Validate Scheduled Publish Inputs More Clearly

Status: Completed

Goal:

* Prevent avoidable publish failures caused by incomplete or confusing scheduled publish values

Primary areas:

* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)

Scope:

* Improve validation for future publish date and time input
* Prevent submit when the scheduled value is incomplete, invalid, or not in the future
* Clarify what format the user is expected to enter
* Revalidate the parsed date in the shared publish pipeline before media upload or submission

Acceptance criteria:

* Invalid scheduled input is caught before submission
* Users receive clear feedback about what must be fixed
* Impossible calendar dates and past values are rejected
* Valid scheduled publishes continue to work with current behavior

### P0-8: Add Reliable Rank Math Transport And Redesign The Publish Modal

Status: Completed

Goal:

* Make SEO publishing trustworthy on XML-RPC sites and make the publish workflow easier to scan

Primary areas:

* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [wordpress-companion](../wordpress-companion/README.md)

Scope:

* Add an authenticated WordPress companion with a strict two-key Rank Math allowlist
* Detect Rank Math write capability automatically during XML-RPC login validation
* Update SEO metadata separately after the core post succeeds and show partial-failure warnings
* Remove credentials and raw XML payloads from debug logging
* Reorganize the publish modal into clear cards with responsive desktop and mobile layouts
* Show explicit Rank Math availability and stronger submit feedback

Acceptance criteria:

* `focusKeyword` or `focus_keyword` reaches Rank Math when the companion is active
* `metaDescription` or `meta_description` reaches Rank Math when the companion is active
* A missing companion disables SEO inputs without blocking normal publishing
* Only authenticated users with `edit_post` permission can update the two allowed keys
* The publish modal remains usable on desktop and mobile

### P0 Completion Notes

* Write-back safety was established before expanding note-controlled metadata.
* The shared publish model and front matter mapping now use the same precedence rules.
* Create-versus-update clarity, schedule validation, category hierarchy, list fidelity, Rank Math transport, and the redesigned modal all passed their staged tests.

## P1 Task Cards

Status: Completed

### P1-1: Publish Native Gutenberg Blocks

Status: Completed

Goal:

* Make WordPress posts published from Obsidian open as independently editable native blocks instead of classic-editor-style HTML

Primary areas:

* [src/wordpress-blocks.ts](../src/wordpress-blocks.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/plugin-settings.ts](../src/plugin-settings.ts)
* [tests/wordpress-blocks.test.mjs](../tests/wordpress-blocks.test.mjs)

Scope:

* Serialize common Markdown structures into WordPress core block comments and matching HTML
* Preserve nested list structure with native List and List Item blocks, including Quote inner blocks
* Use Image, Quote, Code, Table, and Separator blocks where markup can be validated safely
* Preserve Mermaid source as a Code block without executing untrusted diagram scripts
* Fall back to Custom HTML for math output, mixed image paragraphs, sized Obsidian images, multi-paragraph list items, and unsupported HTML
* Make Block Editor output the default and retain a traditional HTML compatibility setting

Acceptance criteria:

* A newly published post opens in the WordPress block editor without conversion prompts
* Paragraphs, headings, lists, images, quotes, code, tables, and separators are independently selectable and editable
* Nested lists preserve their hierarchy
* WordPress reports no invalid or unexpected block content
* Front-end rendering remains equivalent to the source note
* Traditional HTML mode continues to publish the previous output format

### P1-2: Prevent Duplicate Media Uploads

Status: Completed

Goal:

* Reuse media already uploaded by this plugin instead of creating duplicate WordPress attachments on every publish

Primary areas:

* [src/media-cache.ts](../src/media-cache.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-profile.ts](../src/wp-profile.ts)
* [tests/media-cache.test.mjs](../tests/media-cache.test.mjs)

Scope:

* Calculate a SHA-256 fingerprint for each local media file before upload
* Keep a separate fingerprint cache for each WordPress profile
* Share cached uploads between featured images and images embedded in post content
* Reuse the cached WordPress URL and attachment ID while the file content remains unchanged
* Upload again automatically when local file content changes
* Resolve relative image paths from the active note path rather than from the image file name
* Retain at most 500 recent media entries per profile

Acceptance criteria:

* Re-publishing an unchanged note does not add duplicate media-library items
* Reusing one Vault image more than once in a note uploads it only once
* Using the same image as post content and featured image uploads it only once
* Editing the local image causes the new content to upload instead of reusing stale media
* Cached body images without a valid attachment ID are not reused as featured images
* REST, XML-RPC, and legacy saved-token WordPress.com publishing continue to use the same shared workflow

Follow-up status: Completed in P1-6, including transport-specific attachment metadata and stale cached-attachment validation.

### P1-3: Preview Before Publishing

Status: Completed

Goal:

* Let users inspect post metadata, rendered content, and Gutenberg conversion quality before sending anything to WordPress

Primary areas:

* [src/wp-publish-preview-modal.ts](../src/wp-publish-preview-modal.ts)
* [src/publish-preview.ts](../src/publish-preview.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [tests/publish-preview.test.mjs](../tests/publish-preview.test.mjs)

Scope:

* Add a Preview action beside the final publish or update action
* Open a local-only preview without authentication, uploads, taxonomy creation, or post submission
* Show current post status, type, slug, excerpt, categories, tags, featured image, and SEO values
* Render the note body with Obsidian's safe Markdown renderer and Vault-aware local image resolution
* Run the actual WordPress serializer and report native block and Custom HTML fallback counts
* Explain that final typography and spacing remain controlled by the active WordPress theme
* Keep the preview usable on desktop and mobile layouts

Acceptance criteria:

* Preview opens from the publish modal with the latest field values
* Opening or closing preview does not publish or mutate the note
* Local images and Markdown content render in the preview
* Gutenberg mode reports serialized block and Custom HTML counts
* Returning from preview preserves all publish-modal selections
* Publish and update behavior remains unchanged

### P1-4: Add Per-Profile Publishing Defaults

Status: Completed

Goal:

* Let each WordPress profile define repeatable publishing defaults without overriding explicit note properties or one-time modal choices

Primary areas:

* [src/profile-publishing-defaults.ts](../src/profile-publishing-defaults.ts)
* [src/wp-profile.ts](../src/wp-profile.ts)
* [src/wp-profile-modal.ts](../src/wp-profile-modal.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [tests/profile-publishing-defaults.test.mjs](../tests/profile-publishing-defaults.test.mjs)

Scope:

* Store optional default post status, comment status, post type, and tags per WordPress profile
* Inherit global status and comment defaults when a profile does not override them
* Apply note `wpTags` ahead of profile defaults; when absent, import legacy front matter `tags` before falling back to profile tags, while an explicit empty `wpTags` clears defaults
* Validate the preferred post type against the types returned by the selected site and fall back safely
* Use the same defaults in both the standard publish modal and the default-profile command
* Preserve the priority of explicit note properties and one-time publish-modal selections

Acceptance criteria:

* Existing profiles without defaults behave exactly as before
* Different WordPress profiles can start with different publishing values
* Front matter values override profile defaults
* An explicit empty `wpTags` property produces no WordPress tags
* Invalid custom post type defaults do not break the publish modal
* Editing and saving a profile preserves unrelated credentials, category history, and media cache

Follow-up status: Named publishing templates were completed in P1-5. Remaining category and template expansion is tracked only under Remaining Candidate Work.


### P1-5: Add Named Publishing Templates

Status: Completed

Goal:

* Let users save repeatable publishing combinations independently of any WordPress profile and load them on demand

Primary areas:

* [src/publishing-templates.ts](../src/publishing-templates.ts)
* [src/publishing-template-manage-modal.ts](../src/publishing-template-manage-modal.ts)
* [src/plugin-settings.ts](../src/plugin-settings.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [tests/publishing-templates.test.mjs](../tests/publishing-templates.test.mjs)

Scope:

* Store named templates globally so one template can be used with different WordPress profiles
* Include post status, comment status, post type, and tags as a complete reusable preset
* Add a visual manager for creating, editing, deleting, validating, and saving templates
* Let the publish modal load a template without changing content metadata, SEO fields, featured images, or categories
* Keep explicit note `wpTags` and an existing linked post type ahead of template values
* Validate template post types against the selected WordPress site and fall back safely

Acceptance criteria:

* Closing the template manager without saving leaves existing templates unchanged
* Template names are required and unique
* Selecting a template updates only status, comments, post type, and tags
* Users can still adjust every loaded value before publishing
* Selecting no template restores profile defaults without clearing other modal edits
* Explicit note `wpTags`, including an empty list, override template tags
* Templates remain usable across multiple WordPress profiles

Further template expansion is tracked under Remaining Candidate Work and is not part of P1.

### P1-6: Publish Media Attachment Metadata

Status: Completed

Goal:

* Preserve useful media-library metadata when local images are uploaded or reused

Primary areas:

* [src/media-metadata.ts](../src/media-metadata.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-rest-client.ts](../src/wp-rest-client.ts)
* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)
* [wordpress-companion](../wordpress-companion/README.md)

Scope:

* Use the local filename stem as the default attachment title
* Treat standard Markdown `![alt](image.png)` as the primary single-image workflow: preserve its alt text in post content and attachment metadata without turning it into a visible caption
* Preserve optional Markdown image title text
* Read optional title, alt text, caption, and description overrides from a hidden `%% wp-media ... %%` comment immediately below an image
* Accept `altText`, `alt`, `Alt text`, `alt_text`, and `alt-text`, with either a half-width or full-width colon
* Accept `caption: =alt` as an explicit per-image shorthand for reusing the final Alt Text as the attachment caption and visible figcaption
* Write metadata during REST and legacy saved-token WordPress.com uploads
* Add a permission-checked Companion method for XML-RPC attachment updates
* Update metadata on already cached attachments without uploading duplicate files
* Verify cached attachment IDs before reuse and automatically re-upload files deleted from WordPress
* Keep image alt text and dimensions intact when local links are replaced with WordPress URLs
* Create a standalone image figcaption only from an explicit caption; when an explicitly authored title is also present, show it in bold above the caption without exposing the filename-derived attachment title

Primary single-image example:

```markdown
![A concise visual description](images/cover.jpg)
```

Advanced metadata example:

```markdown
![[images/cover.jpg]]

%% wp-media
title: A readable media-library title
altText: A concise visual description
caption: An editorial attachment caption
description: Longer attachment context
%%
```

The comment must follow the image with only whitespace between them. It remains in the Obsidian note but is removed from preview and published content. Metadata-like text inside fenced code is left untouched.

To intentionally show the Markdown image description as a visible caption, opt in for that image:

```markdown
![A concise visual description](images/cover.jpg)

%% wp-media
caption: =alt
%%
```

An explicit `altText` in the same block is used when present; otherwise the shorthand uses the Markdown image alt. If neither supplies Alt Text, no caption is created. Any other `caption` value remains literal. The filename stem remains the default WordPress attachment title but is not displayed in the figcaption unless the author explicitly supplies a title.

Acceptance criteria:

* A standard Markdown image alt reaches post content and WordPress attachment Alt Text but does not create a standalone image-block figcaption
* An adjacent explicit caption reaches both attachment metadata and the editable image-block figcaption
* `caption: =alt` reaches both caption destinations using the final explicit or inline Alt Text without changing the default behavior of ordinary images
* A filename-derived attachment title stays in the media library and never appears as a bold figcaption title unless an explicit metadata or Markdown title requests it
* Attachment title defaults to the image filename without its extension
* Adjacent `wp-media` values override automatic values and also apply to a featured image that references the same Vault file
* Re-publishing a cached image updates changed metadata without adding a duplicate attachment
* A cached attachment deleted from WordPress is removed from the local cache and uploaded again
* REST, legacy saved-token WordPress.com, and XML-RPC with Companion support all four fields
* XML-RPC without an updated Companion continues publishing and shows a clear metadata warning

## P2 Task Cards

Status: Completed

P2 followed a completed dependency order: safe single-post update controls, observability, multi-site publishing, and then batch publishing. This avoided building multi-target workflows on an immature single-target state model.

### P2-1: Add Selective Update Strategies

Status: Completed

Goal:

* Let an existing WordPress post receive a body-only update without overwriting fields maintained in WordPress

Primary areas:

* [src/publish-strategy.ts](../src/publish-strategy.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-publish-modal.ts](../src/wp-publish-modal.ts)
* [src/wp-rest-client.ts](../src/wp-rest-client.ts)
* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)

Scope:

* Offer Full update and Content only choices only when the current note is linked to an existing post
* Keep Full update as the default and preserve existing publish behavior
* In Content only mode, send only the rendered post body to WordPress
* Continue uploading and rewriting images referenced by the body
* Leave title, status, comments, categories, tags, slug, excerpt, featured image, scheduling, and SEO metadata unchanged
* Hide ignored controls and show the selected update scope in the preview
* Keep new-post publishing on the full publishing path

Acceptance criteria:

* Both REST and XML-RPC body-only requests contain no metadata or taxonomy fields
* Full updates continue sending all previously supported fields
* Content only does not create tags, change remembered categories, or replace note categories during write-back
* Scheduled profile defaults do not require a date for a Content only update
* The publish modal makes the reduced scope obvious before submission
* Preview metadata shows only the active update scope when other fields will be ignored
* New posts cannot accidentally use Content only mode

### P2-2: Add Publish History And Richer Sync Status

Status: Completed

Goal:

* Make recent publish outcomes and the current note-to-site relationship visible without opening WordPress

Primary areas:

* [src/publish-history.ts](../src/publish-history.ts)
* [src/wp-publish-history-modal.ts](../src/wp-publish-history-modal.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/front-matter.ts](../src/front-matter.ts)
* [src/plugin-settings.ts](../src/plugin-settings.ts)

Scope:

* Keep the newest 100 create, full-update, and content-only attempts in local plugin settings
* Store note path and title, profile and endpoint, post type and ID, outcome, timestamp, warning count, and a bounded failure message
* Never store post bodies, usernames, passwords, tokens, or unknown input fields in history entries
* Add a searchable history command with local-note and WordPress edit actions
* Allow confirmed history clearing without changing any note-to-post link
* Write only two additional scalar note properties: `wpLastPublishedAt` and `wpLastPublishAction`; store the former as a readable ISO timestamp with the local UTC offset
* Show the last successful timestamp and action in the publish target banner

Design constraints:

* Keep history bounded and avoid storing article bodies or credentials
* Preserve the current valid Obsidian property experience; do not introduce nested front matter that Obsidian reports as invalid
* Record enough target identity and outcome data to support later multi-site and batch result views
* Distinguish create, full update, and content-only update events

Acceptance criteria:

* Users can inspect and search recent successes, failures, target profiles, post IDs, strategies, timestamps, warnings, and failure messages
* Existing note files can be opened directly and linked posts can be opened in the WordPress editor
* History remains useful after restarting Obsidian and is capped at 100 entries
* Existing notes and settings migrate without losing publish links or credentials
* Successful publishes update valid scalar sync properties without deleting unrelated front matter
* Clearing history does not remove note-to-post links or scalar sync properties

### P2-3: Publish One Note To Multiple Sites

Status: Completed

Goal:

* Publish the current note to several selected WordPress profiles in one controlled operation

Primary areas:

* [src/profile-identity.ts](../src/profile-identity.ts)
* [src/multi-site-targets.ts](../src/multi-site-targets.ts)
* [src/wp-multi-site-publish-modal.ts](../src/wp-multi-site-publish-modal.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/plugin-settings.ts](../src/plugin-settings.ts)

Scope:

* Add a rename-safe internal ID to every WordPress profile and repair missing or duplicate IDs while loading legacy settings
* Store each note and profile's post ID, post type, endpoint snapshot, and update timestamp in bounded local plugin data rather than nested front matter
* Keep existing single-site front matter fully compatible and use successful single-site publishes to seed the multi-site target store
* Migrate target mappings when a note is renamed and remove mappings when their WordPress profile is deleted
* Add a command that requires explicit selection of at least two profiles and previews Create or Update #ID for every site
* Let existing targets independently choose Full update or Content only while new targets always use the full create path
* Apply an optional shared publishing template over each profile's own defaults, categories, credentials, and media cache
* Freeze one source-note snapshot for the operation and publish selected sites sequentially
* Disable single-site front-matter write-back and local media-link replacement during multi-site publishing
* Keep successful site targets when another site fails, then offer per-site and all-failed retry actions plus direct WordPress edit actions
* Record every site attempt independently in publish history and surface transport or media warnings in the matching site result

Design constraints:

* Introduce stable profile identities before persisting multiple targets
* Never overwrite one site's post ID with another site's ID
* Avoid nested or opaque front matter that degrades the Obsidian property editor
* Reuse per-profile defaults, media caches, templates, and update strategies
* Keep post bodies, credentials, and tokens out of the multi-site target store
* Retain at most 500 note mappings and use the newest successful target data when normalizing local state

Acceptance criteria:

* Users explicitly select target profiles and review create-versus-update behavior per site
* Each site retains its own post ID, post type, result, and error state
* A failure on one site does not roll back or hide successful publishes to other sites
* Results provide direct retry and WordPress edit actions per target
* Switching or editing notes after the multi-site window opens does not change the frozen source revision used by that operation
* Publishing local images to one site does not cause another site to reuse that site's remote URLs

### P2-4: Batch Publish Multiple Notes

Status: Completed

Goal:

* Publish an explicit set of notes with visible progress and recoverable failures

Primary areas:

* [src/batch-publish.ts](../src/batch-publish.ts)
* [src/wp-batch-publish-modal.ts](../src/wp-batch-publish-modal.ts)
* [src/profile-note-target.ts](../src/profile-note-target.ts)
* [src/coordinated-publish.ts](../src/coordinated-publish.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/main.ts](../src/main.ts)

Scope:

* Add a command that opens independently of the active editor and requires one explicit target profile
* Let users narrow the Vault by recursive folder scope and search, select the exact visible notes, clear the selection, or review only selected notes
* Freeze every selected note's raw content and parsed front matter before publishing without creating or rewriting front matter during review
* Resolve each note's stable profile target and preview Create or Update #ID before the queue starts
* Let each existing target independently choose Full update or Content only while new targets always use the full create path
* Apply one optional publishing template over the selected profile's defaults, categories, tags, credentials, and media cache
* Run a single-worker queue that reuses validated authentication and successful media checks without issuing concurrent WordPress requests
* Keep queued, publishing, successful, failed, and skipped states visible with aggregate progress and per-note warnings or errors
* Stop only before the next note so the in-flight request can finish safely, then mark the untouched remainder as skipped
* Retry one failed or skipped note, all failed notes, or all skipped notes while always excluding successful notes
* Keep the active editor in place, preserve local image links, and write only the normal scalar WordPress properties back to each successfully published note
* Persist every attempt in publish history and provide direct note-open and WordPress-edit actions from the result list
* Treat a post as successful when WordPress accepted it but Obsidian property write-back failed, preserve its post target, and surface the local write-back problem as a warning to prevent duplicate creates on retry

Design constraints:

* Publishing must use explicit source files and frozen snapshots instead of whichever editor is currently active
* A batch must have an exact note selection or recursive folder scope and one clear target profile
* Templates, defaults, update strategies, media deduplication, multi-site targets, and publish history must share the established single-note behavior
* Concurrency is fixed at one so cancellation boundaries are deterministic and WordPress is not overwhelmed
* Closing the window requests cancellation but does not abort or corrupt the note already in flight
* Retries must reuse the reviewed snapshot and never include successful notes

Acceptance criteria:

* Users can review the exact note set and create-versus-update actions before starting
* Progress identifies queued, publishing, successful, skipped, and failed notes
* Cancellation stops new work without corrupting completed notes
* Failed notes can be retried without republishing successful notes
* Batch publishing never switches or rewrites the user's active editor unexpectedly

## P3 Task Cards

Status: Completed; P3-1 through P3-7 passed staged real-site acceptance on 2026-07-21

The implemented dependency chain was P3-1 -> P3-2 -> P3-3 -> P3-4 -> P3-5 -> P3-6 -> P3-7. Each card passed local fixtures and staged real-site acceptance before the next card introduced broader write behavior.

### Shared P3 Architecture And Guardrails

Remote snapshot model:

* Introduce a transport-independent remote post snapshot containing profile ID, endpoint, post ID, post type, editable title and content, source format, slug, excerpt, status, comment status, dates, remote modified marker, taxonomy terms, featured media, supported SEO values, and the remote edit URL
* Preserve both normalized values and the original editable post content needed for fidelity checks
* Include field-level capability information so an unavailable value is distinguishable from an intentionally empty value
* Keep transport response parsing outside the UI and cover every parser with sanitized fixtures

Synchronization identity and state:

* Reuse stable profile IDs and the per-note multi-site target store; each note and profile pair has its own remote identity and baseline
* Never infer identity from title, slug, filename, public URL, or most recent history alone
* Compare canonical field hashes against a common baseline to classify in-sync, local-only, remote-only, diverged, unknown, and remote-missing states
* Treat conversion diagnostics as part of sync safety: a blocking conversion issue prevents local overwrite but does not prevent read-only inspection

Write safety:

* Freeze local and remote revisions before review
* Re-check the local hash before any Vault write and re-fetch the remote hash immediately before any WordPress overwrite
* Apply local changes through one guarded Vault transaction that preserves unrelated front matter
* Keep a bounded restore snapshot and expose undo without overwriting edits made after the pull
* Update the sync baseline only after the intended side effects actually succeed
* Record pull and merge outcomes without storing article bodies in the activity history

Explicit P3 exclusions:

* No timer-based or background synchronization
* No batch pull or batch merge
* No automatic local or remote deletion
* No silent last-write-wins behavior
* No attempt to visually edit every arbitrary third-party Gutenberg block in Obsidian
* No binary media merge

Technical references:

* WordPress REST post responses and edit-context fields: https://developer.wordpress.org/rest-api/reference/posts/
* REST post type discovery and rest_base: https://developer.wordpress.org/rest-api/reference/post-types/
* Custom content type REST routing: https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-rest-api-support-for-custom-content-types/
* XML-RPC post retrieval: https://developer.wordpress.org/reference/classes/wp_xmlrpc_server/wp_getpost/
* Official serialized-block parser: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-block-serialization-default-parser/

### P3-1: Read A Linked Remote Post As A Normalized Snapshot

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Retrieve the exact WordPress post linked to the current note and selected profile without changing either side

Primary areas:

* [src/wp-client.ts](../src/wp-client.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-rest-client.ts](../src/wp-rest-client.ts)
* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)
* [src/profile-note-target.ts](../src/profile-note-target.ts)
* [src/remote-post.ts](../src/remote-post.ts)
* [src/wp-remote-inspector-modal.ts](../src/wp-remote-inspector-modal.ts)

Scope:

* Extend the shared WordPress client with an authenticated fetch operation that accepts an explicit post ID and post type
* Normalize common REST responses using edit context so content is raw editable source rather than public rendered HTML
* Discover a post type's REST base for pages and custom post types instead of hard-coding the posts endpoint
* Normalize legacy saved-token WordPress.com single-post responses using editing context where supported
* Add XML-RPC wp.getPost support with an explicit field list for post content, metadata, terms, and modified dates
* Resolve stable targets from the current note; when several profiles are linked, require the user to choose one
* Show a read-only inspector with target identity, remote modified time, source format, available metadata, and transport capability warnings
* Distinguish authentication failure, permission failure, missing post, unsupported post type, malformed response, and network failure

Implementation snapshot (2026-07-20):

* Added a transport-independent allowlisted snapshot and field capability model
* Added edit-context readers for Core REST, legacy saved-token WordPress.com REST, and XML-RPC wp.getPost
* Added a read-only current-note inspector with explicit multi-profile selection, refresh, raw editable source, and normalized metadata
* Stable target resolution uses the profile target store or explicit note properties and deliberately excludes publish history as sole identity
* Parser fixtures cover all transports
* Real-site acceptance on 2026-07-21 correctly fetched a linked published article and correctly reported no remote association for an unpublished note

Design constraints:

* Opening or refreshing the inspector must not modify the note, settings target, media cache, remote post, or activity history
* The target profile, post ID, and post type must remain frozen for one fetch
* Response parsers must return only normalized allowlisted fields and must not retain credentials or arbitrary server payloads
* Missing optional fields must be represented as unsupported or absent rather than fabricated as empty strings

Acceptance criteria:

* A linked post or page can be fetched through application-password REST, legacy saved-token WordPress.com, and XML-RPC profiles
* Custom post types use the discovered REST route when WordPress exposes them
* A multi-site note fetches only the explicitly selected profile's post
* A missing or mismatched target produces a clear read-only error and never falls back to another article
* Fetching and closing the inspector leaves the note byte-for-byte unchanged
* Sanitized fixtures cover successful and malformed responses for every transport

### P3-2: Convert WordPress Content To Loss-Aware Markdown

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Produce editable Obsidian Markdown from Gutenberg or classic HTML while making every normalization or unsupported structure visible

Primary areas:

* [src/wordpress-blocks.ts](../src/wordpress-blocks.ts)
* [src/wordpress-to-markdown.ts](../src/wordpress-to-markdown.ts)
* [src/wordpress-block-parser.ts](../src/wordpress-block-parser.ts)
* [src/wp-remote-inspector-modal.ts](../src/wp-remote-inspector-modal.ts)
* [tests/wordpress-to-markdown.test.mjs](../tests/wordpress-to-markdown.test.mjs)
* [tests/wordpress-block-parser.test.mjs](../tests/wordpress-block-parser.test.mjs)

Scope:

* Use the official WordPress serialized-block parser or a fixture-proven compatible layer instead of parsing nested Gutenberg comments with ad hoc regular expressions
* Convert the native blocks already emitted by the plugin: paragraphs, headings, nested lists, quotes, code, images, tables, separators, and Custom HTML
* Preserve inline emphasis, strong text, links, code, line breaks, image alt text, titles, captions, and list numbering
* Convert classic HTML with an explicit allowlist and deterministic whitespace rules
* Return Markdown plus diagnostics classified as exact, normalized, preserved raw, or blocking
* Preserve unknown and third-party blocks inside non-executing protected WordPress-source fences that the forward serializer can reinsert among ordinary Markdown
* Keep remote image URLs as remote Markdown images during this stage; local media restoration and downloads belong to P3-6
* Version the converter so a baseline created by one conversion policy is not silently compared with another

Design constraints:

* No block, shortcode, embed, attribute, or non-empty HTML fragment may disappear silently
* Protected raw regions must display as inert source in Obsidian and round-trip without being converted into ordinary code blocks
* Script-like HTML must never execute during parsing, preview, diff generation, or note rendering
* Conversion must be a pure operation with no Vault, settings, network, or remote side effects

Acceptance criteria:

* Content produced by the plugin's current Gutenberg serializer converts back to semantically equivalent Markdown for every native supported block
* Nested lists and quotes, tables, code fences, captions, Unicode text, and mixed inline formatting pass fixture tests
* Classic editor HTML produces stable Markdown across repeated conversions
* Unknown blocks survive a Markdown -> WordPress -> Markdown round trip byte-for-byte inside protected regions
* The conversion report identifies every normalized, preserved, or blocking segment and provides source locations
* Malformed block markup fails safely without returning a deceptively complete document

Implementation snapshot (2026-07-21):

* The stack parser retains exact raw bytes, nested block structure, attributes, and source locations without using nested-comment regular expressions
* The pure converter handles the plugin's native blocks and allowlisted classic HTML, reports four fidelity levels, and versions its output policy
* Unknown blocks and unsafe HTML become inert base64-backed wp-source regions that the forward serializer restores byte-for-byte
* The read-only remote inspector shows converted Markdown, aggregate fidelity, per-kind counts, and source-located diagnostics beside the untouched remote source
* Harmless official WordPress boilerplate such as wp-block-heading and an empty list values attribute is normalized instead of preserved raw; anchors, custom styles, media identity, and layout settings remain protected
* Note writes, remote writes, media downloads, and Apply actions remain outside P3-2
* Automated acceptance passed on 2026-07-21 with 138 tests and a production build; real-site inspector acceptance also passed

### P3-3: Preview Differences And Manually Pull Remote Changes

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Let the user review and deliberately apply WordPress edits to the current note with an immediate recovery path

Primary areas:

* [src/sync-diff.ts](../src/sync-diff.ts)
* [src/wp-pull-preview-modal.ts](../src/wp-pull-preview-modal.ts)
* [src/note-sync-transaction.ts](../src/note-sync-transaction.ts)
* [src/front-matter.ts](../src/front-matter.ts)
* [src/publish-history.ts](../src/publish-history.ts)

Scope:

* Add a Pull changes from WordPress command for a linked current note and explicit profile
* Freeze the current local file, fetch the remote snapshot, convert it, and show metadata plus body differences before enabling Apply
* Show conversion fidelity and blocking warnings next to the affected content
* Let users independently choose title, body, slug, excerpt, status, comment status, categories, and tags when the transport supplies them
* Keep category values as portable slugs and preserve unrelated front matter keys
* Treat the body as one selectable unit in P3-3; hunk-level merge belongs to P3-5
* Re-check the local file hash at Apply time and return to review if it changed
* Write the chosen result with one guarded Vault process operation
* Keep a bounded pre-pull restore snapshot and provide Undo only while the post-pull file still matches the expected revision
* Add pull success, failure, selected field count, warning count, target, and timestamp to the local activity history without storing bodies

Design constraints:

* The preview is read-only; Apply is disabled when conversion has a blocking diagnostic
* The first pull must never overwrite the note immediately after fetch
* Remote image URLs remain URLs and no media files are downloaded in this card
* A failed write leaves both the note and existing post relationship unchanged
* Opening the note from another pane or switching active files must not redirect the operation

Acceptance criteria:

* A WordPress body edit can be reviewed and pulled into its linked Obsidian note
* Selecting metadata without body changes only the selected properties
* Unrelated properties and the user's latest unreviewed local edits are never removed
* Changing the note after the diff opens prevents stale Apply
* Undo restores the exact pre-pull bytes and refuses to overwrite later user edits
* Cancelling or closing the preview makes no changes

Implementation snapshot (2026-07-21):

* The Pull changes from WordPress command freezes the explicit source file, revalidates its selected profile link, and fetches a fresh P3-1 snapshot before building any preview
* Title, body, slug, excerpt, status, comment status, categories, and tags are independently selectable; unavailable transport fields and taxonomy IDs without portable slugs or names cannot be applied
* Metadata cards compare Obsidian and WordPress values, while the body remains one selectable unit with a bounded unified line diff and source-located P3-2 conversion diagnostics
* Any blocking conversion diagnostic disables the complete Apply action; normalized and raw-preserved regions remain visible beside the affected content
* Selected metadata is merged into parsed front matter without removing unrelated keys, category values remain WordPress slugs, and selected body content keeps the note's line-ending convention
* Apply re-checks the frozen SHA-256 revision and performs exactly one guarded Vault process operation; a changed note returns to review without being overwritten
* The newest five exact pre-pull revisions share an 8 MiB local limit; both immediate and command-palette Undo require the current file to match the expected post-pull hash
* Pull successes and failures record target identity, selected field count, conversion warning count, and timestamp in the bounded local activity history without storing article bodies
* Pulled title, status, and comment status use ordinary top-level properties; supported values participate in later publish defaults while the publish UI can still override them explicitly
* Baselines, divergence classification, hunk-level merge, remote writes, and media downloads remain outside P3-3
* Automated acceptance passed on 2026-07-21 with 151 tests, TypeScript validation, diff checks, and a production build
* Real-site user acceptance passed on 2026-07-21 with no observed P3-3 defects

### P3-4: Track Sync Baselines And Detect Divergence

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Determine which side changed since the last agreed revision before recommending push, pull, or merge

Primary areas:

* [src/sync-baseline.ts](../src/sync-baseline.ts)
* [src/sync-state-presentation.ts](../src/sync-state-presentation.ts)
* [src/sync-state-panel.ts](../src/sync-state-panel.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)
* [src/wp-remote-inspector-modal.ts](../src/wp-remote-inspector-modal.ts)
* [src/wp-pull-preview-modal.ts](../src/wp-pull-preview-modal.ts)
* [src/wp-publish-history-modal.ts](../src/wp-publish-history-modal.ts)
* [src/plugin-settings.ts](../src/plugin-settings.ts)

Scope:

* Store one baseline per note and profile target after a successful publish, pull, or merge
* Include converter version, canonical local and remote field hashes, remote modified marker, agreed normalized Markdown, and field-level base values needed for a true three-way comparison
* Keep baseline bodies in a dedicated plugin-local cache rather than front matter, publish history, or the compact target store
* Bound the cache by both count and total bytes, evict oldest unused baselines first, and make clearing it independent from unlinking posts
* Canonicalize line endings and plugin-owned sync properties while preserving meaningful whitespace and content
* Classify targets as in-sync, local-only, remote-only, diverged, unknown, or remote-missing
* Update baselines after full and content-only publishes with the correct field scope
* Move baseline keys when notes are renamed and remove profile-specific entries when a profile is deleted
* Surface sync state and last agreed time in the inspector, pull preview, and history UI without adding nested front matter

Design constraints:

* Remote modified timestamps are supporting evidence, not the sole conflict detector
* Failed, cancelled, or warning-only partial operations must not claim a new agreed baseline
* Evicting a baseline changes state to unknown but must not remove the post target or block ordinary publishing
* Baselines may contain article content but never credentials, tokens, arbitrary HTTP responses, or media binaries

Acceptance criteria:

* A local-only edit, remote-only edit, and simultaneous edit are classified correctly from the same baseline
* Separate profiles for one note maintain independent baselines and states
* Content-only publish updates only the body-related baseline fields
* Restarting Obsidian preserves states within cache limits
* Renaming a note or profile does not silently attach its baseline to the wrong target
* Clearing or evicting baselines safely returns affected targets to unknown

Implementation snapshot (2026-07-21):

* A dedicated plugin-local cache stores at most 100 note/profile baselines and 16 MiB in total; least-recently-used entries are evicted first without changing compact post targets
* Every baseline records schema and converter versions, separate canonical local and remote field values and hashes, the WordPress modified marker when available, last-agreed and last-observed times, target identity, and only the tracked article fields
* Canonicalization normalizes line endings and one conventional final body newline, sorts portable category and tag values, distinguishes missing properties from explicit empty values, and excludes plugin-owned sync properties by construction
* A warning-free publish performs one authenticated read-only WordPress readback and conversion before recording a strong baseline, so server-generated slugs, block normalization, media URLs, titles, and captions do not create immediate false divergence
* Content-only publishing refreshes only the body base; a failed readback, publish warning, cancellation, or publish failure leaves the prior baseline unchanged
* A reviewed pull updates only selected fields after the guarded Vault write commits; preview cancellation and stale or failed Apply paths do not claim agreement
* Fresh inspector and pull-preview snapshots classify in-sync, local-only, remote-only, diverged, unknown, and remote-missing from field hashes; modified timestamps remain supporting evidence only
* The inspector persists its latest explicit observation for history display, while pull preview remains non-mutating until Apply; all three interfaces show the state and last-agreed time
* Baselines move with note renames, remain keyed by stable profile ID across profile renames, are invalidated by endpoint changes, and are removed with deleted profiles
* The Clear WordPress sync baselines command deletes only this cache after confirmation; note-to-post links, activity history, and guarded pull snapshots remain untouched
* New history entries include stable profile identity, while older entries continue to resolve conservatively by note, endpoint, and post ID
* Automated acceptance passed with 162 tests, TypeScript validation, diff checks, watcher compilation, and a production build
* Real-site user acceptance passed on 2026-07-21 with no observed P3-4 defects
* P3-4 adds no automatic push, pull, merge, polling, conflict resolution, or deletion propagation

### P3-5: Resolve Conflicts With A Reviewed Three-Way Merge

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Combine non-overlapping local and WordPress edits while forcing explicit decisions for true conflicts

Primary areas:

* [src/three-way-merge.ts](../src/three-way-merge.ts)
* [src/wp-sync-conflict-modal.ts](../src/wp-sync-conflict-modal.ts)
* [src/publish-strategy.ts](../src/publish-strategy.ts)
* [src/abstract-wp-client.ts](../src/abstract-wp-client.ts)

Scope:

* Build a three-way comparison from baseline, current local revision, and freshly fetched remote revision
* Auto-merge non-overlapping body edits and independent metadata fields
* Present unresolved body hunks and metadata conflicts with Keep Obsidian, Use WordPress, and edited-result choices
* Treat preserved unknown WordPress blocks as indivisible conflict units
* Preview the complete merged Markdown and outbound WordPress representation before execution
* Re-check the local revision and re-fetch the remote post immediately before committing a reviewed result
* Save the merged local result first; if the remote push then fails, leave a visible local-only state that can be retried without losing the merge
* Update the baseline only after the remote post and local note reach the reviewed result
* Record merge outcomes and expose local undo plus a direct WordPress edit action

Design constraints:

* No last-write-wins fallback and no automatic choice for overlapping edits
* A changed local or remote revision invalidates the review instead of applying stale decisions
* The workflow must survive a remote failure after local save without claiming success or rolling back user-visible merged content silently
* Metadata unsupported by one transport remains excluded rather than being overwritten with empty values

Acceptance criteria:

* Non-overlapping local and remote edits merge without losing either change
* Overlapping lines and conflicting metadata require an explicit user decision
* A remote change made while the merge window is open stops the outgoing update
* A remote publish failure leaves the merged note recoverable and correctly marked local-only
* Retrying after a partial failure does not duplicate posts or discard resolved conflicts
* A successful merge produces matching canonical hashes and a new shared baseline

Implementation snapshot (2026-07-21):

* A dedicated Resolve WordPress sync conflict command resolves stable note/profile targets, requires a matching P3-4 baseline, and accepts diverged targets plus local-only recovery after a partial merge
* The pure merge core compares each side with its own baseline representation, auto-selects one-sided or equal changes, and combines non-overlapping body changes with a bounded line matrix
* Overlapping body hunks and conflicting metadata remain unresolved until Keep Obsidian, Use WordPress, or an edited result is explicitly chosen; Apply stays disabled meanwhile
* Protected wp-source regions are validated and treated as one indivisible atom, while different agreed body representations conservatively become one explicit conflict instead of being projected automatically
* The review shows the complete merged note and serialized outbound WordPress body, then re-checks the note hash, target link, baseline signature, remote modified marker, and remote field hashes immediately before writing
* Merge execution stores an exact local restore snapshot, commits the guarded Vault revision first, updates only the reviewed fields on the existing post ID, and establishes a strong baseline only after authenticated remote readback
* Remote failure leaves the merged note intact, attempts a fresh sync-state classification, offers guarded local Undo and same-post retry, and never falls back to post creation
* REST and XML-RPC merge payloads exclude unsupported or unreviewed fields, including unrelated SEO and featured-media values, rather than clearing them
* Successful and failed attempts are recorded as a distinct merge action in the bounded activity history, with direct note recovery and WordPress edit actions available from the result
* Automated acceptance passed with 175 tests, TypeScript validation, diff checks, watcher compilation, and a production build; real-site user acceptance passed on 2026-07-21 with no observed P3-5 defects
* P3-5 adds no unified automatic action routing, background polling, media downloads, deletion propagation, or unattended conflict resolution

### P3-6: Complete Explicit Sync, Metadata, And Media Round Trips

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Present push, pull, and merge as one explicit synchronization workflow with practical metadata and image fidelity

Primary areas:

* [src/wp-sync-modal.ts](../src/wp-sync-modal.ts)
* [src/sync-workflow.ts](../src/sync-workflow.ts)
* [src/sync-media.ts](../src/sync-media.ts)
* [src/sync-media-runtime.ts](../src/sync-media-runtime.ts)
* [src/media-cache.ts](../src/media-cache.ts)
* [src/media-metadata.ts](../src/media-metadata.ts)
* [src/editorial-metadata.ts](../src/editorial-metadata.ts)
* [wordpress-companion/wp-publisher-companion/wp-publisher-companion.php](../wordpress-companion/wp-publisher-companion/wp-publisher-companion.php)

Scope:

* Add one Sync with WordPress command that fetches the selected target, computes state, and offers only the safe actions for that state
* Reuse the established publish pipeline for local-only push and the P3-3 transaction for remote-only pull
* Route diverged state into the P3-5 merge workflow and explain unknown or remote-missing states without guessing
* Round-trip supported title, body, slug, excerpt, status, comment status, category slugs, WordPress tag names through `wpTags`, featured media, Focus Keyword, and SEO description
* Extend transport capability reporting and the companion plugin only where protected SEO values require an explicit authenticated read method
* Restore a local image link when a remote URL matches the selected profile's media cache and the Vault file still exists
* Keep unmatched remote images as URLs by default; offer an explicit download option with a configured Vault folder, content-hash deduplication, and collision-safe filenames
* Reconstruct image alt text, title, caption, and adjacent wp-media metadata when available
* Keep a separate sync state for every profile linked to a multi-site note
* Add searchable push, pull, and merge outcomes to the activity history

Design constraints:

* Sync remains a user-initiated single-note action; no polling, file watcher push, or batch pull is introduced in P3
* Downloading media is opt-in and never overwrites an existing Vault file with different bytes
* Site-specific IDs remain in the target and baseline stores; portable note properties continue to use slugs or local paths where possible
* Missing SEO or attachment capabilities are visible and do not block core content sync
* Deletion remains a separate manual WordPress or Vault action and never propagates automatically

Acceptance criteria:

* In-sync, local-only, remote-only, diverged, unknown, and remote-missing targets each produce a clear and safe action set
* A normal WordPress block-editor edit can travel back to Obsidian and publish again without duplicate media or invalid blocks
* Supported metadata survives a complete Obsidian -> WordPress -> Obsidian round trip
* Cached local images are restored when unambiguous; unmatched remote images remain valid or download safely when requested
* Every profile on a multi-site note preserves its own target, baseline, media mapping, and result
* No operation writes to either side without an explicit final confirmation

Implementation snapshot (2026-07-21):

* One Sync with WordPress command resolves only stable note/profile targets, fetches a fresh snapshot, classifies all six P3 states, displays field capabilities, and exposes only the safe reviewed action for that state
* Local-only push reuses the existing update pipeline with the exact changed-field set and re-checks the local hash, target link, baseline signature, remote marker, remote field hashes, and state immediately before updating the same post ID
* Remote-only and unknown states route into the guarded pull review, diverged state routes into the reviewed three-way merge, and in-sync or remote-missing states expose no content write action
* Baselines, pull, merge, and transport payloads now support title, body, slug, excerpt, status, comment status, category slugs, WordPress tag names through `wpTags`, featured image, Focus Keyword, and SEO Description while preserving canonical front matter aliases and explicit clears
* WP Publisher Companion 0.3.0 adds authenticated REST and XML-RPC Rank Math reads with per-post capability checks; missing Rank Math or companion support remains a visible field-level limitation rather than blocking core sync
* Remote URLs are restored only when the selected profile's content-hash cache resolves to an unchanged Vault file; unmatched URLs remain valid Markdown unless the user explicitly prepares a download folder and selects the affected field
* Prepared downloads are image-validated and size-bounded, deduplicate by content hash, allocate collision-safe paths, commit only after review, roll back on failure, and are removed by Undo only when their bytes remain unchanged
* Cached media mapping is applied consistently in pull and three-way merge previews without changing the canonical remote URL representation used for divergence and stale-state checks
* Profile media mappings remain bounded and isolated, multi-site target selection is explicit, and no background synchronization, deletion propagation, or unattended conflict choice was introduced
* Automated acceptance passed at that stage with 197 tests, TypeScript validation, translation parity, diff checks, watcher compilation, and a production build; real-site P3-6 acceptance passed on 2026-07-21, and the later alt-versus-figcaption correction plus explicit `caption: =alt` opt-in are covered by exact Markdown regression cases

### P3-7: Synchronize Secondary Title Metadata

Status: Completed; real-site acceptance passed on 2026-07-21

Goal:

* Keep the Secondary Title plugin value consistent between Obsidian and WordPress without embedding metadata markers in the article body

Primary areas:

* [src/front-matter.ts](../src/front-matter.ts)
* [src/editorial-metadata.ts](../src/editorial-metadata.ts)
* [src/wp-rest-client.ts](../src/wp-rest-client.ts)
* [src/wp-xml-rpc-client.ts](../src/wp-xml-rpc-client.ts)
* [src/remote-post.ts](../src/remote-post.ts)
* [src/sync-diff.ts](../src/sync-diff.ts)
* [src/sync-baseline.ts](../src/sync-baseline.ts)
* [src/three-way-merge.ts](../src/three-way-merge.ts)
* [wordpress-companion/wp-publisher-companion/wp-publisher-companion.php](../wordpress-companion/wp-publisher-companion/wp-publisher-companion.php)

Scope:

* Use canonical `secondaryTitle` front matter with `secondary_title` as a read-compatible alias
* Keep `title` as the canonical WordPress main title and use the Obsidian note name only when the property is absent
* Preserve the distinction between a missing subtitle property and an explicitly empty string
* Upgrade WP Publisher Companion to 0.4.0 with authenticated REST and XML-RPC Secondary Title capability, read, and write methods
* Map the Obsidian property to the protected WordPress `_secondary_title` meta key as sanitized plain text
* Add field-level capability and value reporting to normalized snapshots and the remote inspector
* Include the subtitle in publish review, pull selection, sync baselines, divergence classification, and reviewed three-way merge
* Keep WordPress.com and sites without the required plugins visibly unsupported rather than attempting an unsafe metadata write

Design constraints:

* An absent `secondaryTitle` property never clears an existing remote subtitle
* `secondaryTitle: ""` is the explicit request to clear the remote value
* Content-only updates never change the subtitle
* The companion exposes only `_secondary_title`, requires authentication and `edit_post`, and refuses access while Secondary Title is inactive
* Pull and merge writes always normalize the property name to `secondaryTitle` without deleting unrelated front matter

Acceptance criteria:

* A new or existing post receives the value from `secondaryTitle` through application-password REST and XML-RPC profiles
* Editing the subtitle in WordPress can be inspected, pulled, compared, and merged back into the canonical Obsidian property
* Removing the property leaves the remote value untouched, while an explicit empty value clears it
* A `title` property overrides the note filename for the WordPress main title; the filename remains a safe fallback
* Missing or inactive Secondary Title support is visible and does not alter remote metadata

Implementation snapshot (2026-07-21):

* Companion 0.4.0 detects Secondary Title through its public API, exposes one strict protected-meta allowlist, and supports both authenticated transports
* REST and XML-RPC perform the subtitle update only after the core post succeeds and return a partial-failure warning without claiming a sync baseline when metadata fails
* Empty values remain available in remote snapshots instead of being confused with an unsupported field
* The publish modal, preview, inspector, pull review, sync workflow, baseline engine, and conflict resolver now track the subtitle as an independent twelfth field
* Automated acceptance passed at that stage with 197 tests, TypeScript validation, translation parity, and a production build; real-site acceptance passed on 2026-07-21 with no observed defects

### P3 Completion Criteria

Implementation status: Completed. P3-1 through P3-7 have passed staged real-site acceptance. The transport matrix below remains a separate final release-level compatibility gate and does not reopen P3 development.

The remaining release-level transport matrix verifies that:

* A WordPress edit can be fetched, inspected, diffed, and pulled without unreviewed local overwrite
* Common Gutenberg content round-trips through Markdown without invalid blocks or silent content loss
* Local-only and remote-only changes are distinguished from true divergence using a shared baseline
* Conflicts can be resolved without silently dropping either side and stale reviews are rejected
* Metadata and media capabilities degrade visibly per transport
* Undo, retry, activity history, target identity, and multi-site separation remain reliable
* The full workflow passes application-password REST and XML-RPC acceptance tests, plus a miniOrange smoke test when that transport is included in release claims
