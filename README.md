# @absolutejs/search

Provider-neutral web evidence with a Brave Web Search / LLM Context adapter.

```ts
import { createBraveSearch } from '@absolutejs/search/brave';
const search = createBraveSearch({ apiKey, observe: recordAttempt });
const result = await search.search({ query: 'company partnership program', mode: 'context', maxTokens: 4096 });
```

Successful empty results, partial evidence, provider outages, quota failures and cancellation remain distinct. Every network attempt carries billing disposition; unknown cost remains null. A 200 response remains fulfilled if its body cannot be parsed. The host owns retry/admission, prices, credentials and accounting. No hidden model calls or fallback providers.

Source excerpts are untrusted evidence. Publication and retrieval timestamps do not establish an event date. `sourceSupportsQuote` checks quotation presence, not entailment. `withSearchCache` requires an explicit scope, isolates provider/options/version, uses shorter empty-result retention, never caches failures, and optionally persists through a host store. Requests with caller-owned cancellation are not coalesced.

## Capabilities and agent setup

Providers may declare `capabilities` with supported modes, filters and content views. `SearchRequest.filters` carries domain/date/category constraints. `assertSearchCapabilities` and `withSearchCapabilities` reject unsupported constraints before provider work. Brave advertises web/context excerpts and freshness/country/language; unsupported domain/date/category filters are rejected, never silently ignored. Existing providers without metadata remain compatible with existing request fields, but must declare support before accepting the new filters.

The manifest exports a guarded `search_web` agent tool and a Brave configuration recipe using `BRAVE_SEARCH_API_KEY`. Bind the configured provider and host enforcer through the existing manifest AI/MCP bridges. Search spending and tenant authorization remain host-controlled. For complete research, extraction, monitoring and framework flows, compose with `@absolutejs/rag/research`.
