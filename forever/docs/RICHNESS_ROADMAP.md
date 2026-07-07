# Richness roadmap — closing the gap to Abdul Bari / Striver / Ng

Research-grounded (manim-voiceover bookmarks; Azure WordBoundary / ElevenLabs character
timestamps; TheoremExplainAgent's failure analysis arXiv:2502.19400; Code2Video's anchor
grid arXiv:2510.01174; LASEV's rubric-critique ablation arXiv:2602.11790 — 52%→92%
publishable; Mayer's signaling + temporal-contiguity principles; arXiv:2505.02966 word-level
highlight sync, F1>92%). What's DONE vs NEXT:

## Done (in the pipeline today)
- Rubric-guided Pedagogy Critic (the literature's biggest measured lever): concrete-before-
  abstract, depth-for-role, VISIBLE REFERENT (every spoken claim shown on the board),
  wrong-path-shown, one-idea-right-device, screenshot-able notes.
- Step-level voice↔animation sync that cannot drift (narration === trace step explanation,
  one audio clock, timeline reconciled to real audio).
- Real execution traces only (hand-authored animation stripped structurally).

## Next, in impact order
1. WORD-ANCHORED ACTIONS (manim-voiceover bookmark pattern). Voice Writer embeds inline
   marks in narration ("watch the <mark id='hl_mid'/> middle element"); the reconciler
   resolves each mark to audio time via ElevenLabs character timestamps (already returned by
   synthesizeWithTimestamps, currently unused) or CosyVoice word_timestamp_enabled; the
   action engine fires highlights/pointer moves AT THE WORD, not at line start. This is
   Mayer's temporal contiguity, mechanically enforced.
2. PERSISTENT ACCUMULATING BOARD (the Abdul Bari signature). Scenes append and annotate on
   one canvas — problem + diagram + trace stay visible, later steps draw arrows over earlier
   writing, non-focused regions DIM (never clear). Enables "remember when we..." callbacks.
   Layout by NAMED ANCHOR SLOTS (Code2Video's 6x6 grid); overlap = hard validation failure
   (raters punish even brief occlusions, aesthetics↔learning r=0.971).
3. STABLE COLOR = SEMANTIC ROLE. Pointer i is always one color, comparisons another,
   eliminations another — a persistent signaling channel across the whole course.
4. PROSODY + PAUSES. Deliberate beat after every question ("pause and think — where can the
   answer NOT be?"); reassurance at hard moments. Prompt-level in the Voice Writer.
