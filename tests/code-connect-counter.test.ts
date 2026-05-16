import { describe, expect, it } from "vitest";
import { countConnections } from "../src/code-connect-counter.js";

describe("countConnections", () => {
  it("returns zero for an empty file", () => {
    expect(countConnections("", "Button.figma.tsx")).toBe(0);
  });

  it("counts a single figma.connect() call", () => {
    const source = `
      import figma from "@figma/code-connect";
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-1", {});
    `;
    expect(countConnections(source, "Button.figma.tsx")).toBe(1);
  });

  it("counts every figma.connect() call in a file", () => {
    const source = `
      import figma from "@figma/code-connect";
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-1", {});
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-2", {
        variant: { Size: "Large" },
      });
      figma.connect(Button, "https://figma.com/design/abc?node-id=1-3", {});
    `;
    expect(countConnections(source, "Button.figma.tsx")).toBe(3);
  });

  it("ignores other figma.* helpers nested inside a connection", () => {
    const source = `
      import figma from "@figma/code-connect";
      figma.connect(Button, "url", {
        props: {
          size: figma.enum("Size", { Large: "lg" }),
          icon: figma.children("Icon"),
        },
      });
    `;
    expect(countConnections(source, "Button.figma.tsx")).toBe(1);
  });

  it("ignores .connect() calls on objects other than figma", () => {
    const source = `
      db.connect();
      socket.connect("host");
    `;
    expect(countConnections(source, "Button.figma.tsx")).toBe(0);
  });

  it("parses both .ts and .tsx by file extension", () => {
    const source = `figma.connect(Button, "url", {});`;
    expect(countConnections(source, "Button.figma.ts")).toBe(1);
    expect(countConnections(source, "Button.figma.tsx")).toBe(1);
  });

  it("throws a descriptive error on a fatal parse error", () => {
    expect(() => countConnections("figma.connect(", "Broken.figma.tsx")).toThrow(
      /Failed to parse Broken\.figma\.tsx/,
    );
  });
});
