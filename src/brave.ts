import {
  assertSearchCapabilities,
  type SearchCapabilities,
} from "./capabilities";
import type {
  SearchAttempt,
  SearchProvider,
  SearchRequest,
  SearchResult,
  SearchSource,
} from "./types";
import { boundedQueries, unavailableSearch } from "./types";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const publicUrl = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return /^https?:$/u.test(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const numberIn = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(
      `Search option must be an integer from ${min} through ${max}`,
    );
  return n;
};
export type BraveOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  apiVersion?: string;
  /** Awaited before returning, including rejected and malformed responses. Does not expose credentials. */
  observe?: (attempt: SearchAttempt) => Promise<void> | void;
};
export const braveSearchCapabilities: SearchCapabilities = {
  modes: ["web", "context"],
  filters: ["freshness", "country", "language"],
  content: ["excerpts"],
};
export const createBraveSearch = (options: BraveOptions): SearchProvider => {
  const now = options.now ?? Date.now;
  const version = options.apiVersion ?? "2026-07-31";
  return {
    name: "brave",
    capabilities: braveSearchCapabilities,
    version,
    search: async (request: SearchRequest): Promise<SearchResult> => {
      const started = now();
      const mode = request.mode ?? "context";
      const endpoint =
        mode === "web" ? "/res/v1/web/search" : "/res/v1/llm/context";
      const attempt: SearchAttempt = {
        id: crypto.randomUUID(),
        provider: "brave",
        endpoint,
        startedAt: new Date(started).toISOString(),
        durationMs: 0,
        status: "error",
        billing: "not_sent",
        costUsd: null,
      };
      const result: SearchResult = {
        provider: "brave",
        version,
        query: request.query,
        status: "error",
        sources: [],
        attempts: [attempt],
        limitations: [],
      };
      if (!options.apiKey)
        return unavailableSearch(
          "brave",
          request.query,
          "Search credentials are unavailable",
        );
      let response: Response | undefined;
      try {
        request.signal?.throwIfAborted();
        assertSearchCapabilities(
          { capabilities: braveSearchCapabilities },
          request,
        );
        const queries = boundedQueries(request.query);
        if (queries.length !== 1)
          throw new Error(
            "Search requires one nonempty query within 600 characters and 75 words",
          );
        const params: Record<string, string | number | boolean | string[]> = {
          q: request.query.trim(),
          count: numberIn(request.count, 10, 1, mode === "web" ? 20 : 50),
        };
        if (request.freshness) params.freshness = request.freshness;
        if (request.country) params.country = request.country;
        if (request.language) params.search_lang = request.language;
        if (request.goggles) params.goggles = request.goggles;
        if (mode === "context")
          Object.assign(params, {
            maximum_number_of_tokens: numberIn(
              request.maxTokens,
              4096,
              1024,
              32768,
            ),
            maximum_number_of_urls: numberIn(request.maxUrls, 8, 1, 50),
            maximum_number_of_tokens_per_url: numberIn(
              request.maxTokensPerUrl,
              1024,
              512,
              8192,
            ),
            enable_source_metadata: true,
            enable_local: false,
            ...(request.threshold
              ? { context_threshold_mode: request.threshold }
              : {}),
          });
        const headers = {
          accept: "application/json",
          "X-Subscription-Token": options.apiKey,
          "Api-Version": version,
          "Content-Type": "application/json",
        };
        const url = new URL(`https://api.search.brave.com${endpoint}`);
        if (mode === "web")
          for (const [key, value] of Object.entries(params)) {
            for (const entry of Array.isArray(value) ? value : [value])
              url.searchParams.append(key, String(entry));
          }
        const signal = AbortSignal.any([
          ...(request.signal ? [request.signal] : []),
          AbortSignal.timeout(options.timeoutMs ?? 30000),
        ]);
        attempt.billing = "unknown";
        response = await (options.fetch ?? fetch)(url, {
          headers,
          signal,
          redirect: "error",
          method: mode === "web" ? "GET" : "POST",
          ...(mode === "context" ? { body: JSON.stringify(params) } : {}),
        });
        attempt.httpStatus = response.status;
        attempt.providerRequestId =
          response.headers.get("x-request-id") ?? undefined;
        attempt.quota = {
          limit: response.headers.get("x-ratelimit-limit"),
          remaining: response.headers.get("x-ratelimit-remaining"),
          reset: response.headers.get("x-ratelimit-reset"),
        };
        const retry = response.headers.get("retry-after");
        if (retry) {
          const milliseconds = /^\d+(?:\.\d+)?$/u.test(retry)
            ? Number(retry) * 1000
            : Date.parse(retry) - now();
          if (Number.isFinite(milliseconds))
            attempt.retryAfterMs = Math.max(0, milliseconds);
        }
        attempt.billing = response.ok ? "fulfilled" : "rejected";
        if (!response.ok) {
          result.status =
            response.status === 429
              ? "rate_limited"
              : response.status === 401 || response.status === 403
                ? "unavailable"
                : "error";
          const error: unknown = await response.json().catch(() => null);
          if (
            record(error) &&
            record(error.error) &&
            error.error.code === "QUOTA_LIMITED"
          )
            result.status = "quota_exceeded";
          result.limitations.push(
            `Brave request failed with HTTP ${response.status}`,
          );
        } else {
          const body: unknown = await response.json();
          if (!record(body)) throw new Error("Invalid Brave response");
          const container = mode === "context" ? body.grounding : body.web;
          if (
            !record(container) ||
            !Array.isArray(
              container[mode === "context" ? "generic" : "results"],
            )
          )
            throw new Error("Brave response is missing its result array");
          const rows = container[
            mode === "context" ? "generic" : "results"
          ] as unknown[];
          let invalid = 0;
          const byUrl = new Map<string, SearchSource>();
          for (const row of rows) {
            if (!record(row)) {
              invalid++;
              continue;
            }
            const url = publicUrl(row.url);
            const excerpts =
              mode === "context"
                ? strings(row.snippets)
                : [
                    text(row.description),
                    ...strings(row.extra_snippets),
                  ].filter((item): item is string => Boolean(item));
            if (
              !url ||
              !text(row.title) ||
              (mode === "context" && !excerpts.length)
            ) {
              invalid++;
              continue;
            }
            const metadata =
              record(body.sources) && record(body.sources[String(row.url)])
                ? (body.sources[String(row.url)] as Record<string, unknown>)
                : {};
            const age = Array.isArray(metadata.age)
              ? text(metadata.age[3])
              : undefined;
            const publishedAt = text(row.page_age) ?? age;
            const previous = byUrl.get(url);
            if (previous)
              previous.excerpts = [
                ...new Set([...previous.excerpts, ...excerpts]),
              ];
            else
              byUrl.set(url, {
                id: url,
                url,
                title: String(row.title),
                excerpts,
                retrievedAt: new Date(now()).toISOString(),
                ...(publishedAt && Number.isFinite(Date.parse(publishedAt))
                  ? { publishedAt }
                  : {}),
                ...(text(metadata.fetched_content_timestamp)
                  ? {
                      contentFetchedAt: String(
                        metadata.fetched_content_timestamp,
                      ),
                    }
                  : {}),
                metadata,
              });
          }
          result.sources = [...byUrl.values()];
          result.status = invalid
            ? result.sources.length
              ? "partial"
              : "error"
            : result.sources.length
              ? "ok"
              : "empty";
          if (invalid)
            result.limitations.push(
              `${invalid} malformed result(s) were excluded`,
            );
        }
      } catch (error) {
        result.status = request.signal?.aborted ? "cancelled" : "error";
        result.limitations.push(
          error instanceof Error ? error.message : "Search failed",
        );
      } finally {
        attempt.status = result.status;
        attempt.durationMs = Math.max(0, now() - started);
        await options.observe?.({ ...attempt });
      }
      return result;
    },
  };
};
