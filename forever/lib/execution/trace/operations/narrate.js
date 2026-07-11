// NARRATION STAGE of the operations tool (same staged split as every engine: the compiler
// executes the real structure, this module owns the words). Every sentence is composed from
// the ACTUAL state — sizes, hashes, chain positions — and teaches the contract (LIFO/FIFO,
// O(1) hashing, collision cost) plus the classic mistakes (underflow, missing keys) at the
// exact moment they happen.

// A tutor never repeats the same sentence three times: the FIRST arrival teaches the rule,
// the second names its neighbor, later ones shift the angle — deterministic by size, so the
// same ops always narrate the same way.
export function narrateAdd({ isStack, structure, value, size, neighbor }) {
  if (isStack) {
    if (size === 1) return `push(${JSON.stringify(value)}): the stack was empty, so ${JSON.stringify(value)} becomes both bottom AND top. Whatever lands after it will bury it — that is the whole contract: Last In, First Out. Size is now 1.`;
    if (size === 2) return `push(${JSON.stringify(value)}): ${JSON.stringify(value)} lands on TOP${neighbor !== undefined ? `, burying ${JSON.stringify(neighbor)} beneath it` : ''} — watch the top arrow jump up. ${neighbor !== undefined ? `${JSON.stringify(neighbor)} cannot leave until ${JSON.stringify(value)} does.` : 'It will be the first to leave.'} Size is now 2.`;
    return `push(${JSON.stringify(value)}): the top arrow jumps onto ${JSON.stringify(value)} — everything below is now frozen in place, reachable only after it leaves. ${size - 1} items wait underneath. Size is now ${size}.`;
  }
  if (size === 1) return `enqueue(${JSON.stringify(value)}): the queue was empty, so ${JSON.stringify(value)} stands at the FRONT and the BACK at once — first in line, and by the queue's promise, first to be served. First In, First Out starts here. Size is now 1.`;
  if (size === 2) return `enqueue(${JSON.stringify(value)}): ${JSON.stringify(value)} joins at the BACK${neighbor !== undefined ? `, right behind ${JSON.stringify(neighbor)}` : ''} — the back arrow slides onto it. It cannot be served until everyone ahead has been. Size is now 2.`;
  return `enqueue(${JSON.stringify(value)}): ${JSON.stringify(value)} takes the back slot with ${size - 1} ahead of it — and notice the FRONT arrow never moved: arrivals only ever touch the back of a queue. Size is now ${size}.`;
}

export function narrateUnderflow({ isStack }) {
  return isStack
    ? `pop() on an EMPTY stack — this is the classic crash (stack underflow). Real code must guard with "if not stack:" before popping; watch how the state simply has nothing to give.`
    : `dequeue() on an EMPTY queue — the classic underflow bug. Production code checks emptiness first; there is nothing at the front to hand back.`;
}

export function narrateRemove({ isStack, out, size }) {
  if (isStack) {
    if (size === 0) return `pop(): ${JSON.stringify(out)} comes off the top and the stack drains EMPTY — everything that went in came back out in exactly reverse order, and that reversal is what a stack is FOR.`;
    return `pop(): ${JSON.stringify(out)} comes off the TOP — it was the most recent arrival, and it leaves first. Its slot empties and the top arrow drops down one place; notice nothing below it moved — a stack only ever touches its top. Size is now ${size}.`;
  }
  if (size === 0) return `dequeue(): ${JSON.stringify(out)} is served and the queue drains EMPTY — everyone left in exactly the order they arrived, and that fairness is the whole point of a queue.`;
  return `dequeue(): ${JSON.stringify(out)} leaves from the FRONT — it waited longest, so it is served first. Everyone behind shifts one place closer to the front arrow. Size is now ${size}.`;
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
