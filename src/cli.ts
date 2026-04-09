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
      help: { type: "boolean", short: "h" },
      verbose: { type: "boolean", short: "v" },
      config: { type: "string" },
      cwd: { type: "string" },
      repo: { type: "string" },
      client: { type: "string" },
      retries: { type: "string" },
      "max-output-chars": { type: "string" },
      prompt: { type: "string" },
      model: { type: "string" },
      color: { type: "string" },
    },
    allowPositionals: true,
  });

  const positional = [...values.positionals, ...afterSeparator];
  const command = normalizeCommand(positional);
  const retries = values.values.retries ? Number(values.values.retries) : undefined;
  const maxOutputChars = values.values["max-output-chars"]
    ? Number(values.values["max-output-chars"])
    : undefined;

  if (values.values.retries && Number.isNaN(retries)) {
    throw new Error(`Invalid retries value "${values.values.retries}".`);
  }

  if (values.values["max-output-chars"] && Number.isNaN(maxOutputChars)) {
    throw new Error(`Invalid max output chars value "${values.values["max-output-chars"]}".`);
  }

  return {
    help: values.values.help,
    verbose: values.values.verbose,
    config: values.values.config,
    cwd: values.values.cwd,
    repo: values.values.repo,
    client: values.values.client,
    retries,
    maxOutputChars,
    prompt: values.values.prompt,
    model: values.values.model,
    color: values.values.color as CliArgs["color"],
    command,
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseCliArgs(argv);

  if (args.help) {
    process.stdout.write(getHelpText());
    return 0;
  }

  const { config, cwd } = await resolveConfig(args);
  const runner = createRunner();
  const result = await runner.run({
    ...config,
    cwd,
  });

  return result.code;
}

export function getHelpText(): string {
  return `dpr [options] -- <command> [args...]

Options:
  -h, --help           Show this help message
  -v, --verbose        Stream detailed ACP client logs during fix attempts
  --config <path>      Explicit config file path
  --cwd <path>         Working directory for the wrapped command and ACP client
  --repo <path>        Alias for --cwd, for targeting a specific repository
  --client <name>      ACP client name, currently codex
  --retries <n>        Maximum fixer attempts after the initial failure
  --max-output-chars <n>
                       Maximum trailing error characters sent to the ACP client
  --prompt <text>      Seed prompt with repo context for the fixer
  --model <name>       Model override for the built-in Codex client
  --color <mode>       auto, always, or never for codex exec
`;
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
