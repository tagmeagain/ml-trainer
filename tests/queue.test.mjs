/**
 * Tests for queue.js. Run with:  node --test tests/
 *
 * Node's built-in test runner only — no npm, no dependencies, nothing to install.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  stageRank,
  validateThreads,
  buildQueue,
  threadStart,
  threadsInQueue,
} from "../queue.js";

const card = (id, stage) => ({ id, stage, topic: id, category: "attention" });

const DECK = [
  card("a-x-001", "S3"),
  card("b-x-002", "S0"),
  card("c-x-003", "I3"),
  card("d-x-004", "F5B"),
  card("e-x-005", "F5"),
];
const BY_ID = new Map(DECK.map((c) => [c.id, c]));

// ---------------------------------------------------------------- stageRank

test("stageRank orders the curriculum bands S < I < F < D < SD < B", () => {
  assert.ok(stageRank("S16") < stageRank("I0"));
  assert.ok(stageRank("I12") < stageRank("F0"));
  assert.ok(stageRank("F10") < stageRank("D"));
  assert.ok(stageRank("D") < stageRank("SD"));
  assert.ok(stageRank("SD") < stageRank("B"));
});

test("stageRank orders numerically, not lexically", () => {
  assert.ok(stageRank("S2") < stageRank("S10"), "S10 must not sort before S2");
  assert.ok(stageRank("I2") < stageRank("I12"));
});

test("stageRank slots F5B between F5 and F6", () => {
  assert.ok(stageRank("F5") < stageRank("F5B"));
  assert.ok(stageRank("F5B") < stageRank("F6"));
});

test("stageRank sends unknown codes to the end", () => {
  assert.equal(stageRank("Z9"), Number.MAX_SAFE_INTEGER);
  assert.equal(stageRank(undefined), Number.MAX_SAFE_INTEGER);
});

// ----------------------------------------------------------- validateThreads

test("validateThreads accepts a well-formed thread", () => {
  const { threads, problems } = validateThreads(
    [{ id: "t1", title: "T", premise: "P", cards: [{ id: "a-x-001", hook: "h" }, { id: "b-x-002" }] }],
    BY_ID,
  );
  assert.equal(problems.length, 0);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].cards.length, 2);
  assert.equal(threads[0].cards[0].hook, "h");
  assert.equal(threads[0].cards[1].hook, null, "a missing hook becomes null, not undefined");
});

test("validateThreads drops unknown cards but keeps the thread", () => {
  const { threads, problems } = validateThreads(
    [{
      id: "t1",
      title: "T",
      cards: [{ id: "a-x-001" }, { id: "not-a-card-999" }, { id: "b-x-002" }],
    }],
    BY_ID,
  );
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].cards.map((c) => c.id), ["a-x-001", "b-x-002"]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown card not-a-card-999/);
});

test("validateThreads rejects a thread left with fewer than two cards", () => {
  const { threads, problems } = validateThreads(
    [{ id: "t1", title: "T", cards: [{ id: "a-x-001" }, { id: "ghost-000" }] }],
    BY_ID,
  );
  assert.equal(threads.length, 0);
  assert.ok(problems.some((p) => /fewer than 2/.test(p)));
});

test("validateThreads rejects duplicate thread ids and repeated cards", () => {
  const dup = { id: "t1", title: "T", cards: [{ id: "a-x-001" }, { id: "b-x-002" }] };
  const { threads, problems } = validateThreads([dup, dup], BY_ID);
  assert.equal(threads.length, 1);
  assert.ok(problems.some((p) => /duplicates thread id/.test(p)));

  const repeated = validateThreads(
    [{ id: "t2", title: "T", cards: [{ id: "a-x-001" }, { id: "a-x-001" }, { id: "b-x-002" }] }],
    BY_ID,
  );
  assert.ok(repeated.problems.some((p) => /twice/.test(p)));
  assert.deepEqual(repeated.threads[0].cards.map((c) => c.id), ["a-x-001", "b-x-002"]);
});

test("validateThreads survives junk input", () => {
  assert.deepEqual(validateThreads(null, BY_ID).threads, []);
  assert.deepEqual(validateThreads("nope", BY_ID).threads, []);
  const { threads, problems } = validateThreads([null, 42, {}], BY_ID);
  assert.equal(threads.length, 0);
  assert.equal(problems.length, 3);
});

// ---------------------------------------------------------------- buildQueue

test("buildQueue puts threaded cards first, in thread order", () => {
  const { threads } = validateThreads(
    [{ id: "t1", title: "T", cards: [{ id: "c-x-003", hook: "h1" }, { id: "a-x-001", hook: "h2" }] }],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);

  assert.deepEqual(q.slice(0, 2).map((e) => e.card.id), ["c-x-003", "a-x-001"]);
  assert.equal(q[0].thread.id, "t1");
  assert.deepEqual([q[0].position, q[0].length], [1, 2]);
  assert.deepEqual([q[1].position, q[1].length], [2, 2]);
});

test("buildQueue suppresses the hook on a thread's first card", () => {
  const { threads } = validateThreads(
    [{ id: "t1", title: "T", cards: [{ id: "a-x-001", hook: "h1" }, { id: "b-x-002", hook: "h2" }] }],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  assert.equal(q[0].hook, null, "nothing precedes the first card, so it has nothing to hook to");
  assert.equal(q[1].hook, "h2");
});

test("buildQueue appends unthreaded cards in stage order", () => {
  const { threads } = validateThreads(
    [{ id: "t1", title: "T", cards: [{ id: "c-x-003" }, { id: "a-x-001" }] }],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  const tail = q.slice(2);

  assert.deepEqual(tail.map((e) => e.card.id), ["b-x-002", "e-x-005", "d-x-004"]);
  assert.ok(tail.every((e) => e.thread === null && e.hook === null));
});

test("buildQueue with no threads is pure stage order", () => {
  const q = buildQueue(DECK, []);
  assert.deepEqual(q.map((e) => e.card.id), [
    "b-x-002", // S0
    "a-x-001", // S3
    "c-x-003", // I3
    "e-x-005", // F5
    "d-x-004", // F5B
  ]);
  assert.equal(q.length, DECK.length);
});

test("buildQueue repeats a card that belongs to two threads, once per thread", () => {
  const { threads } = validateThreads(
    [
      { id: "t1", title: "One", cards: [{ id: "a-x-001" }, { id: "b-x-002" }] },
      { id: "t2", title: "Two", cards: [{ id: "a-x-001" }, { id: "c-x-003" }] },
    ],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  const appearances = q.filter((e) => e.card.id === "a-x-001");

  assert.equal(appearances.length, 2);
  assert.deepEqual(appearances.map((e) => e.thread.id), ["t1", "t2"]);
  assert.equal(q.filter((e) => e.thread === null && e.card.id === "a-x-001").length, 0,
    "a threaded card must not also appear in the loose tail");
});

test("buildQueue covers every card at least once", () => {
  const { threads } = validateThreads(
    [{ id: "t1", title: "T", cards: [{ id: "c-x-003" }, { id: "a-x-001" }] }],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  const covered = new Set(q.map((e) => e.card.id));
  assert.equal(covered.size, DECK.length);
});

// ------------------------------------------------------------------ helpers

test("threadStart finds the first entry of a thread", () => {
  const { threads } = validateThreads(
    [
      { id: "t1", title: "One", cards: [{ id: "a-x-001" }, { id: "b-x-002" }] },
      { id: "t2", title: "Two", cards: [{ id: "c-x-003" }, { id: "d-x-004" }] },
    ],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  assert.equal(threadStart(q, "t1"), 0);
  assert.equal(threadStart(q, "t2"), 2);
  assert.equal(threadStart(q, "nope"), -1);
});

test("threadsInQueue lists each thread once, in order", () => {
  const { threads } = validateThreads(
    [
      { id: "t1", title: "One", cards: [{ id: "a-x-001" }, { id: "b-x-002" }] },
      { id: "t2", title: "Two", cards: [{ id: "c-x-003" }, { id: "d-x-004" }] },
    ],
    BY_ID,
  );
  const q = buildQueue(DECK, threads);
  assert.deepEqual(threadsInQueue(q).map((t) => t.id), ["t1", "t2"]);
});
