/**
 * Queue construction — pure functions, no DOM, no localStorage.
 *
 * A deck on its own is an unordered bag of cards. This module turns it into a
 * sequence that reads like something: cards that belong to a thread appear in
 * the thread's order, each carrying the one-line `hook` that connects it to the
 * card before it, and everything left over follows in curriculum (stage) order.
 *
 * Threads live in content/threads.json rather than on the cards themselves for
 * two reasons: a card may belong to more than one thread, and a hook is only
 * meaningful relative to the card that precedes it *in that thread*.
 *
 * The queue is content-derived and deterministic. It holds no review state.
 */

// Curriculum order, mirroring the tracker's own sequence:
//   S0-S16   the core LLM path
//   I0-I12   inference engineering
//   F0-F10   fine-tuning (F5B is a sub-stage of F5)
//   D / SD / B   DSA, system design, behavioural
const STAGE_BANDS = { S: 0, I: 1000, F: 2000, D: 3000, SD: 3100, B: 3200 };

/** Rank a stage code for curriculum ordering. Unknown codes sort last. */
export function stageRank(stage) {
  if (typeof stage !== "string") return Number.MAX_SAFE_INTEGER;
  if (stage === "D" || stage === "SD" || stage === "B") return STAGE_BANDS[stage];

  const band = STAGE_BANDS[stage[0]];
  if (band === undefined) return Number.MAX_SAFE_INTEGER;

  // F5B sorts immediately after F5 and before F6.
  const rest = stage.slice(1);
  const sub = rest.endsWith("B") ? 0.5 : 0;
  const n = parseInt(rest, 10);
  if (Number.isNaN(n)) return Number.MAX_SAFE_INTEGER;

  return band + n + sub;
}

/**
 * Check a raw threads payload against the deck.
 *
 * Returns the threads that are safe to use plus a list of problems. A thread
 * naming a card that does not exist keeps its remaining cards rather than
 * vanishing — content and code ship separately, so a thread will routinely
 * reference a card that has not been written yet. That is not an error worth
 * losing the whole thread over.
 */
export function validateThreads(raw, cardsById) {
  const problems = [];
  if (!Array.isArray(raw)) {
    return { threads: [], problems: ["threads payload is not an array"] };
  }

  const threads = [];
  const seenThreadIds = new Set();

  raw.forEach((thread, i) => {
    const where = `threads[${i}]`;
    if (!thread || typeof thread !== "object") {
      problems.push(`${where} is not an object`);
      return;
    }
    const { id, title, premise, cards } = thread;
    if (typeof id !== "string" || !id.trim()) {
      problems.push(`${where} has no id`);
      return;
    }
    if (seenThreadIds.has(id)) {
      problems.push(`${where} duplicates thread id ${id}`);
      return;
    }
    if (typeof title !== "string" || !title.trim()) {
      problems.push(`${where} (${id}) has no title`);
      return;
    }
    if (!Array.isArray(cards)) {
      problems.push(`${where} (${id}) has no cards array`);
      return;
    }

    const entries = [];
    const seenCardIds = new Set();
    cards.forEach((entry, j) => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
        problems.push(`${where}.cards[${j}] is not a {id, hook} object`);
        return;
      }
      if (!cardsById.has(entry.id)) {
        problems.push(`${where} (${id}) references unknown card ${entry.id}`);
        return;
      }
      if (seenCardIds.has(entry.id)) {
        problems.push(`${where} (${id}) lists card ${entry.id} twice`);
        return;
      }
      seenCardIds.add(entry.id);
      entries.push({
        id: entry.id,
        hook: typeof entry.hook === "string" && entry.hook.trim() ? entry.hook : null,
      });
    });

    // A thread of one has no arc to follow, so it is not worth presenting as
    // a thread. Its card still reaches the queue through the stage-ordered tail.
    if (entries.length < 2) {
      problems.push(`${where} (${id}) has fewer than 2 resolvable cards`);
      return;
    }

    seenThreadIds.add(id);
    threads.push({
      id,
      title,
      premise: typeof premise === "string" && premise.trim() ? premise : null,
      cards: entries,
    });
  });

  return { threads, problems };
}

/**
 * Build the ordered queue.
 *
 * Every entry is `{ card, thread, position, length, hook }` where `thread` is
 * null for cards that belong to no thread. `position` is 1-based and only
 * meaningful within a thread.
 *
 * A card appearing in two threads appears in the queue twice, once per thread —
 * that is deliberate, since the surrounding story differs each time. It is
 * excluded from the stage-ordered tail either way.
 */
export function buildQueue(cards, threads) {
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const entries = [];
  const threaded = new Set();

  for (const thread of threads) {
    const meta = { id: thread.id, title: thread.title, premise: thread.premise };
    thread.cards.forEach((entry, i) => {
      const card = cardsById.get(entry.id);
      if (!card) return; // already reported by validateThreads
      threaded.add(entry.id);
      entries.push({
        card,
        thread: meta,
        position: i + 1,
        length: thread.cards.length,
        // The first card of a thread opens with the premise, not a back-reference.
        hook: i === 0 ? null : entry.hook,
      });
    });
  }

  const loose = cards
    .filter((c) => !threaded.has(c.id))
    .sort((a, b) => {
      const d = stageRank(a.stage) - stageRank(b.stage);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    })
    .map((card) => ({ card, thread: null, position: 0, length: 0, hook: null }));

  return entries.concat(loose);
}

/** Index of the first entry belonging to `threadId`, or -1. */
export function threadStart(queue, threadId) {
  return queue.findIndex((e) => e.thread && e.thread.id === threadId);
}

/** Distinct threads present in a queue, in queue order. */
export function threadsInQueue(queue) {
  const out = [];
  const seen = new Set();
  for (const entry of queue) {
    if (entry.thread && !seen.has(entry.thread.id)) {
      seen.add(entry.thread.id);
      out.push(entry.thread);
    }
  }
  return out;
}
