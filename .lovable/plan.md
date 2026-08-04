# File block shows 0 B — diagnosed

## What is actually wrong

The uploaded file's metadata is being erased right after it is written. I read the stored block for the page you are on:

```json
{ "id": "Sd2IpV0R88", "type": "file",
  "path": ".../files/c5171eaf-....pdf",
  "text": "", "open": false, "checked": false }
```

`fname`, `fsize`, `fmime`, `fby`, `fat` are all gone — so the card renders size `0 B`. The file itself uploaded fine; only its description was lost.

Cause: the upload writes twice. First patch (filename, size, mime, author, date) applies immediately. When the upload resolves, the second patch (`path`) is applied by a callback captured *before* the first patch landed, so it merges into the pre-upload blocks array and overwrites the metadata away. Classic stale-closure write in `updateBlock`, which maps over the `blocks` value from the render that started the upload.

## The fix

1. Make `updateBlock` in `src/components/page-editor-body.tsx` merge against the *current* blocks, not the render-time snapshot — a `blocksRef` kept in sync, read inside `updateBlock`. This is the real bug and it affects every async patch, not just files (image/imagerow upload completion has the same shape).
2. In `src/components/file-block.tsx`, make the completion patch carry the full metadata alongside `path`, so a single write is self-sufficient even if a patch is dropped. Same for the replace path.
3. Add a defensive fallback in the card: if `fname` is missing but `path` exists, derive the display name and type from the storage path's extension, and omit the size line rather than printing `0 B`. A card should never claim a file is empty.
4. Tests: a unit test that a delayed second patch does not clobber an earlier patch, plus a DOM test that a completed upload still shows name, badge and size.

## Your existing block

The metadata for that one already-uploaded PDF is unrecoverable beyond its extension (only the path survived). After the fix, it will render as a PDF card with no size; re-attaching the file restores the full line. No migration, no SQL.

## Files to change

- `src/components/page-editor-body.tsx` — ref-based `updateBlock`
- `src/components/file-block.tsx` — full-metadata completion patch, path-derived fallback
- `src/lib/file-ops.ts` — helper to derive a display name from a storage path
- tests alongside the above

## Any file type

Already true and staying true: the picker has no `accept` filter, the bucket's mime restriction is off, and validation is size-only (25 MB) — PNGs, ZIPs, videos, anything uploads today. What is thin is *recognition*: only 16 extensions map to a tint and icon; everything else falls to the grey generic tile.

So the type table grows, using existing palette pairs only:

- images: `webp`, `avif`, `heic`, `bmp`, `tiff`, `ico` → image tile, purple
- archives: `rar`, `7z`, `tar`, `gz`, `tgz` → zip tile, amber
- sheets/docs: `ods`, `odt`, `rtf`, `pages`, `numbers` → matching doc/sheet tiles
- data & code: `json`, `xml`, `yml`, `yaml`, `sql`, `ts`, `tsx`, `js`, `css`, `html`, `sh` → code tile (`<>` glyph), sunken/secondary
- media: `mp4`, `mov`, `webm` → video tile; `mp3`, `wav`, `m4a` → audio tile — both blue
- design: `psd`, `ai`, `sketch`, `fig` → generic tile, pink

Two new tile glyphs are needed for video and audio (single-path, 24 grid, 1.8 stroke, matching the set) plus the code glyph reusing the existing `<>` mark. Anything still unmapped keeps the generic tile and the uppercased 4-char badge — never blank.

`OPENABLE_EXTS` gains only what a browser genuinely renders in a tab: `webp`, `avif`, `bmp`, `ico`, `json`, `xml`, `html`, `mp4`, `webm`, `mp3`, `wav`. `heic`, `psd`, `zip`, `docx` and friends stay download-only, for the reason already in the code comment.

Not in scope unless you ask: inline previews (image thumbnails in the tile, an audio player, a video frame). That is a different block, not a smarter card.
