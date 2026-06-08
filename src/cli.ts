#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { CONFIG_FILENAME } from "./config.js";
import { CONVENTIONAL_COMPONENTS_PATHS, detectComponentsPath, init } from "./init.js";
import { CACHE_DIR, writeScanResult } from "./scan-cache.js";
import { scan } from "./scan.js";

const program = new Command();

program.name("cerebro").description("Locate every component across your apps.").version("0.0.0");

program
  .command("init")
  .description("Initialize Cerebro in this design system.")
  .argument("[path-to-components]", "Path to the components root (auto-detected if omitted)")
  .action((pathArg: string | undefined) => {
    try {
      const cwd = process.cwd();
      const componentsPath = resolveComponentsPath(pathArg, cwd);

      const result = init({ cwd, componentsPath });
      for (const warning of result.warnings) {
        console.warn(pc.yellow(`Warning: ${warning}`));
      }

      console.log(pc.cyan(`Storybook: ${result.usesStorybook ? "detected" : "not detected"}`));
      console.log(
        pc.cyan(`Code Connect: ${result.usesFigmaCodeConnect ? "detected" : "not detected"}`),
      );
      console.log(
        pc.cyan(`Git repository: ${result.tracksActivityLog ? "detected" : "not detected"}`),
      );
      console.log(
        pc.green(`Created ${CONFIG_FILENAME} (componentsPath: ${result.componentsPath})`),
      );
      if (result.gitignoreUpdated) {
        console.log(pc.green(`Added ${CACHE_DIR}/ to .gitignore`));
      }
    } catch (err) {
      console.error(pc.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan the design system and list its public Components.")
  .action(() => {
    try {
      const cwd = process.cwd();
      const result = scan({ cwd });
      for (const warning of result.warnings) {
        console.warn(pc.yellow(`Warning: ${warning}`));
      }

      const componentCount = result.components.length;
      const totals = result.components.reduce(
        (acc, c) => ({
          total: acc.total + c.tests.total,
          skipped: acc.skipped + c.tests.skipped,
          only: acc.only + c.tests.only,
          stories: acc.stories + (c.stories?.total ?? 0),
          hasStories: acc.hasStories || c.stories !== undefined,
          connections: acc.connections + (c.figmaConnections?.length ?? 0),
          hasConnections: acc.hasConnections || c.figmaConnections !== undefined,
          deprecated: acc.deprecated + (c.deprecated ? 1 : 0),
          untyped: acc.untyped + (c.propsTyping === "untyped" ? 1 : 0),
          classComponents: acc.classComponents + (c.definitionKind === "class" ? 1 : 0),
          memoWithChildren: acc.memoWithChildren + (c.memoWithChildren ? 1 : 0),
          nestedComponentDefinition:
            acc.nestedComponentDefinition + (c.nestedComponentDefinition ? 1 : 0),
          forwardRefWithoutRef: acc.forwardRefWithoutRef + (c.forwardRefWithoutRef ? 1 : 0),
        }),
        {
          total: 0,
          skipped: 0,
          only: 0,
          stories: 0,
          hasStories: false,
          connections: 0,
          hasConnections: false,
          deprecated: 0,
          untyped: 0,
          classComponents: 0,
          memoWithChildren: 0,
          nestedComponentDefinition: 0,
          forwardRefWithoutRef: 0,
        },
      );

      const componentNoun = componentCount === 1 ? "Component" : "Components";
      const testNoun = totals.total === 1 ? "test" : "tests";
      const storyNoun = totals.stories === 1 ? "story" : "stories";
      const storiesFragment = totals.hasStories ? ` ${totals.stories} ${storyNoun}.` : "";
      const connectionNoun = totals.connections === 1 ? "connection" : "connections";
      const connectionsFragment = totals.hasConnections
        ? ` ${totals.connections} Figma ${connectionNoun}.`
        : "";
      const deprecatedFragment = totals.deprecated > 0 ? ` ${totals.deprecated} deprecated.` : "";
      const untypedFragment = totals.untyped > 0 ? ` ${totals.untyped} untyped.` : "";
      const classNoun = totals.classComponents === 1 ? "component" : "components";
      const classFragment =
        totals.classComponents > 0 ? ` ${totals.classComponents} class ${classNoun}.` : "";
      const memoNoun = totals.memoWithChildren === 1 ? "memo" : "memos";
      const memoFragment =
        totals.memoWithChildren > 0 ? ` ${totals.memoWithChildren} inert ${memoNoun}.` : "";
      const nestingNoun = totals.nestedComponentDefinition === 1 ? "component" : "components";
      const nestingFragment =
        totals.nestedComponentDefinition > 0
          ? ` ${totals.nestedComponentDefinition} nesting ${nestingNoun}.`
          : "";
      const refNoun = totals.forwardRefWithoutRef === 1 ? "ref" : "refs";
      const refFragment =
        totals.forwardRefWithoutRef > 0
          ? ` ${totals.forwardRefWithoutRef} dropped ${refNoun}.`
          : "";
      const gitFragment = result.git.available
        ? result.git.shallow
          ? " Git: shallow repository."
          : " Git: repository."
        : " Git: not a repository.";
      process.stderr.write(
        pc.dim(
          `${componentCount} ${componentNoun} found. ${totals.total} ${testNoun} (${totals.skipped} skipped, ${totals.only} only).${storiesFragment}${connectionsFragment}${deprecatedFragment}${untypedFragment}${classFragment}${memoFragment}${nestingFragment}${refFragment}${gitFragment}\n`,
        ),
      );

      const cachePath = writeScanResult(cwd, result);
      process.stderr.write(pc.green(`Wrote ${cachePath}\n`));

      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(pc.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

function resolveComponentsPath(pathArg: string | undefined, cwd: string): string {
  if (pathArg !== undefined) return pathArg;

  const detected = detectComponentsPath(cwd);
  if (detected === null) {
    throw new Error(
      `Could not detect a components root.\nTried: ${CONVENTIONAL_COMPONENTS_PATHS.join(", ")}\nProvide an explicit path: cerebro init <path-to-components>`,
    );
  }

  console.log(pc.cyan(`Detected components root: ${detected}`));
  return detected;
}

program.parse();
