#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolveConfig, type CliArgs } from "./config.js";
import { createRunner } from "./runner.js";
import type { CommandSpec } from "./types.js";

export function parseCliArgs(argv = process.argv.slice(2)): CliArgs {
  const separatorIndex = argv.indexOf("--");
  const beforeSeparator = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const afterSeparator = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const values = parseArgs({
    args: beforeSeparator,
    options: {
      config: { type: "string" },
      cwd: { type: "string" },
      client: { type: "string" },
      retries: { type: "string" },
      prompt: { type: "string" },
      model: { type: "string" },
      color: { type: "string" },
    },
    allowPositionals: true,
  });

  const positional = [...values.positionals, ...afterSeparator];
  const command = normalizeCommand(positional);
  const retries = values.values.retries ? Number(values.values.retries) : undefined;

  if (values.values.retries && Number.isNaN(retries)) {
    throw new Error(`Invalid retries value "${values.values.retries}".`);
  }

  return {
    config: values.values.config,
    cwd: values.values.cwd,
    client: values.values.client,
    retries,
    prompt: values.values.prompt,
    model: values.values.model,
    color: values.values.color as CliArgs["color"],
    command,
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseCliArgs(argv);
  const { config, cwd } = await resolveConfig(args);
  const runner = createRunner();
  const result = await runner.run({
    ...config,
    cwd,
  });

  return result.code;
}

function normalizeCommand(parts: string[]): CommandSpec | undefined {
  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return parts as [string, ...string[]];
}
