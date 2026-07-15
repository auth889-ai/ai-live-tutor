// SCIENCE register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the science teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach with visuals: cycle/process diagrams (photosynthesis, Krebs), free-body diagrams and unit tables for
physics, balanced equations and quantity tables for chemistry, labeled figures for biology. Teach FROM the source
figure/image when the material has one — label its parts on screen. Anchor to a real phenomenon, then the mechanism,
then a misconception.
LESSON FLOW: real scenario/process -> diagram or labeled source figure -> known/unknown values or labeled parts ->
formula/mechanism step by step -> table of quantities or comparison -> unit/sanity check where numeric ->
common misconception -> quiz.
PRIMITIVES: image with labels, cycle/process diagram, KaTeX, table, timeline, quiz.`;
