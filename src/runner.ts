import { createClient } from "./config.js";
import { runCommand } from "./process.js";
import type {
  DeadpoolRunnerConfig,
  FailureContext,
  RunResult,
  RunnerDependencies,
} from "./types.js";

export function createRunner(deps: RunnerDependencies = {}) {
  const run = deps.runCommand ?? runCommand;
  const create = deps.createClient ?? createClient;

  return {
    async run(config: DeadpoolRunnerConfig): Promise<RunResult> {
      if (!config.command) {
        throw new Error("No command provided. Set command in config or pass one via the CLI.");
      }

      const client = create(config);
      const maxRetries = Math.max(0, config.retries ?? 3);
      let attempt = 0;

      while (true) {
        const result = await run(config.command, {
          cwd: config.cwd,
          env: {
            ...process.env,
            ...config.env,
          },
        });

        if (result.code === 0) {
          return result;
        }

        if (attempt >= maxRetries) {
          return result;
        }

        attempt += 1;

        const combinedOutput =
          config.maxOutputChars && result.combinedOutput.length > config.maxOutputChars
            ? result.combinedOutput.slice(-config.maxOutputChars)
            : result.combinedOutput;

        const context: FailureContext = {
          attempt,
          maxRetries,
          cwd: config.cwd ?? process.cwd(),
          command: config.command,
          initialPrompt: config.initialPrompt,
          stdout: result.stdout,
          stderr: result.stderr,
          combinedOutput,
        };

        await client.fixFailure(context);
      }
    },
  };
}
