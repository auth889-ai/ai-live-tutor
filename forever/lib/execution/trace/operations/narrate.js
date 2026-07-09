// NARRATION STAGE of the operations tool (same staged split as every engine: the compiler
// executes the real structure, this module owns the words). Every sentence is composed from
// the ACTUAL state — sizes, hashes, chain positions — and teaches the contract (LIFO/FIFO,
// O(1) hashing, collision cost) plus the classic mistakes (underflow, missing keys) at the
// exact moment they happen.

export function narrateAdd({ isStack, structure, value, size }) {
  return isStack
    ? `push(${JSON.stringify(value)}): the new item lands on TOP of the stack — watch the top arrow jump onto it. It sits above everything that came before, and it will be the FIRST to leave. That is the whole contract: Last In, First Out. Size is now ${size}.`
    : `enqueue(${JSON.stringify(value)}): the new item joins the BACK of the queue — the back arrow slides onto it — and must wait its turn behind ${size - 1} other${size === 2 ? '' : 's'}. First In, First Out, like any fair line. Size is now ${size}.`;
}

export function narrateUnderflow({ isStack }) {
  return isStack
    ? `pop() on an EMPTY stack — this is the classic crash (stack underflow). Real code must guard with "if not stack:" before popping; watch how the state simply has nothing to give.`
    : `dequeue() on an EMPTY queue — the classic underflow bug. Production code checks emptiness first; there is nothing at the front to hand back.`;
}

export function narrateRemove({ isStack, out, size }) {
  return isStack
    ? `pop(): ${JSON.stringify(out)} comes off the TOP — it was the most recent arrival, and it leaves first. Its slot empties and the top arrow drops down one place; notice nothing below it moved — a stack only ever touches its top. Size is now ${size}.`
    : `dequeue(): ${JSON.stringify(out)} leaves from the FRONT — it waited longest, so it is served first. Everyone behind shifts one place closer to the front arrow. Size is now ${size}.`;
}

export function narratePeek({ op, structure, empty, value, size }) {
  return empty
    ? `${op}() on an empty ${structure}: there is nothing to look at — another case your code must guard.`
    : `${op}(): we look at ${JSON.stringify(value)} WITHOUT removing it — the highlighted cell is only being read; reading costs nothing and changes nothing, and the size stays ${size}.`;
}

// --- hash map ---

export function narrateChainHop({ op, key, bucket, slot, slotKey }) {
  return `${op}(${JSON.stringify(key)}): hash(${JSON.stringify(key)}) = ${bucket}, and bucket ${bucket} is chained — slot ${slot} holds ${JSON.stringify(slotKey)}, which is not our key, so we follow the link to the next entry. Every one of these hops is the price of a collision; a good hash function keeps this walk short.`;
}

export function narratePutUpdate({ key, value, bucket }) {
  return `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): hash(${JSON.stringify(key)}) = ${bucket}, and ${JSON.stringify(key)} is ALREADY in bucket ${bucket} — so this is an update, not an insert. The old value is overwritten in place; a map holds one value per key.`;
}

export function narratePutInsert({ key, value, bucket, chainLength }) {
  return chainLength > 1
    ? `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): hash(${JSON.stringify(key)}) = ${bucket}, but bucket ${bucket} already holds ${chainLength - 1} entr${chainLength === 2 ? 'y' : 'ies'} — a COLLISION. We chain the new entry behind the others; lookups in this bucket now walk the chain, which is exactly why too many collisions degrade a hash map toward a list.`
    : `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): the hash function turns the key into a bucket number — hash(${JSON.stringify(key)}) = ${bucket} — and the entry drops straight into empty bucket ${bucket}. No searching: that single jump is the O(1) magic.`;
}

export function narrateGet({ key, bucket, at, value, chainLength }) {
  return at >= 0
    ? `get(${JSON.stringify(key)}): hash straight to bucket ${bucket}, ${at > 0 ? `walk ${at + 1} chained entr${at === 0 ? 'y' : 'ies'} (the collision cost), ` : ''}and find ${JSON.stringify(key)} = ${JSON.stringify(value)}. One hash, ${at + 1} look${at === 0 ? '' : 's'} — no scanning the whole table.`
    : `get(${JSON.stringify(key)}): hash says bucket ${bucket}, but the ${chainLength === 0 ? 'bucket is empty' : 'chain there does not contain it'} — the key does not exist. A hash map answers "not here" just as fast as "found".`;
}

export function narrateMapRemove({ key, bucket, found }) {
  return found
    ? `remove(${JSON.stringify(key)}): hash to bucket ${bucket}, unlink the entry, and the chain closes up behind it. Size bookkeeping is the map's job — no other bucket was touched.`
    : `remove(${JSON.stringify(key)}): bucket ${bucket} does not contain the key — removing a missing key is a no-op (or an error, depending on the API; know which one YOUR language does).`;
}
