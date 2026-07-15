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

  // TEACH-BACK (the Feynman checkpoint — "learning by teaching" from the specialist-teacher
  // spec, concretized by the SpeakSmartEngineer winner): the student EXPLAINS the concept in
  // their own words to a named audience; the tutor grades the explanation on NAMED dimensions
  // and shows a rewritten model explanation. Understanding is proven by teaching, not recall.
  if (content.kind === 'teach_back') {
    if (typeof content.audience !== 'string' || !content.audience.trim()) {
      throw new Error(`${context} (teach_back) needs an "audience" — who the student teaches (e.g. "a younger sibling", "a new teammate"); explaining TO someone is what forces de-jargoning`);
    }
    if (!Array.isArray(content.dimensions) || content.dimensions.length < 2 || content.dimensions.length > 5
      || !content.dimensions.every((d) => typeof d === 'string' && d.trim())) {
      throw new Error(`${context} (teach_back) needs "dimensions": 2-5 named grading dimensions (e.g. "correctness", "no unexplained jargon", "gives a concrete example", "says WHY it matters")`);
    }
    if (typeof content.modelExplanation !== 'string' || content.modelExplanation.trim().length < 80) {
      throw new Error(`${context} (teach_back) needs a "modelExplanation" ≥80 chars — the rewritten explanation the student compares against`);
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
