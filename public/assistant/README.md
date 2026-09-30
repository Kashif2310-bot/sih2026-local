# Advisor portrait

| File | Purpose |
| --- | --- |
| `advisor-base.webp` (1024×1024) | Closed-mouth portrait, shown in every state |
| `advisor-mouth-mid.webp` (224×176, alpha) | Slightly parted lips, layered at x 378, y 396 |
| `advisor-mouth-open.webp` (224×176, alpha) | Open "aa" mouth, same position |

All three frames are AI-generated images of the same (fictional) woman. The mouth
patches are cut from full-frame variants of the base and feathered, so they line up
with it exactly.

While the assistant is speaking, the mouth layers' opacity follows the level of the
Gemini audio that is audible at that moment (see `src/assistant/avatar/mouth.ts`).
This is amplitude-driven mouth movement, not phoneme-accurate lip sync: it opens on
real syllables and closes on silence, at the last sample and on interruption.
