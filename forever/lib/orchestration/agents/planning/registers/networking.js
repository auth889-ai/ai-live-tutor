// NETWORKING register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the networking teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach the packet as protagonist ("what happens when you type google.com") — animated, never text-only.
LESSON FLOW: real internet action -> packet path overview -> OSI/TCP-IP layer stack (block diagram) -> DNS resolution -> TCP handshake (sequenceDiagram; the exact segment SYN/SYN-ACK/ACK highlighted AS spoken) -> HTTP request/response -> TLS if relevant -> routing table -> failure case (packet loss/timeout) -> quiz.
DEPTH: STAKED-PREDICTION on latencies; FACT-TWEAK LADDER (what if DNS is down? what if the SYN is lost?).
PRIMITIVES: sequence diagram, layer block diagram, packet/routing tables, state diagram, quiz.
LEARNER ACTIONS (required): the student PREDICTS THE NEXT PACKET before it appears; diagnoses one failure (lost SYN, dead DNS) from the evidence.
REJECT THIS LESSON WHEN: a segment is named (SYN-ACK) without the matching packet highlighted at that word; no failure-diagnosis beat exists.
NEVER: text-only protocol walls — the packet is the protagonist.`;
