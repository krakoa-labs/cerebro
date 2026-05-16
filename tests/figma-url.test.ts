import { describe, expect, it } from "vitest";
import { resolveFigmaUrl } from "../src/figma-url.js";

describe("resolveFigmaUrl", () => {
  it("accepts a literal Figma design URL", () => {
    expect(resolveFigmaUrl("https://figma.com/design/abc?node-id=1-1", {})).toBe(
      "https://figma.com/design/abc?node-id=1-1",
    );
  });

  it("accepts the www host, a file-name segment, and the /file/ form", () => {
    expect(resolveFigmaUrl("https://www.figma.com/design/abc/Name?node-id=1-2", {})).toBe(
      "https://www.figma.com/design/abc/Name?node-id=1-2",
    );
    expect(resolveFigmaUrl("https://www.figma.com/file/abc/Name?node-id=1-2", {})).toBe(
      "https://www.figma.com/file/abc/Name?node-id=1-2",
    );
  });

  it("resolves a placeholder through the substitutions map", () => {
    expect(
      resolveFigmaUrl("<FIGMA_BUTTON>", {
        "<FIGMA_BUTTON>": "https://www.figma.com/design/abc/DS?node-id=1-2",
      }),
    ).toBe("https://www.figma.com/design/abc/DS?node-id=1-2");
  });

  it("resolves a placeholder used as a prefix of the URL", () => {
    expect(
      resolveFigmaUrl("<FIGMA_BASE>?node-id=9-9", {
        "<FIGMA_BASE>": "https://www.figma.com/design/abc/DS",
      }),
    ).toBe("https://www.figma.com/design/abc/DS?node-id=9-9");
  });

  it("returns null for an unresolved placeholder", () => {
    expect(resolveFigmaUrl("<FIGMA_UNKNOWN>", {})).toBeNull();
  });

  it("returns null for a non-Figma URL", () => {
    expect(resolveFigmaUrl("https://example.com/design/abc?node-id=1-1", {})).toBeNull();
  });

  it("returns null for a Figma URL with no node-id", () => {
    expect(resolveFigmaUrl("https://www.figma.com/design/abc/Name", {})).toBeNull();
  });

  it("returns null for a Figma URL with an empty node-id", () => {
    expect(resolveFigmaUrl("https://www.figma.com/design/abc/Name?node-id=", {})).toBeNull();
  });

  it("returns null for a Figma URL with no file key", () => {
    expect(resolveFigmaUrl("https://www.figma.com/design/?node-id=1-1", {})).toBeNull();
  });

  it("returns null for a non-design Figma path", () => {
    expect(resolveFigmaUrl("https://www.figma.com/proto/abc/Name?node-id=1-1", {})).toBeNull();
  });

  it("returns null for an http (non-https) URL", () => {
    expect(resolveFigmaUrl("http://www.figma.com/design/abc/Name?node-id=1-1", {})).toBeNull();
  });

  it("returns null for a string that is not a URL", () => {
    expect(resolveFigmaUrl("not a url", {})).toBeNull();
  });
});
