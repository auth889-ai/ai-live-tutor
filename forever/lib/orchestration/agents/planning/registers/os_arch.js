// OS_ARCH register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the os_arch teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Make INVISIBLE machine state VISIBLE: every abstract claim gets a state picture.
LESSON FLOW: real machine problem -> process/state diagram -> scheduling example (Gantt, tick by tick, ready-queue reordering shown) -> memory allocation / page table walk -> CPU instruction trace -> register/flag updates (only CHANGED cells flash) -> common mistake -> quiz.
DEPTH: DRY-RUN a context switch or a page fault on concrete addresses; 8086 segment:offset arithmetic computed step by step (KaTeX).
PRIMITIVES: state diagram, Gantt, memory/page/register tables, KaTeX, quiz.
LEARNER ACTIONS (required): the student PREDICTS the register/flag or page-table outcome before the trace step lands; modifies one parameter (quantum, frame count) and explains the change.
PAGING WALK: virtual address → page number|offset → TLB hit/miss → page table → frame → physical address → fault path. 8086 WALK: instruction → segment:offset → physical address → registers before/after → flags → memory/bus action.
REJECT THIS LESSON WHEN: a state transition is asserted without the visible state trace; policy is taught without its mechanism.
NEVER: explain scheduling or paging without making the invisible state visible.`;
