# Building Agents That Retrieve and Reason: The Clinic Knowledge Assistant

## 1. One assistant, all of agentic RAG

Imran is building an AI assistant that answers patients' questions from the clinic's own
document library — policies, doctor bios, insurance rules. A raw language model would
hallucinate answers; this system must RETRIEVE the real document and reason from it. Every
claim in this course is shown as an actual TRACE — the prompt, the retrieved chunks with
their scores, the tool calls — the way LangSmith teaches, because the trace IS the lesson.

## 2. Why retrieval, not memory

A language model's training data is fixed and general; it does not know THIS clinic's refund
policy, and asked directly it will invent a plausible-sounding one. Retrieval-Augmented
Generation (RAG) fixes this: before answering, the system fetches the relevant real documents
and puts them in the prompt, so the model reasons from ground truth instead of memory. The
model becomes a reasoner over retrieved facts, not an oracle of facts.

## 3. Embeddings: meaning as coordinates

To find relevant documents, RAG converts text into EMBEDDINGS — vectors of numbers where
similar meanings land near each other. "What is your cancellation policy?" and "How do I call
off my appointment?" use different words but embed to nearby vectors because they mean the same
thing. This is why RAG beats keyword search: it matches MEANING, not spelling. The clinic's
documents are embedded once and stored; each question is embedded at query time.

## 4. Chunking: the size that decides everything

Documents are split into CHUNKS before embedding, and the chunk size is a real trade-off. Too
large (a whole 5-page policy as one chunk) and the retrieved context is mostly irrelevant, the
signal buried. Too small (one sentence) and the chunk lacks the context to be understood alone.
A few hundred words per chunk, split on natural boundaries (paragraphs, sections), is the
usual sweet spot. Bad chunking is the most common cause of bad RAG, and no clever model fixes
it.

## 5. Similarity search: the retrieval step, traced

A question embeds to a vector; the system finds the chunks whose vectors are nearest (cosine
similarity) and returns the top few. Shown as a trace: query "refund policy?" retrieves chunk
A (score 0.89, the refund section), chunk B (score 0.81, cancellation), chunk C (score 0.62,
unrelated hours). The scores are visible and diagnostic — a top result at 0.62 means nothing
relevant was found, a signal to widen the search or admit no answer exists.

## 6. When retrieval fails, in the open

RAG fails visibly, which is its virtue. Ask "who is the head cardiologist?" and if that fact
is in no document, the top chunk comes back at a low score — say 0.55, a bio of a different
doctor. A well-built system SEES the low score and answers "I don't have that information"
instead of forcing an answer from an irrelevant chunk. The failure is in the trace: the wrong
chunk, its low score, and the honest refusal. A human never shows you why they were unsure;
the trace does.

## 7. Agents: reasoning across tool calls

An AGENT goes beyond one retrieval: it decides what to do, in steps. Asked "can I book with Dr.
Rahman next Tuesday and does my insurance cover it?", the agent plans — retrieve Dr. Rahman's
schedule (tool call 1), check Tuesday availability (tool call 2), retrieve the insurance
coverage doc (tool call 3), then synthesize. Each tool call has real inputs and outputs, all
in the trace. The agent is a loop of decide-act-observe, not a single answer.

## 8. Grounding and citation

The strongest guardrail: require the agent to CITE the retrieved chunk for every claim. "Your
plan covers this visit [source: insurance-policy.pdf, chunk 4]." If a sentence cannot cite a
retrieved chunk, it is a hallucination and is dropped. This turns the model from a confident
guesser into an evidence-bound reasoner — and the citation is checkable against the actual
retrieved text in the trace.

## 9. The misconception that ships hallucinating agents

"A more powerful language model needs less retrieval." Backwards. A more powerful model
hallucinates more CONVINCINGLY when it lacks the fact — fluent, confident, and wrong. Model
capability and grounding are independent: capability makes reasoning better OVER retrieved
facts, but nothing in the model knows your clinic's private documents. The fix for
hallucination is never a bigger model; it is better retrieval and enforced citation. Teams that
believe otherwise ship assistants that invent policies beautifully.

## 10. What the model leaves out

RAG grounds answers in retrieved text but inherits that text's errors, and retrieval can still
miss a relevant chunk that was chunked or embedded poorly. The trace shows what WAS retrieved,
not what SHOULD have been. Agentic RAG is the honest architecture for reasoning over private
knowledge; it is trusted for the grounding it enforces and the failures it shows in the open,
and respected for admitting that a good trace is not the same as a complete knowledge base.
