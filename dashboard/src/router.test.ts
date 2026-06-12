import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

describe("parseHash", () => {
  it("routes an empty or root hash to the Overview", () => {
    expect(parseHash("")).toEqual({ kind: "overview" });
    expect(parseHash("#")).toEqual({ kind: "overview" });
    expect(parseHash("#/")).toEqual({ kind: "overview" });
  });

  it("routes #/components to the Component table", () => {
    expect(parseHash("#/components")).toEqual({ kind: "components", filter: null, query: "" });
  });

  it("reads the filter and query params of the Component table", () => {
    expect(parseHash("#/components?filter=deprecated")).toEqual({
      kind: "components",
      filter: "deprecated",
      query: "",
    });
    expect(parseHash("#/components?filter=footguns&q=But")).toEqual({
      kind: "components",
      filter: "footguns",
      query: "But",
    });
  });

  it("drops an unknown filter value", () => {
    expect(parseHash("#/components?filter=nope")).toEqual({
      kind: "components",
      filter: null,
      query: "",
    });
  });

  it("routes #/components/<name> to that Component page, decoding the name", () => {
    expect(parseHash("#/components/Button")).toEqual({ kind: "component", name: "Button" });
    expect(parseHash("#/components/My%20Comp")).toEqual({ kind: "component", name: "My Comp" });
  });

  it("falls back to the Overview on an unknown route", () => {
    expect(parseHash("#/nope")).toEqual({ kind: "overview" });
  });
});
