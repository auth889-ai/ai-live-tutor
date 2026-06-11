"""
google_agent/generation/teaching_principles.py
===============================================================================
THE LAWS OF WORLD-BEST EXPLANATION — wired in, not wished for.

Sources (researched 2026-06-11):
- Rosenshine, "Principles of Instruction" (American Educator 2012) — distilled
  from cognitive science + direct observation of MASTER TEACHERS whose
  students made the highest measured gains.
- Cognitive Load Theory (Sweller) — worked-example effect: novices learn more
  from step-by-step worked examples than from problem-solving; working memory
  is small, so small steps + no extraneous load.
- Dual Coding (Paivio) — visual + verbal channels stored separately but
  linked; coordinated image+speech beats either alone; avoid split attention.
- Feynman technique / intuition-first (3Blue1Brown style) — plain language,
  concrete before abstract, analogy as the bridge, "if you can't explain it
  simply you don't understand it".

Wiring:
  EXPLANATION_PRINCIPLES → injected into every segment-generation prompt
  CRITIC_RUBRIC          → the segment critic grades against these, item by item
Same laws teach the generator and judge its output — craft becomes enforceable.
===============================================================================
"""

from __future__ import annotations

# ── Injected into every segment-generation prompt ────────────────────────────

EXPLANATION_PRINCIPLES = """THE LAWS OF EXPLANATION (evidence-based — follow ALL):

R1 SMALL STEPS (Rosenshine #2, Cognitive Load Theory):
   Present ONE new idea per screen. Working memory is small — never combine
   two new concepts on one screen. Sequence: easiest version first.

R2 INTUITION BEFORE FORMALISM (Feynman):
   Concrete experience -> analogy -> THEN the technical term and definition.
   A beginner must FEEL the idea before naming it. Plain language always
   available alongside any formal language.

R3 WORKED EXAMPLES FIRST (worked-example effect):
   For anything procedural, show a COMPLETE worked example step by step
   BEFORE asking the student to do anything. Fade support gradually:
   full example -> completion problems -> independent.

R4 DUAL CODING (Paivio):
   Every key idea gets BOTH a visual element AND voice that talks ABOUT
   that visual at the moment it appears (boardActions synced to voiceover).
   Never voice about one thing while showing another (split attention).

R5 ASK, DON'T JUST TELL (Rosenshine #3, #6):
   Frequent questions — process questions ("WHY is this safe?") not just
   facts. The checkQuestion must require thinking, not recall of a phrase.

R6 SUCCESS RATE ~80% (Rosenshine #7):
   Checks should be winnable by a student who followed — confidence fuels
   learning. Save the hard twist for challenge screens, clearly framed.

R7 ANTICIPATE THE ERROR (master-teacher practice):
   Name the mistake students are ABOUT to make before they make it
   ("you might think X — watch what happens"). Misconceptions are
   teaching opportunities, scheduled, not accidents.

R8 CONNECT FORWARD AND BACK (Rosenshine #1, #10):
   Open by linking to what was just learned; close by naming what this
   enables next. No orphan screens.

R9 THE EXPERIENCE OF DISCOVERY:
   Where possible, set up the observation and let the STUDENT draw the
   conclusion one beat before the teacher states it ("...so what do you
   think happens to the old rows?" -> reveal).

R10 NO WASTED INK (extraneous load):
   Every element on the board earns its place. Decoration never near
   content. Text on board = anchors and structure; the TEACHER'S VOICE
   carries the prose.

R11 FULL BOARD, CONCRETE DATA (master-teacher density):
   A world-best teacher's board is FULL: real example values (names,
   numbers, actual rows — "order 1001, Rafi, Mouse, 500"), labeled
   arrows pointing at specific things, annotations beside diagrams,
   a teacher note at the bottom. NEVER a sparse board with two thin
   sentences. Every table_drawing carries REAL rows. Every diagram
   has labeled parts. Abstract placeholders ("some value", "an item")
   are FORBIDDEN — invent concrete, realistic example data."""


# ── Graded by segment_critic, item by item, 0-10 overall ─────────────────────

CRITIC_RUBRIC = [
    {
        "id": "small_steps",
        "principle": "R1",
        "question": "Does each screen introduce at most ONE new idea, in a sensible easiest-first sequence?",
    },
    {
        "id": "intuition_first",
        "principle": "R2",
        "question": "Do new technical terms arrive AFTER a concrete hook or analogy that makes them feel obvious?",
    },
    {
        "id": "worked_examples",
        "principle": "R3",
        "question": "Is procedural content shown as complete worked steps (dryRun) BEFORE any student attempt, with support fading across the segment?",
    },
    {
        "id": "dual_coding",
        "principle": "R4",
        "question": "Does the voiceover talk about the visual elements at the moments boardActions reveal them (no split attention)?",
    },
    {
        "id": "questioning",
        "principle": "R5",
        "question": "Are there genuine process questions (why/how), and does checkQuestion require thinking rather than echoing a phrase?",
    },
    {
        "id": "success_calibration",
        "principle": "R6",
        "question": "Would a student who followed the segment succeed (~80%) on its checks?",
    },
    {
        "id": "error_anticipation",
        "principle": "R7",
        "question": "Is at least one likely mistake named and defused where the contract's misconceptions are relevant?",
    },
    {
        "id": "connection",
        "principle": "R8",
        "question": "Does the segment connect back to prior learning and forward to what's next (no orphan screens)?",
    },
    {
        "id": "discovery",
        "principle": "R9",
        "question": "Is there at least one moment where the student is set up to see the conclusion before it is stated?",
    },
    {
        "id": "economy",
        "principle": "R10",
        "question": "Is every board element purposeful — structure on the board, prose in the voice?",
    },
    {
        "id": "board_density",
        "principle": "R11",
        "question": "Is the board FULL like a master teacher's — concrete example data (real names/numbers/rows), labeled arrows, annotations — never two thin sentences floating in space?",
    },
    {
        "id": "accuracy",
        "principle": "domain",
        "question": "Is every technical claim, code semantic, calculation, or step exactly correct?",
    },
    {
        "id": "source_fidelity",
        "principle": "grounding",
        "question": "Does the teaching faithfully represent what the source document actually says?",
    },
]


def rubric_prompt_block() -> str:
    return "\n".join(
        f"{i + 1}. [{item['id']}] {item['question']}"
        for i, item in enumerate(CRITIC_RUBRIC)
    )
