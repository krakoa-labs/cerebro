import { describe, expect, it } from "vitest";
import { collectConnections } from "../src/code-connect-collector.js";

const VALID_URL = "https://figma.com/design/abc?node-id=1-1";

describe("collectConnections", () => {
  it("returns an empty list for an empty file", () => {
    expect(collectConnections("", "Button.figma.tsx", {})).toEqual([]);
  });

  it("collects a single figma.connect() call with its URL", () => {
    const source = `
      import figma from "@figma/code-connect";
      figma.connect(Button, "${VALID_URL}", {});
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([{ url: VALID_URL }]);
  });

  it("collects every figma.connect() call in source order", () => {
    const source = `
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-1", {});
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-2", {});
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-3", {});
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([
      { url: "https://figma.com/design/abc?node-id=1-1" },
      { url: "https://figma.com/design/abc?node-id=1-2" },
      { url: "https://figma.com/design/abc?node-id=1-3" },
    ]);
  });

  it("resolves a placeholder URL through the substitutions map", () => {
    const source = `figma.connect(Button, "<FIGMA_BUTTON>", {});`;
    expect(
      collectConnections(source, "Button.figma.tsx", {
        "<FIGMA_BUTTON>": "https://www.figma.com/design/abc/DS?node-id=2-2",
      }),
    ).toEqual([{ url: "https://www.figma.com/design/abc/DS?node-id=2-2" }]);
  });

  it("records a null URL for an unresolved placeholder or a non-Figma URL", () => {
    const source = `
      figma.connect(Button, "<FIGMA_UNKNOWN>", {});
      figma.connect(Button, "https://example.com/x", {});
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([
      { url: null },
      { url: null },
    ]);
  });

  it("records a null URL when the second argument is not a string literal", () => {
    const source = `
      figma.connect(Button, FIGMA_URL, {});
      figma.connect(Button, urlFor("button"), {});
      figma.connect(Button, \`https://figma.com/design/abc?node-id=1-1\`, {});
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([
      { url: null },
      { url: null },
      { url: null },
    ]);
  });

  it("records a null URL when the second argument is missing", () => {
    expect(collectConnections("figma.connect(Button);", "Button.figma.tsx", {})).toEqual([
      { url: null },
    ]);
  });

  it("reads the variant from the options argument", () => {
    const source = `
      figma.connect(Button, "${VALID_URL}", {
        variant: { Size: "Large", Disabled: true, Count: 2 },
        example: () => Button,
      });
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([
      { url: VALID_URL, variant: { Size: "Large", Disabled: true, Count: 2 } },
    ]);
  });

  it("drops a variant key whose value is not a literal and keeps the rest", () => {
    const source = `
      figma.connect(Button, "${VALID_URL}", {
        variant: { Size: SIZE, State: "on" },
      });
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([
      { url: VALID_URL, variant: { State: "on" } },
    ]);
  });

  it("omits the variant when no key has a literal value", () => {
    const source = `
      figma.connect(Button, "${VALID_URL}", {
        variant: { Size: SIZE },
      });
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([{ url: VALID_URL }]);
  });

  it("omits the variant when the call declares none", () => {
    const source = `figma.connect(Button, "${VALID_URL}", { example: () => Button });`;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([{ url: VALID_URL }]);
  });

  it("ignores other figma.* helpers nested inside a connection", () => {
    const source = `
      figma.connect(Button, "${VALID_URL}", {
        props: {
          size: figma.enum("Size", { Large: "lg" }),
          icon: figma.children("Icon"),
        },
      });
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([{ url: VALID_URL }]);
  });

  it("ignores .connect() calls on objects other than figma", () => {
    const source = `
      db.connect();
      socket.connect("host");
    `;
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([]);
  });

  it("parses both .ts and .tsx by file extension", () => {
    const source = `figma.connect(Button, "${VALID_URL}", {});`;
    expect(collectConnections(source, "Button.figma.ts", {})).toEqual([{ url: VALID_URL }]);
    expect(collectConnections(source, "Button.figma.tsx", {})).toEqual([{ url: VALID_URL }]);
  });

  it("throws a descriptive error on a fatal parse error", () => {
    expect(() => collectConnections("figma.connect(", "Broken.figma.tsx", {})).toThrow(
      /Failed to parse Broken\.figma\.tsx/,
    );
  });
});
