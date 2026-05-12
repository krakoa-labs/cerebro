#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { CONFIG_FILENAME, init } from "./init.js";

const program = new Command();

program.name("cerebro").description("Locate every component across your apps.").version("0.0.0");

program
  .command("init")
  .description("Initialize Cerebro in this design system.")
  .argument("<path-to-components>", "Path to the directory containing components")
  .action((pathArg: string) => {
    try {
      const result = init({ cwd: process.cwd(), componentsPath: pathArg });
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

program.parse();
