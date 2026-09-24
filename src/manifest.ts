import { defineManifest, toolFactory } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { SearchProvider } from "./types";
import type { BraveOptions } from "./brave";
const tool = toolFactory<SearchProvider>();
export const manifest = defineManifest<BraveOptions, SearchProvider>()({
  contract: 2,
  identity: {
    name: "@absolutejs/search",
    accent: "#3b82f6",
    category: "data",
    docsUrl: "https://github.com/absolutejs/search",
    tagline:
      "Replaceable search providers with explicit evidence and outcomes.",
    description:
      "Provider-neutral web and context search contracts, Brave adapter, bounded queries, source excerpts, per-attempt accounting hooks, cancellation and scoped caching. Credentials and spending policy belong to the host.",
  },
  integration: { mode: "recipe" },
  requires: {
    env: [
      {
        key: "BRAVE_SEARCH_API_KEY",
        secret: true,
        description: "Brave Search API key",
      },
    ],
  },
  settings: Type.Object({
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 120000,
        title: "Request timeout (ms)",
      }),
    ),
  }),
  tools: {
    search_web: tool.runtime({
      annotations: { openWorldHint: true },
      authorization: {
        approval: "policy",
        audience: "authenticated",
        effects: ["read", "external-network"],
        destinations: ["configured-search-provider"],
        requiredScopes: ["search:read"],
        reversible: false,
        idempotency: { mode: "host" },
      },
      description:
        "Search using the configured provider; return evidence, limitations, and attempt accounting.",
      input: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 600 }),
        mode: Type.Optional(
          Type.Union([Type.Literal("web"), Type.Literal("context")]),
        ),
      }),
      handler: async (input, runtime) =>
        JSON.stringify(await runtime.search(input)),
    }),
  },
  wiring: [
    {
      id: "brave",
      title: "Configure Brave search",
      server: {
        placement: "module-scope",
        imports: [
          { from: "@absolutejs/search/brave", names: ["createBraveSearch"] },
        ],
        code: "const search = createBraveSearch({ ...${settings}, apiKey: ${env.BRAVE_SEARCH_API_KEY} });",
      },
    },
  ],
});
