export const PERSONA_PACES = Object.freeze(['slow', 'moderate', 'fast']);

// Personas are SYNTHESIZED per course (universality mechanism #1, FEATURES.md §2) —
// this contract validates shape only; content is always dynamic.
export function validateTeacherPersona(persona) {
  if (!persona.id?.trim()) throw new Error('persona.id is required');
  const context = `persona ${persona.id}`;
  if (!persona.subject?.trim()) throw new Error(`${context}.subject is required`);
  if (!persona.displayName?.trim()) throw new Error(`${context}.displayName is required`);
  requireStringList(persona.teachingConventions, `${context}.teachingConventions`);
  requireStringList(persona.boardNotationHabits, `${context}.boardNotationHabits`);
  requireStringList(persona.exampleGenres, `${context}.exampleGenres`);
  requireStringList(persona.misconceptionPatterns, `${context}.misconceptionPatterns`);
  if (!persona.voiceStyle?.register?.trim()) throw new Error(`${context}.voiceStyle.register is required`);
  if (!PERSONA_PACES.includes(persona.voiceStyle.pace)) {
    throw new Error(`${context}.voiceStyle.pace must be one of ${PERSONA_PACES.join(', ')}`);
  }
  return persona;
}

function requireStringList(value, context) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${context} must be a non-empty array`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`${context} entries must be non-empty strings`);
  }
}
