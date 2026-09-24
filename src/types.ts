export type SearchStatus =
  | "ok"
  | "empty"
  | "partial"
  | "unavailable"
  | "rate_limited"
  | "quota_exceeded"
  | "cancelled"
  | "error";
export type SearchSource = {
  id: string;
  url: string;
  title: string;
  excerpts: string[];
  retrievedAt: string;
  /** Date reported by the page/provider; never an event date inferred from a crawl. */
  publishedAt?: string;
  contentFetchedAt?: string;
  metadata?: Record<string, unknown>;
};
export type SearchRequest = {
  query: string;
  mode?: "web" | "context";
  signal?: AbortSignal;
  count?: number;
  maxTokens?: number;
  maxUrls?: number;
  maxTokensPerUrl?: number;
  freshness?: string;
  country?: string;
  language?: string;
  threshold?: "strict" | "balanced" | "lenient" | "disabled";
  goggles?: string[];
};
export type SearchAttempt = {
  id: string;
  provider: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  status: SearchStatus;
  httpStatus?: number;
  retryAfterMs?: number;
  /** A successful HTTP response is billable even if parsing fails. */
  billing: "fulfilled" | "rejected" | "unknown" | "not_sent";
  costUsd: number | null;
  providerRequestId?: string;
  quota?: {
    limit: string | null;
    remaining: string | null;
    reset: string | null;
  };
};
export type SearchResult = {
  provider: string;
  version: string;
  query: string;
  status: SearchStatus;
  sources: SearchSource[];
  attempts: SearchAttempt[];
  limitations: string[];
  cache?: { hit: boolean; originalAttemptIds: string[] };
};
export type SearchProvider = {
  name: string;
  version: string;
  search: (request: SearchRequest) => Promise<SearchResult>;
};
export const searchCompleted = (result: SearchResult) =>
  result.status === "ok" || result.status === "empty";
export const searchUsable = (result: SearchResult) =>
  result.sources.length > 0 &&
  (result.status === "ok" || result.status === "partial");
export const unavailableSearch = (
  provider: string,
  query: string,
  reason: string,
): SearchResult => ({
  provider,
  query,
  version: "1",
  status: "unavailable",
  sources: [],
  attempts: [],
  limitations: [reason],
});
export const evidenceText = (sources: SearchSource[]) =>
  sources
    .map((source) =>
      JSON.stringify({
        sourceId: source.id,
        url: source.url,
        title: source.title,
        retrievedAt: source.retrievedAt,
        publishedAt: source.publishedAt,
        excerpts: source.excerpts,
      }),
    )
    .join("\n");
export const sourceSupportsQuote = (source: SearchSource, quote: string) => {
  const normalize = (text: string) =>
    text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const normalized = normalize(quote);
  return (
    normalized.length >= 12 &&
    source.excerpts.some((text) => normalize(text).includes(normalized))
  );
};
/** No truncation: split oversized questions into bounded chunks and retain every word. */
export const boundedQueries = (text: string, maxChars = 600, maxWords = 75) => {
  if (
    !Number.isInteger(maxChars) ||
    maxChars < 1 ||
    !Number.isInteger(maxWords) ||
    maxWords < 1
  )
    throw new Error("Invalid query limits");
  const chunks: string[] = [];
  let words: string[] = [];
  for (const word of text.trim().split(/\s+/u).filter(Boolean)) {
    if (word.length > maxChars)
      throw new Error("A search term exceeds the provider query limit");
    if (
      words.length >= maxWords ||
      [...words, word].join(" ").length > maxChars
    ) {
      chunks.push(words.join(" "));
      words = [];
    }
    words.push(word);
  }
  if (words.length) chunks.push(words.join(" "));
  return chunks;
};
