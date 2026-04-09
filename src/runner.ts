import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
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
      const runArtifacts = await createRunArtifacts(config);
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
  runDirectory: string;
  solutionPath: string;
  fullErrorPath: string;
  inputErrorPath: string;
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

  const solutionPath = path.join(runDirectory, "solution.md");
  const fullErrorPath = path.join(runDirectory, "full-error.md");
  const inputErrorPath = path.join(runDirectory, "input-error.md");

  await writeFile(
    solutionPath,
    ["# Solution", "", "Write down what your solution was for this run.", ""].join("\n"),
  );

  return {
    runDirectory,
    solutionPath,
    fullErrorPath,
    inputErrorPath,
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
