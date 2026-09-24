import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
export const manifest = defineManifest<Record<string, never>>()({
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
  settings: Type.Object({}),
  wiring: [],
});
