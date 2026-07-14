// Interactive quiz board object (pure, tested). A checkpoint MCQ that PAUSES the lesson,
// the student answers, and gets the correct answer + a worked explanation. Every question
// is answerable from the source (grounding), and always carries a teaching explanation.

export function validateQuizContent(content, context = 'quiz') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (typeof content.question !== 'string' || !content.question.trim()) throw new Error(`${context} needs a question`);

  // DESCRIPTIVE scenario question (user design + world-class-teaching research): the
  // student explains/solves IN THEIR OWN WORDS with details; the reveal carries a model
  // answer + rubric points; AI feedback comes from the Ask-the-Tutor agent in the player.
  // Not a replacement for MCQs — practice scenes carry BOTH kinds.
  if (content.kind === 'descriptive') {
    if (typeof content.scenario !== 'string' || !content.scenario.trim()) {
      throw new Error(`${context} (descriptive) needs a "scenario" — a concrete situation with real values the student reasons about`);
    }
    if (typeof content.modelAnswer !== 'string' || content.modelAnswer.trim().length < 80) {
      throw new Error(`${context} (descriptive) needs a detailed "modelAnswer" (a real worked answer, not a phrase)`);
    }
    if (!Array.isArray(content.rubricPoints) || content.rubricPoints.length < 2
      || !content.rubricPoints.every((r) => typeof r === 'string' && r.trim())) {
      throw new Error(`${context} (descriptive) needs "rubricPoints": 2-6 strings naming what a good answer must contain`);
    }
    return content;
  }
  if (!Array.isArray(content.choices) || content.choices.length < 2) throw new Error(`${context} needs at least 2 choices`);
  if (!content.choices.every((c) => typeof c === 'string' && c.trim())) throw new Error(`${context} choices must be non-empty strings`);
  if (!Number.isInteger(content.answerIndex) || content.answerIndex < 0 || content.answerIndex >= content.choices.length) {
    throw new Error(`${context}.answerIndex must index into choices`);
  }
  if (typeof content.explanation !== 'string' || !content.explanation.trim()) {
    throw new Error(`${context} needs an explanation — a quiz teaches, not just tests`);
  }
  return content;
}
