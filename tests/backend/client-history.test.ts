import test from "node:test";
import assert from "node:assert/strict";
import { mergeHistory, catchUpHistory, updateHistoryBoundary } from "../../client/src/history.js";
import type { Message } from "../../client/src/api.js";
const row = (number: number): Message => ({
  id: String(number).padStart(4, "0"),
  conversationId: "c",
  direction: "inbound",
  text: String(number),
  actorId: null,
  status: "received",
  createdAt: `2026-01-01T00:00:00.${String(number).padStart(6, "0")}Z`,
  attachments: [],
});
test("authoritative microseconds repair concurrent send/receive insertion order", () => {
  assert.deepEqual(
    mergeHistory([row(1), row(2), row(4)], [row(2), row(3), row(4)]).map(
      (item) => item.text,
    ),
    ["1", "2", "3", "4"],
  );
  const tied = { ...row(3), createdAt: row(2).createdAt };
  assert.deepEqual(
    mergeHistory([tied], [row(2)]).map((item) => item.id),
    [row(2).id, tied.id],
  );
});
test("catch-up bridges over 50 arrivals after exhausted older history", async () => {
  const all = Array.from({ length: 200 }, (_, index) => row(index + 1));
  const previous = all.slice(0, 100);
  const beforeRequests: (string | null)[] = [];
  const result = await catchUpHistory(
    async (before) => {
      beforeRequests.push(before);
      const eligible = before ? all.filter((item) => item.id < before) : all;
      const items = eligible.slice(-50);
      return { items, nextCursor: eligible.length > 50 ? items[0].id : null };
    },
    new Set(previous.map((item) => item.id)),
  );
  assert.equal(result.complete, true);
  assert.equal(mergeHistory(previous, result.items).length, 200);
  assert.deepEqual(beforeRequests, [null, row(151).id, row(101).id]);
});
test("large catch-up continues from bounded cursor without declaring continuity", async () => {
  const all = Array.from({ length: 500 }, (_, index) => row(index + 1));
  const fetchPage = async (before: string | null) => {
    const eligible = before ? all.filter((item) => item.id < before) : all;
    const items = eligible.slice(-50);
    return { items, nextCursor: eligible.length > 50 ? items[0].id : null };
  };
  const known = new Set([row(1).id]);
  const first = await catchUpHistory(fetchPage, known, null, 2);
  assert.equal(first.complete, false);
  assert.equal(first.nextCursor, row(401).id);
  let items = first.items;
  let cursor: string | null = first.nextCursor;
  for (let iteration = 0; iteration < 5; iteration++) {
    const next = await catchUpHistory(fetchPage, known, cursor, 2);
    items = mergeHistory(items, next.items);
    cursor = next.nextCursor;
    if (next.complete) break;
  }
  assert.equal(items.length, 500);
});

test('an initially empty history adopts the first nonempty page cursor', async () => {
  let boundary = { initialized: false, cursor: null as string | null };
  boundary = updateHistoryBoundary(boundary, { items: [], nextCursor: null });
  const all = Array.from({ length: 100 }, (_, index) => row(index + 1));
  const known = new Set<string>();
  const newest = await catchUpHistory(async () => ({ items: all.slice(50), nextCursor: row(51).id }), known);
  boundary = updateHistoryBoundary(boundary, newest);
  assert.equal(boundary.cursor, row(51).id);
  assert.equal(boundary.initialized, true);
  const older = { items: all.slice(0, 50), nextCursor: null };
  boundary = updateHistoryBoundary(boundary, older, true);
  assert.equal(boundary.cursor, null);
  assert.equal(mergeHistory(newest.items, older.items).length, 100);
});
