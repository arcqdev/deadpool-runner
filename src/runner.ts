import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "./config.js";
import { createCritiqueJudge } from "./critique.js";
import { runCommand } from "./process.js";
import type {
  CritiqueResult,
  DeadpoolRunnerConfig,
  FailureContext,
  RunResult,
  RunnerDependencies,
} from "./types.js";

export function createRunner(deps: RunnerDependencies = {}) {
  const run = deps.runCommand ?? runCommand;
  const create = deps.createClient ?? createClient;
  const createJudge = deps.createCritiqueJudge ?? createCritiqueJudge;

  return {
    async run(config: DeadpoolRunnerConfig): Promise<RunResult> {
      if (!config.command) {
        throw new Error("No command provided. Set command in config or pass one via the CLI.");
      }

      const client = create(config);
      const maxRetries = Math.max(0, config.retries ?? 5);
      const runArtifacts = await createRunArtifacts(config);
      const critiqueEnabled = config.critique?.enabled !== false;
      const repeatFailureLimit = Math.max(0, config.critique?.repeatFailureLimit ?? 1);
      const judge = critiqueEnabled ? createJudge(config) : undefined;
      let attempt = 0;
      let previousFailure: PreviousFailure | undefined;

      while (true) {
        const result = await run(config.command, {
          cwd: config.cwd,
          env: {
            ...process.env,
            ...config.env,
          },
        });

        if (result.code === 0) {
          await writeRepeatFailureState(runArtifacts, {
            consecutiveSameFailureCount: 0,
            repeatFailureLimit,
            critiqueEnabled,
            lastFailure: undefined,
          });
          return result;
        }

        const combinedOutput =
          config.maxOutputChars && result.combinedOutput.length > config.maxOutputChars
            ? result.combinedOutput.slice(-config.maxOutputChars)
            : result.combinedOutput;

        const currentFailure: PreviousFailure = {
          attempt: attempt + 1,
          combinedOutput,
          runDirectory: runArtifacts.runDirectory,
          repeatCount: 0,
        };

        const critiqueResult =
          judge && previousFailure
            ? await judge({
                cwd: config.cwd ?? process.cwd(),
                command: config.command,
                previousOutput: previousFailure.combinedOutput,
                currentOutput: combinedOutput,
                previousAttempt: previousFailure.attempt,
                currentAttempt: currentFailure.attempt,
                previousRunDirectory: previousFailure.runDirectory,
                currentRunDirectory: runArtifacts.runDirectory,
                initialPrompt: config.initialPrompt,
              })
            : undefined;

        const consecutiveSameFailureCount =
          critiqueResult?.sameFailure && previousFailure ? previousFailure.repeatCount + 1 : 0;

        currentFailure.repeatCount = consecutiveSameFailureCount;

        await writeRepeatFailureState(runArtifacts, {
          consecutiveSameFailureCount,
          repeatFailureLimit,
          critiqueEnabled,
          lastFailure: {
            attempt: currentFailure.attempt,
            combinedOutput,
            runDirectory: runArtifacts.runDirectory,
          },
          critiqueResult,
        });

        previousFailure = currentFailure;

        if (critiqueEnabled && consecutiveSameFailureCount >= repeatFailureLimit) {
          return result;
        }

        if (attempt >= maxRetries) {
          return result;
        }

        attempt += 1;

        await writeRunArtifacts(runArtifacts, {
          attempt,
          maxRetries,
          fullCombinedOutput: result.combinedOutput,
          combinedOutput,
        });

        const context: FailureContext = {
          attempt,
          maxRetries,
          cwd: config.cwd ?? process.cwd(),
          command: config.command,
          initialPrompt: config.initialPrompt,
          stdout: result.stdout,
          stderr: result.stderr,
          fullCombinedOutput: result.combinedOutput,
          combinedOutput,
          runDirectory: runArtifacts.runDirectory,
          solutionPath: runArtifacts.solutionPath,
          fullErrorPath: runArtifacts.fullErrorPath,
          inputErrorPath: runArtifacts.inputErrorPath,
        };

        await client.fixFailure(context);
      }
    },
  };
}

interface RunArtifacts {
  hashDirectory: string;
  runDirectory: string;
  commandPath: string;
  solutionPath: string;
  fullErrorPath: string;
  inputErrorPath: string;
  repeatFailureStatePath: string;
}

async function createRunArtifacts(config: DeadpoolRunnerConfig): Promise<RunArtifacts> {
  const cwd = config.cwd ?? process.cwd();
  const command = formatCommand(config.command);
  const runHash = createHash("sha256").update(`${cwd}\n${command}`).digest("hex").slice(0, 12);
  const hashDirectory = path.join(homedir(), ".deadpool-runner", "runs", runHash);
  await mkdir(hashDirectory, { recursive: true });

  const runNumber = await getNextRunNumber(hashDirectory);
  const runDirectory = path.join(hashDirectory, String(runNumber));
  await mkdir(runDirectory, { recursive: true });

  const commandPath = path.join(hashDirectory, "command.txt");
  const solutionPath = path.join(runDirectory, "solution.md");
  const fullErrorPath = path.join(runDirectory, "full-error.md");
  const inputErrorPath = path.join(runDirectory, "input-error.md");
  const repeatFailureStatePath = path.join(runDirectory, "repeat-failure-state.json");

  await writeFile(commandPath, `${command}\n`);
  await writeFile(path.join(runDirectory, "command.txt"), `${command}\n`);

  await writeFile(
    solutionPath,
    ["# Solution", "", "Write down what your solution was for this run.", ""].join("\n"),
  );

  return {
    hashDirectory,
    runDirectory,
    commandPath,
    solutionPath,
    fullErrorPath,
    inputErrorPath,
    repeatFailureStatePath,
  };
}

async function getNextRunNumber(hashDirectory: string): Promise<number> {
  const entries = await readdir(hashDirectory, { withFileTypes: true });
  const maxExisting = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => Number(entry.name))
    .filter((value) => Number.isInteger(value) && value > 0)
    .reduce((max, value) => Math.max(max, value), 0);

  return maxExisting + 1;
}

async function writeRunArtifacts(
  artifacts: RunArtifacts,
  data: {
    attempt: number;
    maxRetries: number;
    fullCombinedOutput: string;
    combinedOutput: string;
  },
) {
  const header = [`# Failure Input`, "", `Attempt ${data.attempt} of ${data.maxRetries}`, ""].join(
    "\n",
  );

  await writeFile(
    artifacts.fullErrorPath,
    `${header}\`\`\`text\n${data.fullCombinedOutput || "<no output captured>"}\n\`\`\`\n`,
  );
  await writeFile(
    artifacts.inputErrorPath,
    `${header}\`\`\`text\n${data.combinedOutput || "<no output captured>"}\n\`\`\`\n`,
  );
}

function formatCommand(command: DeadpoolRunnerConfig["command"]): string {
  if (!command) {
    return "";
  }

  return typeof command === "string"
    ? command
    : command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

interface PreviousFailure {
  attempt: number;
  combinedOutput: string;
  runDirectory: string;
  repeatCount: number;
}

async function writeRepeatFailureState(
  artifacts: RunArtifacts,
  data: {
    consecutiveSameFailureCount: number;
    repeatFailureLimit: number;
    critiqueEnabled: boolean;
    lastFailure:
      | {
          attempt: number;
          combinedOutput: string;
          runDirectory: string;
        }
      | undefined;
    critiqueResult?: CritiqueResult;
  },
) {
  await writeFile(
    artifacts.repeatFailureStatePath,
    JSON.stringify(
      {
        critiqueEnabled: data.critiqueEnabled,
        repeatFailureLimit: data.repeatFailureLimit,
        consecutiveSameFailureCount: data.consecutiveSameFailureCount,
        commandPath: artifacts.commandPath,
        hashDirectory: artifacts.hashDirectory,
        runDirectory: artifacts.runDirectory,
        lastFailure: data.lastFailure,
        critiqueResult: data.critiqueResult,
      },
      null,
      2,
    ) + "\n",
  );
}
