import type { SearchProvider, SearchRequest } from "./types";
export type SearchCapabilities = {
  modes: readonly ("web" | "context")[];
  filters: readonly (
    | "freshness"
    | "country"
    | "language"
    | "includeDomains"
    | "excludeDomains"
    | "publishedAfter"
    | "publishedBefore"
    | "category"
  )[];
  content: readonly ("excerpts" | "text")[];
};
export type SearchFilters = {
  includeDomains?: string[];
  excludeDomains?: string[];
  publishedAfter?: string;
  publishedBefore?: string;
  category?: string;
};
/** Reject unsupported constraints before provider work; never silently broaden a query. */
export const assertSearchCapabilities = (
  provider: Pick<SearchProvider, "capabilities">,
  request: SearchRequest,
) => {
  const capabilities = provider.capabilities;
  const requested = [
    ...Object.entries(request.filters ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
    ...(["freshness", "country", "language"] as const).filter(
      (key) => request[key] !== undefined,
    ),
  ];
  if (!capabilities) {
    if (request.filters && Object.keys(request.filters).length)
      throw new Error(
        "Provider does not declare support for requested filters",
      );
    return;
  }
  if (!capabilities.modes.includes(request.mode ?? "context"))
    throw new Error("Provider does not support requested search mode");
  for (const filter of requested)
    if (!(capabilities.filters as readonly string[]).includes(filter))
      throw new Error(`Provider does not support search filter: ${filter}`);
};
export const withSearchCapabilities = (
  provider: SearchProvider,
): SearchProvider => ({
  ...provider,
  search: (request) => {
    assertSearchCapabilities(provider, request);
    return provider.search(request);
  },
});
