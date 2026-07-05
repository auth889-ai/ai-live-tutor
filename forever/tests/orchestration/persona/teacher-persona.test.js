import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTeacherPersona } from '../../../lib/orchestration/persona/teacher-persona.js';

function validPersona() {
  return {
    id: 'persona_chem_001',
    subject: 'Organic Chemistry',
    displayName: 'Dr. Reaction',
    teachingConventions: ['Draw the mechanism before naming it'],
    boardNotationHabits: ['Curved arrows for electron movement'],
    exampleGenres: ['Lab-bench scenarios'],
    misconceptionPatterns: ['Students push arrows from atoms instead of electrons'],
    voiceStyle: { register: 'warm and precise', pace: 'moderate' },
  };
}

test('a synthesized subject persona passes', () => {
  validateTeacherPersona(validPersona());
});

test('a persona without misconception patterns is rejected', () => {
  const persona = validPersona();
  persona.misconceptionPatterns = [];
  assert.throws(() => validateTeacherPersona(persona), /misconceptionPatterns/);
});

test('a persona with an unknown pace is rejected', () => {
  const persona = validPersona();
  persona.voiceStyle.pace = 'frantic';
  assert.throws(() => validateTeacherPersona(persona), /pace/);
});
