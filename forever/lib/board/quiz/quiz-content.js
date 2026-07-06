// Interactive quiz board object (pure, tested). A checkpoint MCQ that PAUSES the lesson,
// the student answers, and gets the correct answer + a worked explanation. Every question
// is answerable from the source (grounding), and always carries a teaching explanation.

export function validateQuizContent(content, context = 'quiz') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (typeof content.question !== 'string' || !content.question.trim()) throw new Error(`${context} needs a question`);
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
