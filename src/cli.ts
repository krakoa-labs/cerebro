#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { CONFIG_FILENAME } from "./config.js";
import { CONVENTIONAL_COMPONENTS_PATHS, detectComponentsPath, init } from "./init.js";
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
        pc.green(`Created ${CONFIG_FILENAME} (componentsPath: ${result.componentsPath})`),
      );
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
      const result = scan({ cwd: process.cwd() });
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
          deprecated: acc.deprecated + (c.deprecated ? 1 : 0),
          untyped: acc.untyped + (c.propsTyping === "untyped" ? 1 : 0),
          classComponents: acc.classComponents + (c.definitionKind === "class" ? 1 : 0),
        }),
        {
          total: 0,
          skipped: 0,
          only: 0,
          stories: 0,
          hasStories: false,
          deprecated: 0,
          untyped: 0,
          classComponents: 0,
        },
      );

      const componentNoun = componentCount === 1 ? "Component" : "Components";
      const testNoun = totals.total === 1 ? "test" : "tests";
      const storyNoun = totals.stories === 1 ? "story" : "stories";
      const storiesFragment = totals.hasStories ? ` ${totals.stories} ${storyNoun}.` : "";
      const deprecatedFragment = totals.deprecated > 0 ? ` ${totals.deprecated} deprecated.` : "";
      const untypedFragment = totals.untyped > 0 ? ` ${totals.untyped} untyped.` : "";
      const classNoun = totals.classComponents === 1 ? "component" : "components";
      const classFragment =
        totals.classComponents > 0 ? ` ${totals.classComponents} class ${classNoun}.` : "";
      process.stderr.write(
        pc.dim(
          `${componentCount} ${componentNoun} found. ${totals.total} ${testNoun} (${totals.skipped} skipped, ${totals.only} only).${storiesFragment}${deprecatedFragment}${untypedFragment}${classFragment}\n`,
        ),
      );

      console.log(JSON.stringify(result.components, null, 2));
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
