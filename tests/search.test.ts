import { test, expect } from 'bun:test';
import { createBraveSearch } from '../src/brave';
import { boundedQueries, sourceSupportsQuote, withSearchCache, type SearchAttempt, type SearchResult } from '../src';
const body = { grounding: { generic: [{ url: 'https://acme.example/team', title: 'Acme team', snippets: ['Jane Doe is Acme’s partnerships director.'] }] }, sources: { 'https://acme.example/team': { age: ['today', '', '', '2026-09-20T10:00:00Z'] } } };
const fakeFetch = (fn: (input: unknown, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;
test('context request preserves evidence and uses documented bounds', async () => {
  let sent: Record<string, unknown> = {};
  const provider = createBraveSearch({ apiKey: 'test', fetch: fakeFetch(async (url, init) => { expect(String(url)).toEndWith('/llm/context'); sent = JSON.parse(String(init?.body)); return Response.json(body); }) });
  const result = await provider.search({ query: 'Acme partnerships', maxTokens: 2048 });
  expect(sent.maximum_number_of_tokens).toBe(2048); expect(result.status).toBe('ok');
  expect(result.sources[0]?.publishedAt).toBe('2026-09-20T10:00:00Z');
  expect(result.attempts[0]?.costUsd).toBeNull(); expect(result.attempts[0]?.billing).toBe('fulfilled');
  expect(sourceSupportsQuote(result.sources[0]!, 'Jane Doe is Acme’s partnerships director.')).toBe(true);
});
test('web search uses URL parameters and retains snippets', async () => {
  const provider = createBraveSearch({ apiKey: 'x', fetch: fakeFetch(async (url, init) => { expect(new URL(String(url)).searchParams.get('q')).toBe('Acme'); expect(init?.method).toBe('GET'); return Response.json({ web: { results: [{ title: 'Acme', url: 'https://acme.example/', description: 'About Acme', extra_snippets: ['Team page'] }] } }); }) });
  expect((await provider.search({ query: 'Acme', mode: 'web' })).sources[0]?.excerpts).toEqual(['About Acme', 'Team page']);
});
test('empty, malformed, quota, and auth are not interchangeable', async () => {
  for (const [response, status, billing] of [
    [Response.json({ grounding: { generic: [] } }), 'empty', 'fulfilled'],
    [Response.json({}), 'error', 'fulfilled'],
    [Response.json({ error: { code: 'QUOTA_LIMITED' } }, { status: 429 }), 'quota_exceeded', 'rejected'],
    [Response.json({}, { status: 401 }), 'unavailable', 'rejected'],
    [Response.json({}, { status: 503 }), 'error', 'rejected'],
  ] as const) {
    const observed: SearchAttempt[] = [];
    const result = await createBraveSearch({ apiKey: 'x', fetch: fakeFetch(async () => response), observe: a => { observed.push(a); } }).search({ query: 'Acme' });
    expect(result.status).toBe(status); expect(observed[0]?.billing).toBe(billing);
  }
});
test('invalid queries and pre-aborted calls never contact provider', async () => {
  let calls = 0; const provider = createBraveSearch({ apiKey: 'x', fetch: fakeFetch(async () => { calls++; return Response.json(body); }) });
  expect((await provider.search({ query: 'x'.repeat(601) })).attempts[0]?.billing).toBe('not_sent');
  expect((await provider.search({ query: 'x', signal: AbortSignal.abort() })).status).toBe('cancelled');
  expect(calls).toBe(0); expect(boundedQueries('word '.repeat(100))).toHaveLength(2);
});
test('cache coalesces completed work, isolates options, expires empty sooner, never caches failure', async () => {
  let now = 0; let calls = 0; let status: SearchResult['status'] = 'empty';
  const provider = withSearchCache({ name: 'test', version: '1', search: async ({ query }) => { calls++; await Promise.resolve(); return { provider: 'test', version: '1', query, status, sources: [], attempts: [], limitations: [] }; } }, { scope: 'tenant:one', now: () => now, emptyTtlMs: 10 });
  await Promise.all([provider.search({ query: 'a' }), provider.search({ query: 'a' })]); expect(calls).toBe(1);
  await provider.search({ query: 'a', freshness: 'pw' }); expect(calls).toBe(2);
  now = 11; status = 'error'; await provider.search({ query: 'a' }); await provider.search({ query: 'a' }); expect(calls).toBe(4);
});
