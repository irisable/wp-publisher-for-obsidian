# Release Checklist

This checklist separates automated correctness from the WordPress and Obsidian
behavior that still requires a real installation. Complete it for every public
release.

## Release Identity

- [ ] The manifest ID is community-plugin compatible and matches the intended
  installation identity.
- [ ] Manifest and package authorship belongs to this fork; funding metadata is
  either owned by the maintainer or omitted.
- [ ] `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`
  contain the same release version and minimum Obsidian version.
- [ ] The Git tag exactly matches `manifest.json` without a `v` prefix.
- [ ] WordPress.com remains excluded from release support unless a future
  release introduces a fork-owned secure OAuth design.

Use this command to synchronize version files without committing or tagging:

```bash
npm run version:set -- 1.0.0
```

## Automated Gates

- [ ] Install from the lock file with `npm ci`.
- [ ] Run `npm run check`.
- [ ] Run `npm run release:check`.
- [ ] Confirm lint, all behavioral tests, TypeScript validation, production
  bundling, documentation links, translation parity, command parity, required
  assets, and Companion ZIP parity pass.
- [ ] Run an online dependency audit only after explicitly approving the npm
  registry request and review every production-relevant finding.
- [ ] Run `php -l` on
  `wordpress-companion/wp-publisher-companion/wp-publisher-companion.php`.

## Clean Installation

- [ ] Install only `main.js`, `manifest.json`, and `styles.css` into a new test
  Vault folder named after the final manifest ID.
- [ ] Reload Obsidian and enable the plugin without the legacy
  `obsidian-wordpress` plugin active.
- [ ] Open settings, add and edit a profile, close the editor, and confirm no
  button remains in a busy state.
- [ ] Verify temporary credentials are not retained after restart when the
  remember toggles are disabled.
- [ ] Confirm desktop and mobile loading if `isDesktopOnly` remains `false`.

## Transport Matrix

Run the complete row for Application Password REST and XML-RPC. miniOrange
shares the core REST workflow but still requires an authentication smoke test
when it is included in release claims. WordPress.com is outside the 1.0 matrix.

| Workflow | Application Password REST | XML-RPC | miniOrange |
| --- | --- | --- | --- |
| Validate credentials and capabilities | [ ] | [ ] | [ ] |
| Create draft and scheduled post | [ ] | [ ] | [ ] |
| Full and content-only update | [ ] | [ ] | [ ] |
| Gutenberg and classic HTML output | [ ] | [ ] | [ ] |
| Categories, tags, excerpt, slug, and featured image | [ ] | [ ] | [ ] |
| Rank Math and Secondary Title capability fallback | [ ] | [ ] | [ ] |
| Media reuse, stale-cache recovery, and metadata | [ ] | [ ] | [ ] |
| Inspect and pull remote changes | [ ] | [ ] | [ ] |
| Local-only push and remote-only pull | [ ] | [ ] | [ ] |
| Diverged three-way merge and stale-review rejection | [ ] | [ ] | [ ] |
| Undo, retry, history, and multi-site isolation | [ ] | [ ] | [ ] |

## Data Safety

- [ ] Existing front matter survives publish and reviewed pull operations.
- [ ] Only plugin-owned relationship and activity fields are written
  automatically.
- [ ] Categories remain portable slugs and unrelated tags are preserved.
- [ ] Pull and merge never write before confirmation.
- [ ] Rollback and undo move created media to trash rather than permanently
  deleting it.
- [ ] `data.json`, credentials, tokens, local paths, post bodies, and private
  site URLs are absent from Git changes and release assets.

## Companion And Packaging

- [ ] Install the packaged Companion ZIP on a clean WordPress test site.
- [ ] Confirm its header version, constant, stable tag, and ZIP contents match.
- [ ] Verify every Companion route rejects unauthenticated requests and checks
  the relevant edit capability.
- [ ] Inspect the generated plugin ZIP and all three loose Obsidian assets.
- [ ] Verify `SHA256SUMS.txt`.
- [ ] Review the automatically created draft GitHub release before publishing.

## Submission

- [ ] Confirm README installation, privacy, network, and support statements
  describe the actual release.
- [ ] Confirm the changelog has a dated release heading and no unsupported
  claims.
- [ ] Install once from the draft release assets rather than the working tree.
- [ ] Publish the GitHub release only after all applicable checks above pass.
- [ ] Submit or update the Obsidian community-plugin entry only after the draft
  release installation succeeds.
