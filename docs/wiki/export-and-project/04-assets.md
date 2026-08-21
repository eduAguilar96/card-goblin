---
title: Uploaded assets
status: stable
summary: Bring your own art with no hosting — the Assets drawer, the 2 MB cap, and how uploads are stored.
---

# Uploaded assets

`src:` on an [`Image`](../goblin-script/05-images.md) doesn't have to be a URL. The
**Assets** drawer holds pictures uploaded straight from your machine, so your own
art can go on a card with nothing to host and no link to keep alive.

## The drawer

The **Assets** button in the status bar (with a count badge once you've uploaded
something) opens a drawer where you upload images — drag and drop, or the file
picker. Each upload gets a name, derived from the filename and renameable anytime,
plus a thumbnail and a **Copy ref** button that copies `asset:<name>`, ready to
paste into a `src:` line.

## Referencing an upload

Reference an upload with the `asset:` scheme instead of a URL:

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "asset:dragon_art"
```

Everything about `src:` being a Text expression still applies — an asset reference
works from a sheet column (`src: [art]`) or built with interpolation
(`src: "asset:[art]"`), so different rows can point at different uploads exactly
like different URLs.

Uploads also work *inside text*: `{asset:dragon_art}` in any `Text` or `TextBox`
`text:` draws the upload as an inline icon in a one-em slot — see
[Inline icons](../goblin-script/04-text.md#inline-icons).

If the same colored asset fragment belongs at different positions inside many
spreadsheet descriptions, wrap it in a top-level Text let and place it with
`{alias:name}`. The [resolved-text alias example](../goblin-script/04-text.md#reusing-resolved-text-with-aliases)
uses `{color:#cc2222}{asset:swords}{/color}` so each cell can say, for example,
`Deal 2 {alias:damage_icon}.` without duplicating the asset/color markup.

## The 2 MB cap

**2 MB** per image — enough for card-sized art at print resolution, not a place
for full-resolution photography. The drawer says so if a file is over the limit.

## Renaming only updates the library

Renaming doesn't rewrite `src:` lines for you — rename `dragon_art` to `dragon`
and every `src: "asset:dragon_art"` still says the old name, now pointing at
nothing. Update those references yourself; the compiler's unknown-asset warning
squiggles exactly the `src:` lines that need it, so you won't miss one.
Referencing a name that doesn't exist yet (or anymore) isn't an error, just that
warning — you might be about to upload it.

## Where uploads are stored

Uploads live in this browser's IndexedDB, separately from the code-and-rows
[autosave](02-autosave.md): they save **the moment you upload them**, not on
autosave's one-second debounce, and they survive a reload the same way the rest of
your project does. **Reset to demo** and a project-file **import** both clear your
uploads together with your code and rows — two separate stores under the hood,
cleared as one.

Uploaded assets always embed in an [exported PDF](01-pdf-export.md) — unlike URL art,
they never depend on a host allowing cross-origin use, since the file never leaves
your browser.

[Exporting a project file](03-project-files.md) bundles your uploads into the file
itself — the art, not just a reference to it — so handing someone a
`.cardgoblin.json` hands them the art too. A file exported before uploaded assets
existed has no art in it, and importing one clears your asset library, since
there's nothing in the file to replace it with.

One library per browser profile, alongside the one save slot
[autosave](02-autosave.md) uses. It does not roam to another browser or device;
an exported [project file](03-project-files.md) is the supported way to move it.
