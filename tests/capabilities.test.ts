import { test, expect } from "bun:test";
import { createBraveSearch } from "../src/brave";
import { assertSearchCapabilities } from "../src/capabilities";
test("Brave never silently ignores unsupported filters or bills them", async () => {
  let calls = 0;
  const provider = createBraveSearch({
    apiKey: "test",
    fetch: (() => {
      calls++;
      throw new Error("must not run");
    }) as unknown as typeof fetch,
  });
  const result = await provider.search({
    query: "test",
    filters: { includeDomains: ["example.com"] },
  });
  expect(calls).toBe(0);
  expect(result.status).toBe("error");
  expect(result.attempts[0]!.billing).toBe("not_sent");
});
test("legacy provider must declare new filter support", () => {
  expect(() =>
    assertSearchCapabilities(
      {},
      { query: "test", filters: { category: "company" } },
    ),
  ).toThrow();
  expect(() => assertSearchCapabilities({}, { query: "test" })).not.toThrow();
});
