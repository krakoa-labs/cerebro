import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveComponentSource } from "../src/reexport-resolution.js";

// No design system under test uses tsconfig path aliases here.
const noAliases = () => [];

describe("resolveComponentSource", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cerebro-reexport-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Writes a file under the temp root, creating parent directories. */
  function write(relativePath: string, contents: string): string {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
    return absolute;
  }

  /** Writes the barrel and resolves `exportName` out of it. */
  function resolve(barrelContents: string, exportName: string): string | null {
    const barrel = write("index.ts", barrelContents);
    return resolveComponentSource(barrel, exportName, noAliases);
  }

  it("resolves a direct re-export to the declaring file", () => {
    const file = write("Button/Button.tsx", "export function Button() {}");
    expect(resolve(`export { Button } from "./Button/Button";`, "Button")).toBe(file);
  });

  it("follows a default import re-exported by name through a folder index", () => {
    const file = write("Card/Card.tsx", "export default function Card() {}");
    write("Card/index.ts", `import Card from "./Card";\nexport default Card;`);
    const barrel = `import Card from "./Card";\nexport { Card };`;
    expect(resolve(barrel, "Card")).toBe(file);
  });

  it("resolves two Components sharing a folder to their distinct files", () => {
    const alert = write("Pair/Alert/Alert.tsx", "export default function Alert() {}");
    write("Pair/Alert/index.ts", `import Alert from "./Alert";\nexport default Alert;`);
    const badge = write("Pair/Badge.tsx", "export default function Badge() {}");
    write(
      "Pair/index.ts",
      `import Alert from "./Alert";\nimport Badge from "./Badge";\nexport { Alert, Badge };`,
    );
    const barrel = `import { Alert, Badge } from "./Pair";\nexport { Alert, Badge };`;
    expect(resolve(barrel, "Alert")).toBe(alert);
    expect(resolve(barrel, "Badge")).toBe(badge);
  });

  it("follows a renamed re-export", () => {
    const file = write("Combobox/Inner.tsx", "export default function Inner() {}");
    write("Combobox/index.ts", `import Inner from "./Inner";\nexport { Inner };`);
    const barrel = `import { Inner } from "./Combobox";\nexport { Inner as Combobox };`;
    expect(resolve(barrel, "Combobox")).toBe(file);
  });

  it("stops at the folder index when it declares the Component locally", () => {
    const index = write(
      "Wrapped/index.ts",
      `import Inner from "./Inner";\nconst Wrapped = hoc(Inner);\nexport default Wrapped;`,
    );
    write("Wrapped/Inner.tsx", "export default function Inner() {}");
    const barrel = `import Wrapped from "./Wrapped";\nexport { Wrapped };`;
    expect(resolve(barrel, "Wrapped")).toBe(index);
  });

  it("returns the barrel itself for a Component declared in the barrel", () => {
    const barrel = write("index.ts", `export const Token = "token";`);
    expect(resolveComponentSource(barrel, "Token", noAliases)).toBe(barrel);
  });

  it("returns null when the export points at no resolvable module", () => {
    expect(resolve(`export { Ghost } from "./does-not-exist";`, "Ghost")).toBeNull();
  });

  it("stops without looping on a re-export cycle", () => {
    write("a.ts", `export { X } from "./b";`);
    write("b.ts", `export { X } from "./a";`);
    const resolved = resolve(`export { X } from "./a";`, "X");
    expect(resolved).toBe(join(root, "a.ts"));
  });
});
