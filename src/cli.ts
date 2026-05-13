#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import {
  CONFIG_FILENAME,
  CONVENTIONAL_COMPONENTS_PATHS,
  detectComponentsPath,
  init,
} from "./init.js";
import { scan } from "./scan.js";

const program = new Command();

program.name("cerebro").description("Locate every component across your apps.").version("0.0.0");

program
  .command("init")
  .description("Initialize Cerebro in this design system.")
  .argument(
    "[path-to-components]",
    "Path to the directory containing components (auto-detected if omitted)",
  )
  .action((pathArg: string | undefined) => {
    try {
      const cwd = process.cwd();
      let componentsPath: string;
      if (pathArg !== undefined) {
        componentsPath = pathArg;
      } else {
        const detected = detectComponentsPath(cwd);
        if (detected === null) {
          throw new Error(
            `Could not detect a components folder.\nTried: ${CONVENTIONAL_COMPONENTS_PATHS.join(", ")}\nProvide an explicit path: cerebro init <path-to-components>`,
          );
        }
        componentsPath = detected;
        console.log(pc.cyan(`Detected components folder: ${detected}`));
      }
      const result = init({ cwd, componentsPath });
      for (const warning of result.warnings) {
        console.warn(pc.yellow(`Warning: ${warning}`));
      }
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
      const count = result.components.length;
      process.stderr.write(pc.dim(`${count} ${count === 1 ? "Component" : "Components"} found.\n`));
      console.log(JSON.stringify(result.components, null, 2));
    } catch (err) {
      console.error(pc.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
