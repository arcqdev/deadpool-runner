import { createRunner } from "./runner.js";
import type { DeadpoolRunnerConfig, RunResult, RunnerDependencies } from "./types.js";

export function defineDeadpoolRunnerConfig(config: DeadpoolRunnerConfig): DeadpoolRunnerConfig {
  return config;
}

export async function runDeadpoolRunner(
  config: DeadpoolRunnerConfig,
  deps?: RunnerDependencies,
): Promise<RunResult> {
  return await createRunner(deps).run(config);
}
