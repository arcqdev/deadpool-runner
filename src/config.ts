import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { getACPClientFactory } from "./client-registry.js";
import type { ACPClient, CommandSpec, DeadpoolRunnerConfig } from "./types.js";

const DEFAULT_CONFIG_FILES = [
  "deadpool-runner.config.ts",
  "deadpool-runner.config.mts",
  "deadpool-runner.config.js",
  "deadpool-runner.config.mjs",
] as const;

export interface CliArgs {
  config?: string;
  cwd?: string;
  repo?: string;
  client?: string;
  retries?: number;
  maxOutputChars?: number;
  prompt?: string;
  model?: string;
  color?: "auto" | "always" | "never";
  command?: CommandSpec;
  help?: boolean;
  verbose?: boolean;
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<DeadpoolRunnerConfig> {
  const configPath = explicitPath ? path.resolve(cwd, explicitPath) : await findConfigPath(cwd);

  if (!configPath) {
    return {};
  }

  const imported = await importConfigModule(configPath);
  const config = unwrapConfigExport(imported);
  return config satisfies DeadpoolRunnerConfig;
}

export async function resolveConfig(
  args: CliArgs,
): Promise<{ config: DeadpoolRunnerConfig; cwd: string }> {
  const cwd = path.resolve(args.repo ?? args.cwd ?? process.cwd());
  const fileConfig = await loadConfig(cwd, args.config);
  const config: DeadpoolRunnerConfig = {
    ...fileConfig,
    cwd,
    retries: args.retries ?? fileConfig.retries ?? 3,
    initialPrompt: args.prompt ?? fileConfig.initialPrompt,
    command: args.command ?? fileConfig.command,
    acpClient: {
      name: args.client ?? fileConfig.acpClient?.name ?? "codex",
      model: args.model ?? fileConfig.acpClient?.model,
      color: args.color ?? fileConfig.acpClient?.color,
      verbose: args.verbose ?? fileConfig.acpClient?.verbose,
      fullAuto: fileConfig.acpClient?.fullAuto,
      extraArgs: fileConfig.acpClient?.extraArgs,
      executable: fileConfig.acpClient?.executable,
    },
    env: fileConfig.env,
    maxOutputChars: args.maxOutputChars ?? fileConfig.maxOutputChars ?? 12000,
  };

  return { config, cwd };
}

export function createClient(config: DeadpoolRunnerConfig): ACPClient {
  const clientName = config.acpClient?.name ?? "codex";
  const factory = getACPClientFactory(clientName);

  if (factory) {
    return factory(config.acpClient);
  }

  throw new Error(`Unsupported ACP client "${clientName}".`);
}

async function findConfigPath(cwd: string): Promise<string | undefined> {
  for (const name of DEFAULT_CONFIG_FILES) {
    const candidate = path.join(cwd, name);
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  return undefined;
}

async function importConfigModule(configPath: string) {
  if (/\.[cm]?tsx?$/.test(configPath)) {
    return await tsImport(pathToFileURL(configPath).href, import.meta.url);
  }

  return await import(pathToFileURL(configPath).href);
}

function unwrapConfigExport(moduleValue: unknown): DeadpoolRunnerConfig {
  let current = moduleValue;

  while (isRecord(current) && "default" in current) {
    current = current.default;
  }

  if (isRecord(current) && "config" in current) {
    return current.config as DeadpoolRunnerConfig;
  }

  return (current ?? {}) as DeadpoolRunnerConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
