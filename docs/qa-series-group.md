# Content Group QA - 2026-09-15

## Environment

- Repository: this WP Publisher checkout.
- Obsidian vault: a dedicated local test vault.
- Profile: a dedicated LAN WordPress test station.
- WP Title Layer: `1.0.0-rc.3`, installed by the user and verified active.
- REST post schema exposes `meta.wptl_series_group` as a string.
- Publisher: unreleased working tree based on `1.1.2`; rebuilt and reloaded
  in the test vault. No production writes, commit, tag, or release.

## Live Workflow Results

Publishing, pulling, merging, and undo were exercised through the actual
Obsidian plugin UI. Authenticated REST reads verified WordPress results.
Only dedicated QA drafts/groups were mutated for test setup.

| Scenario | Result |
| --- | --- |
| Create with `seriesGroup` and season 1 | PASS: group saved and read back; custom front matter retained. |
| Same label in the same series/season | PASS: second draft reused group 150; no duplicate. |
| Omit `seriesGroup` on update | PASS: remote group retained; missing note property remained missing. |
| Explicit `seriesGroup: ""` | PASS: remote group cleared; series and season unchanged. |
| Uniform rename, then publish old alias | PASS: group 150 reused; canonical label returned to the note. |
| Same label in another season | PASS: season 2 created group 151, separate from season 1 group 150. |
| Remote-only group edit, then pull | PASS: group appeared as an independent selectable field; only that field was applied. |
| Merge publish with an old alias | PASS after QA fix: canonical label written locally and new shared baseline established. |
| Undo after canonical merge writeback | PASS: pre-merge local alias restored; remote merge result retained as expected. |
| Pull after undo | PASS: canonical label restored locally; UI reported both sides consistent. |

## Retained Fixtures

All three posts remain drafts on the local test station. Notes are under
`QA/` in the test vault for manual inspection.

| Note | WordPress post ID | Final state |
| --- | --- | --- |
| `2026-09-15-season-group-A.md` | 1181657 | Season 1; explicitly empty group. |
| `2026-09-15-season-group-B.md` | 1181659 | Season 1; canonical group 150; both sides consistent. |
| `2026-09-15-season-group-C.md` | 1181661 | Season 2; separate group 151. |

## QA Fix And Automated Coverage

Independent code review found that merge publishing used
`writeBackToNote: false` and therefore missed canonical group writeback.
The fix performs guarded canonicalization before baseline/history recording,
updates the merge restore snapshot hash, and preserves exact undo behavior.
Concurrent edits and persistence failures produce partial completion rather
than overwriting the note or incorrectly advancing the baseline.

- `npm run check`: PASS; lint, all 271 tests, TypeScript, production build.
- `git diff --check`: PASS.
- Nine new merge-writeback regression tests cover canonicalization, explicit
  empty values, omitted/unselected fields, failed readback, concurrent edits,
  restore persistence failures, baseline updates, and exact undo.
- Existing content-group tests cover validation, metadata merging, schema
  gating, transport restrictions, guarded normal writeback, and pull/merge
  field behavior.

Concurrency/failure injection and unsupported-server behavior were tested
with automated adapters, not by disrupting the live NAS server. No downgrade
or production-station acceptance test was performed.
