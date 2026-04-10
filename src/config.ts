import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { getACPClientFactory } from "./client-registry.js";
import type {
  ACPClient,
  ACPClientConfig,
  CommandSpec,
  CritiqueConfig,
  DeadpoolRunnerConfig,
} from "./types.js";

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
    critique: resolveCritiqueConfig(fileConfig.critique, fileConfig.acpClient),
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
    critique: {
      enabled: true,
      repeatFailureLimit: 1,
      acpClient: {
        sandbox: "read-only",
        fullAuto: false,
        color: "never",
      },
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

function resolveCritiqueConfig(
  fileCritiqueConfig: CritiqueConfig | undefined,
  fixerClientConfig: DeadpoolRunnerConfig["acpClient"],
): CritiqueConfig {
  const enabledOverride = parseBooleanEnv(process.env.DEADPOOL_RUNNER_DISABLE_CRITIQUE);
  const repeatFailureLimitOverride = parseIntegerEnv(
    process.env.DEADPOOL_RUNNER_REPEAT_FAILURE_LIMIT,
  );

  return {
    enabled:
      enabledOverride === undefined ? (fileCritiqueConfig?.enabled ?? true) : !enabledOverride,
    repeatFailureLimit: repeatFailureLimitOverride ?? fileCritiqueConfig?.repeatFailureLimit ?? 1,
    acpClient: {
      name:
        process.env.DEADPOOL_RUNNER_CRITIQUE_CLIENT ??
        fileCritiqueConfig?.acpClient?.name ??
        fixerClientConfig?.name ??
        "codex",
      model:
        process.env.DEADPOOL_RUNNER_CRITIQUE_MODEL ??
        fileCritiqueConfig?.acpClient?.model ??
        fixerClientConfig?.model,
      color:
        (process.env.DEADPOOL_RUNNER_CRITIQUE_COLOR as ACPClientConfig["color"]) ??
        fileCritiqueConfig?.acpClient?.color ??
        fixerClientConfig?.color ??
        "never",
      sandbox:
        (process.env.DEADPOOL_RUNNER_CRITIQUE_SANDBOX as ACPClientConfig["sandbox"]) ??
        fileCritiqueConfig?.acpClient?.sandbox ??
        "read-only",
      dangerouslyBypassApprovalsAndSandbox:
        parseBooleanEnv(process.env.DEADPOOL_RUNNER_CRITIQUE_BYPASS_SANDBOX) ??
        fileCritiqueConfig?.acpClient?.dangerouslyBypassApprovalsAndSandbox ??
        false,
      verbose: fileCritiqueConfig?.acpClient?.verbose ?? fixerClientConfig?.verbose,
      fullAuto:
        parseBooleanEnv(process.env.DEADPOOL_RUNNER_CRITIQUE_FULL_AUTO) ??
        fileCritiqueConfig?.acpClient?.fullAuto ??
        false,
      extraArgs: fileCritiqueConfig?.acpClient?.extraArgs,
      executable:
        process.env.DEADPOOL_RUNNER_CRITIQUE_EXECUTABLE ??
        fileCritiqueConfig?.acpClient?.executable ??
        fixerClientConfig?.executable,
    },
  };
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
