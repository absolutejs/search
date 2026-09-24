import {
  searchCompleted,
  type SearchProvider,
  type SearchRequest,
  type SearchResult,
} from "./types";
export type SearchCacheEntry = { expiresAt: number; result: SearchResult };
export type SearchCacheStore = {
  get: (key: string) => Promise<SearchCacheEntry | undefined>;
  set: (key: string, entry: SearchCacheEntry) => Promise<void>;
};
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
export const searchCacheKey = (
  provider: SearchProvider,
  request: SearchRequest,
  scope: string,
) => {
  const { signal: _signal, ...params } = request;
  return stable({
    scope,
    provider: provider.name,
    version: provider.version,
    params,
  });
};
export const withSearchCache = (
  provider: SearchProvider,
  options: {
    scope: string;
    ttlMs?: number;
    emptyTtlMs?: number;
    capacity?: number;
    now?: () => number;
    store?: SearchCacheStore;
  },
): SearchProvider => {
  if (!options.scope.trim())
    throw new Error("Explicit public or tenant cache scope required");
  const cache = new Map<string, SearchCacheEntry>();
  const pending = new Map<string, Promise<SearchResult>>();
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? 500;
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error("Cache capacity must be positive");
  const deliver = (result: SearchResult): SearchResult => ({
    ...structuredClone(result),
    attempts: [],
    cache: { hit: true, originalAttemptIds: result.attempts.map((a) => a.id) },
  });
  return {
    ...provider,
    search: async (request) => {
      request.signal?.throwIfAborted();
      const key = searchCacheKey(provider, request, options.scope);
      const entry = cache.get(key) ?? (await options.store?.get(key));
      if (entry && now() < entry.expiresAt) return deliver(entry.result);
      cache.delete(key);
      // Cancellation ownership remains with the caller: only uncancellable calls coalesce.
      const existing = !request.signal ? pending.get(key) : undefined;
      if (existing) return deliver(await existing);
      const work = (async () => {
        const result = await provider.search(request);
        if (searchCompleted(result)) {
          const ttl =
            result.status === "empty"
              ? (options.emptyTtlMs ?? 60000)
              : (options.ttlMs ?? 300000);
          if (ttl > 0) {
            const entry = {
              result: structuredClone(result),
              expiresAt: now() + ttl,
            };
            while (cache.size >= capacity)
              cache.delete(cache.keys().next().value!);
            cache.set(key, entry);
            await options.store?.set(key, entry);
          }
        }
        return result;
      })();
      if (!request.signal) pending.set(key, work);
      try {
        return await work;
      } finally {
        if (pending.get(key) === work) pending.delete(key);
      }
    },
  };
};
