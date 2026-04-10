import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  dangerouslyBypassApprovalsAndSandbox?: boolean;
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
    const globalConfigPath = await ensureGlobalConfigPath();
    return await importConfigModule(globalConfigPath);
  }

  return await importConfigModule(configPath);
}

export async function resolveConfig(
  args: CliArgs,
): Promise<{ config: DeadpoolRunnerConfig; cwd: string }> {
  const cwd = path.resolve(args.repo ?? args.cwd ?? process.cwd());
  const fileConfig = await loadConfig(cwd, args.config);
  const config: DeadpoolRunnerConfig = {
    ...fileConfig,
    cwd,
    retries: args.retries ?? fileConfig.retries ?? 5,
    initialPrompt: args.prompt ?? fileConfig.initialPrompt,
    command: args.command ?? fileConfig.command,
    acpClient: {
      name: args.client ?? fileConfig.acpClient?.name ?? "codex",
      model: args.model ?? fileConfig.acpClient?.model,
      color: args.color ?? fileConfig.acpClient?.color,
      sandbox: args.sandbox ?? fileConfig.acpClient?.sandbox,
      dangerouslyBypassApprovalsAndSandbox:
        args.dangerouslyBypassApprovalsAndSandbox ??
        fileConfig.acpClient?.dangerouslyBypassApprovalsAndSandbox,
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
  if (configPath.endsWith(".json")) {
    const fileContents = await readFile(configPath, "utf8");
    return unwrapConfigExport(JSON.parse(fileContents));
  }

  if (/\.[cm]?tsx?$/.test(configPath)) {
    return unwrapConfigExport(await tsImport(pathToFileURL(configPath).href, import.meta.url));
  }

  return unwrapConfigExport(await import(pathToFileURL(configPath).href));
}

async function ensureGlobalConfigPath(): Promise<string> {
  const globalConfigPath = getGlobalConfigPath();
  const configDirectory = path.dirname(globalConfigPath);
  await mkdir(configDirectory, { recursive: true });

  try {
    await access(globalConfigPath);
  } catch {
    await writeFile(globalConfigPath, JSON.stringify(getDefaultGlobalConfig(), null, 2) + "\n");
  }

  return globalConfigPath;
}

function getDefaultGlobalConfig(): DeadpoolRunnerConfig {
  return {
    retries: 5,
    maxOutputChars: 12000,
    acpClient: {
      name: "codex",
      model: "gpt-5.4",
      fullAuto: true,
      color: "never",
    },
  };
}

function getGlobalConfigPath(): string {
  return path.join(homedir(), ".config", "deadpool-runner", "config.json");
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
