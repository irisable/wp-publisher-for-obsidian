# MP3 embed acceptance

## Local regression checks - 2026-09-19

- `npm run check`: lint, 287 tests, type checking and production build passed.
- Both `![[audio/file.mp3]]` and `![](file.mp3)` render native `core/audio`
  blocks with attachment IDs when known, `controls` and `preload="none"`.
- Upload orchestration tests verify reuse by content across both syntaxes;
  changed content with the same filename uploads a new attachment.
- Existing image regression tests pass.
- Build SHA256: `07541a87ab5b312ead0e03d3fc30320a4e6e744bbf1061f16b039e6e0f2992d6`.

## Real publication acceptance - reported 2026-09-19

Reported by coordinating task `01a0b059-93ee-7c21-a13a-4c62cc6b7fc0`:

- Reloaded the local development plugin by disabling and enabling it.
- Published HOME-04 twice through the Obsidian UI using Content only and the
  ordinary `![](marriage-forgiveness-and-repair.mp3)` embed.
- Both results contained `core/audio`, attachment ID `1206800`, and preload
  `none`. Both reused the existing `-1.mp3` attachment; no media were added.
- Both published bodies were identical to each other. Compared with the
  baseline, four h2 blocks gained explicit `level:2` attributes and two img
  tags changed from self-closing to ordinary HTML syntax. Non-audio content
  matched after normalizing these serialization differences; body text,
  images and their attributes were preserved. Title, featured media, tags,
  categories, meta and excerpt matched the baseline.
- The site's player enhancement worked; playback at 1.25x reached 0:21 and
  was paused. The note retains its ordinary embed, not protected source.

The coordinating task supplied this evidence location:
the coordinating writing project's private HOME-04 audio-retest evidence README.
The evidence README was subsequently available and read after the coordinating
task corrected the serialization comparison. Real-site UI actions and playback
results remain attributed to that task, not independently repeated here.
No production changes were made while recording acceptance.

These historical results describe the development candidate, not a release record.

## MP3 metadata follow-up

MP3 embeds use the same adjacent metadata comment as images:

```markdown
![](audio/reading.mp3)
%% wp-media
title: Article reading
caption: 收听本文
description: Narrated version of this article.
%%
```

- The same syntax works after an Obsidian wiki embed or a remote MP3 URL.
- Local upload and cached reuse apply title, caption and description through
  the shared attachment metadata mechanism. Audio excludes image-only alt text.
- Only the explicit caption becomes the native audio block's figcaption;
  attachment title is not prepended. No caption means no figcaption, not an
  inferred audio type. Authors should supply captions by convention, such as
  `收听本文` for narration or `黑鸭子演唱版` for that performance. Missing captions
  are not a new publication validation error.
- Remote references never upload a new file. An exact URL or known URL alias
  in the current profile's media cache allows attachment metadata updates.
  Without that mapping, the block caption is still rendered, but a metadata
  warning reports the missing attachment ID. No filename-based ID guessing or
  new manual attachment-binding field is introduced.
- Successful updates are cached to avoid redundant metadata writes; failed
  updates remain retryable. Image caption behavior is unchanged.
- This change targets native block output; it does not add caption rendering
  to the existing Classic HTML compatibility path or alter the site player.

Automated coverage includes both embed syntaxes, local upload/reuse metadata,
mapped and unmapped remote references, failed metadata updates, caption HTML
escaping, and no implicit caption derived from alt text. Real-site acceptance
of this metadata follow-up remains pending.
