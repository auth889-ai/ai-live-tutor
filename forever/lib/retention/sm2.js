// SM-2 SPACED REVIEW — the registers' "SM-2 spaced retention per student" made real, and
// the IntelliCode-validated core of every serious tutor's review scheduler. Pure function,
// zero tokens, deterministic: the classic SuperMemo-2 recurrence over (easiness,
// repetitions, interval) driven by recall quality 0-5.
//
//   quality >= 3: successful recall — interval grows (1, 6, then interval * easiness)
//   quality <  3: lapse — repetitions reset, review tomorrow, easiness keeps its memory
//
// The caller owns time: pass `now` (ms) in, get `dueAt` out — nothing here reads a clock,
// so scheduling is replayable and testable to the millisecond.

const MIN_EASINESS = 1.3;

export function initialCard() {
  return { easiness: 2.5, repetitions: 0, intervalDays: 0 };
}

export function review(card, quality, { now = 0 } = {}) {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  const easiness = Math.max(
    MIN_EASINESS,
    card.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );
  if (q < 3) {
    return { easiness, repetitions: 0, intervalDays: 1, dueAt: now + 1 * 86400000 };
  }
  const repetitions = card.repetitions + 1;
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(card.intervalDays * easiness);
  return { easiness, repetitions, intervalDays, dueAt: now + intervalDays * 86400000 };
}

// A lesson's review deck: every checkpoint/practice answer becomes a card. Deterministic
// ids let progress survive lesson regeneration (same question id -> same card).
export function deckFromQuestions(questions) {
  return questions.map((q) => ({ id: q.id, prompt: q.prompt, answer: q.answer, card: initialCard() }));
}

export function dueCards(deck, { now }) {
  return deck.filter((entry) => (entry.card.dueAt ?? 0) <= now);
}
