# Publish Modal Loading QA

Date: 2026-09-10. Local development build based on 1.1.0; not a new release.

## Automated Verification

`npm run check` passed: ESLint, 252 tests, TypeScript validation, and production build. `git diff --check` passed.

New regression coverage exercises the real publish modal with delayed data sources through a small Obsidian UI adapter, plus the request lifecycle and selected-category fetch helpers:

* The form renders before remote responses resolve; available fields remain editable.
* Initial requests use selected category references and a selected Series slug, or skip the Series collection when absent.
* Completing requests preserves the same excerpt input and its edited value, as well as subtitle and SEO values.
* Searching loads additional categories once, retains the search input, and does not restore a category the user unchecked.
* Responses for an earlier post type cannot replace the current type's Series or subtitle capabilities.
* Missing categories require an explicit decision; request errors support retry without resetting the form.
* Closing prevents late responses from recreating controls or triggering more loads.
* Category lookup preserves ancestors and deprecated terms and terminates safely on cycles.

## Obsidian And NAS Verification

Used the existing `test-vault` linked to this repository and its configured NAS test profile. The production vault's separately installed plugin was not changed.

* Opened the ribbon publish flow and observed the form while remote settings were still loading.
* Edited the excerpt in the form and verified that loading completion and subsequent local preview preserved it.
* Searched categories and Series; observed additional choices load, including a deprecated child category with its hierarchy.
* Selected a different Series and verified the Season selector appeared and local preview reflected the selection.
* Rebuilt and reloaded the plugin, then confirmed the browse buttons disappear after the full catalog is requested.
* Closed the preview and publish form. The original note properties remained visible and unchanged.
* Created a separate acceptance note and published it as a draft to the NAS test site. WordPress returned post ID `1181630`; the note retained `title`, `categories`, and `wpTags`, then received `wpProfile`, `wpPostId`, `wpPostType`, publish activity fields, `series: my-new`, and `seriesSeason: 1`.
* Opened the plugin's strictly read-only Remote Inspector. The normalized WordPress snapshot reported Gutenberg content, Draft status, category `测试分类`, tag `WP Publisher QA`, and Series `my-new`. The publish pipeline completed its authenticated Series readback without a partial-failure warning, confirming the selected Season placement was accepted.

## Manual Acceptance And Limits

The requested independent tester agent could not start because of its usage limit; this record describes the primary agent's automated and UI verification, not independent QA.

One draft article was created on the NAS test site for acceptance; production was not touched. Mobile UI, XML-RPC UI, production-site latency, and a large production catalog were not retested. Search currently loads the full catalog on first use and filters locally for that dialog; it is not a server-side paged search.

The user completed the final interaction check on 2026-09-11 and accepted the immediate-open behavior, loading states, browse controls, and search interaction. This change remains unreleased until a later version is explicitly prepared.
