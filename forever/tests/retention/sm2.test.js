import assert from 'node:assert/strict';
import test from 'node:test';

import { initialCard, review, deckFromQuestions, dueCards } from '../../lib/retention/sm2.js';
import { hintLadder } from '../../lib/generation/practice/variation-engine.js';

const DAY = 86400000;

test('SM-2 canonical trajectory: perfect recall gives 1, 6, then easiness-scaled intervals', () => {
  let card = initialCard();
  card = review(card, 5, { now: 0 });
  assert.equal(card.intervalDays, 1);
  card = review(card, 5, { now: card.dueAt });
  assert.equal(card.intervalDays, 6);
  card = review(card, 5, { now: card.dueAt });
  assert.equal(card.intervalDays, 17); // 6 * 2.8 (easiness 2.5 -> 2.6 -> 2.7 -> 2.8 with each q=5), rounded
  assert.ok(card.easiness > 2.5);
});

test('a lapse resets repetitions to tomorrow but keeps the easiness memory of past struggle', () => {
  let card = initialCard();
  card = review(card, 5, { now: 0 });
  card = review(card, 5, { now: card.dueAt });
  const before = card.easiness;
  card = review(card, 1, { now: card.dueAt }); // failed recall
  assert.equal(card.intervalDays, 1);
  assert.equal(card.repetitions, 0);
  assert.ok(card.easiness < before, 'easiness must drop after a lapse');
  assert.ok(card.easiness >= 1.3, 'easiness never falls below the SM-2 floor');
});

test('deck plumbing: questions become cards, only due cards surface', () => {
  const deck = deckFromQuestions([
    { id: 'q1', prompt: 'p1', answer: 1 },
    { id: 'q2', prompt: 'p2', answer: 2 },
  ]);
  assert.equal(dueCards(deck, { now: 0 }).length, 2); // new cards are due immediately
  deck[0].card = review(deck[0].card, 5, { now: 0 });
  assert.equal(dueCards(deck, { now: 0 }).length, 1);
  assert.equal(dueCards(deck, { now: DAY + 1 }).length, 2);
});

test('graduated hints NEVER disclose the answer before level 5', () => {
  const hints = hintLadder({ label: 'price elasticity of demand', expr: 'pct_qty / pct_price', answer: -1.2, columns: ['price', 'qty'] });
  assert.equal(hints.length, 5);
  for (const h of hints.slice(0, 4)) {
    assert.ok(!h.hint.includes('-1.2'), `level ${h.level} leaks the answer: ${h.hint}`);
  }
  assert.ok(hints[4].hint.includes('-1.2'), 'level 5 must give the worked answer');
  // level 3 shows the SHAPE, not the indices — structure without the plug-in values
  assert.ok(hints[2].hint.includes('pct_qty / pct_price'));
});
