import type { Message } from "./api";
export type HistoryPage = { items: Message[]; nextCursor: string | null };
export function mergeHistory(
  previous: Message[],
  incoming: Message[],
): Message[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) =>
    a.createdAt < b.createdAt
      ? -1
      : a.createdAt > b.createdAt
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
}
// known contains server-confirmed contiguous history, never just a local send.
// Each invocation is bounded; callers retain nextCursor when complete is false.
export async function catchUpHistory(
  fetchPage: (before: string | null) => Promise<HistoryPage>,
  known: Set<string>,
  before: string | null = null,
  maxPages = 4,
) {
  let items: Message[] = [],
    cursor = before;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await fetchPage(cursor);
    items = mergeHistory(items, page.items);
    cursor = page.nextCursor;
    if (
      known.size === 0 ||
      !cursor ||
      page.items.some((message) => known.has(message.id))
    ) {
      return { items, nextCursor: cursor, complete: true };
    }
  }
  return { items, nextCursor: cursor, complete: false };
}

export function updateHistoryBoundary(previous: { initialized: boolean; cursor: string | null }, page: HistoryPage, older = false) {
  return { initialized: previous.initialized || page.items.length > 0, cursor: older || !previous.initialized ? page.nextCursor : previous.cursor };
}
