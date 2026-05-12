#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program.name("cerebro").description("Locate every component across your apps.").version("0.0.0");

program.parse();
