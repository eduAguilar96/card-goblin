---
title: QR codes
status: stable
summary: The Qr element — scannable codes generated straight from sheet data.
---

# QR codes

```goblin
Qr:
  x: 2
  y: 2
  size: 6
  data: [code]
```

`data:` is a text [expression](expressions.md), so the code can come straight from a
sheet column (`data: [code]`), be interpolated (`data: "https://example.com/[code]"`),
or be computed with a conditional — the usual coercions apply.

## The idiom: one QR per card, on the back

The point of a card's QR is usually to let a companion app scan it and act — a
cross-media game where the app is out of scope for CardGoblin, but the code on the
card is exactly what it needs. Because `Back:` templates evaluate per card just like
`Front:` templates (every card sees its own row's data), a `Back:` template needs
nothing extra to give every card in the deck a different code:

```goblin
Qr:
  x: 2
  y: 2
  size: 16
  data: [code]
```

Those four lines — `x y size data` — are the whole idiom: a Text column of codes in
your sheet, one `Qr:` block in a `Back:` template, and every card's back carries its
own scannable code.

## `level:` — error correction

QR codes carry redundant data on purpose, so a code still scans even partly
obscured, scratched, or printed small. `level:` picks how much:

| `level:` | What it does |
|---|---|
| `l` | roughly 7% of the code can be damaged and it still scans |
| `m` | roughly 15% — **the default** |
| `q` | roughly 25% |
| `h` | roughly 30% — the most damage-tolerant, at the densest code for the same data |

A higher level may need a bigger code for larger payloads (more of the code's
capacity goes to redundancy instead of your content, so less room is left for
`data:` at a given size) — a short code (a plain URL, a short id) is often the same
size at every level, but the difference shows up once the content pushes against a
level's capacity. Worth raising for a code that'll be printed small or handled
roughly, and safe to leave at the default otherwise.

## The quiet zone lives inside the box

Every QR code needs a plain border — the **quiet zone** — around the modules for a
scanner to find it. `size:` is the side of the box you declare, and the quiet zone is
drawn **inside** it, in `background:`, so an adjacent shape can never crowd a code's
scan margin just by sitting close on the card. The box you draw is exactly the box a
scanner sees.

## When the data doesn't fit

Every QR code has a capacity ceiling, set by `level:` (higher levels hold less
content at a given size) — a code has a limit past which no code can be built at all,
no matter how large. `data:` that exceeds it is a **QR data is too long for one
code** error, and the card renders as a placeholder, the same "this one card's data
was the problem" isolation every other data-time error gets — the rest of the deck is
unaffected. An empty `data:` is not this case: it encodes as a normal, valid, tiny
code — there's nothing special about zero-length data.
