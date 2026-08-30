---
name: VisionIndex Image Text
description: Use when the user asks you to find, read, or work with text that lives inside images — screenshots, scans, photos of whiteboards or documents — in their notes vault ("which screenshot mentioned X", "find the invoice photo", "what did that whiteboard say"). Teaches the on-disk layout the VisionIndex (视觉索引) plugin writes, so you can search the extracted text, point back at the original picture, and never corrupt or duplicate its files.
version: 1.0.0
category: 知识管理
---

# VisionIndex Image Text

The VisionIndex (视觉索引) desktop plugin reads the text printed inside the user's images with the
host vision pipeline and writes it into the notes vault as **ordinary markdown sidecars**. That is the
whole point: because a sidecar is a plain note, the app's global search — and your own
`search_files` / `read_file` tools — can reach words that only ever existed as pixels.

## Where the files live

All paths are vault-relative, inside the plugin's work folder (default **`视觉索引/`**; the user may
have renamed it in the plugin settings — if that folder is missing, look for any folder containing an
`Index/` subtree whose files end in a doubled extension such as `.png.md`):

```
视觉索引/
├── Index/                       ← one sidecar per image, MACHINE-OWNED
│   └── Attachments/2026/board 1.png.md
├── Notes/                       ← the user's promoted copies, HUMAN-OWNED
│   └── board 1-2026-08-14.md
└── .visionindex/index.json      ← derived status cache. Never contains extracted text.
```

**The sidecar path keeps the original extension and appends `.md`.** Strip the trailing `.md` from a
sidecar path and you have the source image path — no lookup table needed. `a.png` and `a.jpg`
therefore never collide.

## Sidecar format

```markdown
---
visionindex: 1
source: Attachments/2026/board 1.png
fp: 3f2a91c7
lang: zh
kind: screenshot
chars: 412
extractedAt: 2026-08-14T02:31:07.000Z
---

# board 1.png

![[Attachments/2026/board 1.png]]

Q3 alignment
1. plugin ecosystem: five mature packages in August
```

- `source` is the **only** pointer back to the picture. Read it from the frontmatter; never try to
  reconstruct the image path from the note title.
- `fp` is a fingerprint of the **source path string**, not a content hash. Do not treat a matching
  `fp` as proof the image is unchanged.
- `kind` is one of `screenshot | scan | photo | diagram | other`; `lang` is the ISO 639-1 code of the
  text in the image (may be empty).
- `truncated: 1` appears when the model's output was cut off — the body is incomplete.

## How to answer "which picture said X"

1. Search the vault for X the ordinary way (`search_files` / the app's global search). Sidecars are
   normal notes, so they show up in the results.
2. If the hit path sits under `<work folder>/Index/`, you found an image, not a note. Read its
   frontmatter `source`.
3. Answer with **both** — the extracted text you found *and* the `source` image path — so the user
   can open the picture. Say plainly that the text came from an image the plugin transcribed.
4. If nothing matches, say so and mention that only folders the user ticked in the Scan Queue have
   been read; unindexed images are invisible to search. Do not guess at file names.

## Rules you must not break

- **Never write anything into `.visionindex/`.** It is a derived cache the plugin rebuilds at will;
  hand-edited state is either ignored or lost, and putting text there would hide it from search —
  the exact failure this plugin exists to prevent.
- **Editing a sidecar under `Index/` is pointless**: the plugin owns those files and a rescan
  overwrites them wholesale. If the user wants to keep or edit that text, tell them to use the
  plugin's **Promote to note** action first (it copies the body into `Notes/` without the plugin
  frontmatter and marks the image `promoted`, after which no scan touches it again). If they insist
  you write it yourself, write a **new** file under `Notes/`, never inside `Index/`.
- **Never fabricate a transcription.** If an image has no sidecar, it has not been read. Say it is
  unindexed and point the user at the Scan Queue; do not describe the picture as if you had read it.
- **Do not mass-create sidecars yourself.** Path layout, budget gate and idempotence live in the
  plugin; files you write by hand will be overwritten or double-counted.
