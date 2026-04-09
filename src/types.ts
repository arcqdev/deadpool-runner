import type { SpawnOptions } from "node:child_process";
import type { Writable } from "node:stream";

export type CommandSpec = string | readonly [string, ...string[]];

export interface FixResult {
  summary?: string;
}

export interface RunResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
}

export interface FailureContext {
  attempt: number;
  maxRetries: number;
  cwd: string;
  command: CommandSpec;
  initialPrompt?: string;
  stdout: string;
  stderr: string;
  fullCombinedOutput: string;
  combinedOutput: string;
  runDirectory: string;
  solutionPath: string;
  fullErrorPath: string;
  inputErrorPath: string;
}

export interface ACPClient {
  readonly name: string;
  fixFailure(context: FailureContext): Promise<FixResult>;
}

export interface ACPClientConfig {
  name?: string;
  model?: string;
  color?: "auto" | "always" | "never";
  verbose?: boolean;
  fullAuto?: boolean;
  extraArgs?: string[];
  executable?: string;
}

export interface DeadpoolRunnerConfig {
  command?: CommandSpec;
  cwd?: string;
  retries?: number;
  initialPrompt?: string;
  maxOutputChars?: number;
  env?: Record<string, string | undefined>;
  acpClient?: ACPClientConfig;
}

export interface RunnerDependencies {
  createClient?: (config: DeadpoolRunnerConfig) => ACPClient;
  runCommand?: (
    command: CommandSpec,
    options: SpawnOptions & {
      stdout?: Writable;
      stderr?: Writable;
    },
  ) => Promise<RunResult>;
}
