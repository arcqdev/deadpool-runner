import { spawn } from "node:child_process";
import type { ACPClient, ACPClientConfig, FailureContext, FixResult } from "../types.js";

export function createCodexClient(config: ACPClientConfig = {}): ACPClient {
  return {
    name: "codex",
    async fixFailure(context: FailureContext): Promise<FixResult> {
      const executable = config.executable ?? "codex";
      const args = buildCodexArgs(config, context.cwd);
      const prompt = buildPrompt(context);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          cwd: context.cwd,
          env: process.env,
          stdio: config.verbose ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
        });

        if (config.verbose) {
          process.stderr.write(
            `[acp-client] starting codex fix attempt ${context.attempt}/${context.maxRetries}\n`,
          );
          process.stderr.write(`[acp-client] command: ${executable} ${args.join(" ")}\n`);
          pipePrefixedOutput(child.stdout, process.stdout);
          pipePrefixedOutput(child.stderr, process.stderr);
        }

        child.stdin?.end(prompt);
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            if (config.verbose) {
              process.stderr.write(
                `[acp-client] codex fix attempt ${context.attempt} completed successfully\n`,
              );
            }
            resolve();
            return;
          }

          if (config.verbose) {
            process.stderr.write(`[acp-client] codex fixer exited with code ${code ?? 1}\n`);
          }
          reject(new Error(`Codex fixer exited with code ${code ?? 1}.`));
        });
      });

      return {
        summary: `Applied Codex fix attempt ${context.attempt}.`,
      };
    },
  };
}

export function buildCodexArgs(config: ACPClientConfig, cwd: string): string[] {
  const args = ["exec", "-C", cwd, "--skip-git-repo-check"];

  if (config.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (config.sandbox) {
    args.push("--sandbox", config.sandbox);
  }

  if (config.fullAuto !== false) {
    args.push("--full-auto");
  }

  if (config.model) {
    args.push("--model", config.model);
  }

  if (config.color) {
    args.push("--color", config.color);
  }

  if (config.extraArgs?.length) {
    args.push(...config.extraArgs);
  }

  args.push("-");
  return args;
}

function buildPrompt(context: FailureContext): string {
  const command = formatCommand(context.command);
  const sections = [
    `We ran this script: ${command}`,
    "There were errors that you need to fix.",
    `Write down what your solution was in ${context.solutionPath}.`,
    `The full captured error is in ${context.fullErrorPath}.`,
    `The truncated input error that was sent to you is in ${context.inputErrorPath}.`,
    "You are fixing a failing repository command so it can pass on the next retry.",
    `Working directory: ${context.cwd}`,
    `Run directory: ${context.runDirectory}`,
    `Attempt: ${context.attempt} of ${context.maxRetries}`,
    `Command: ${command}`,
  ];

  if (context.initialPrompt) {
    sections.push("Additional repository context:", context.initialPrompt);
  }

  sections.push(
    "Requirements:",
    "- Fix the underlying cause in the repository.",
    "- Do not replace the command with a weaker one.",
    "- Keep the fix minimal and rerunnable.",
    "- Stop after making the required changes.",
    "Captured command output:",
    "```text",
    context.combinedOutput || "<no output captured>",
    "```",
  );

  return sections.join("\n\n");
}

function formatCommand(command: FailureContext["command"]): string {
  return typeof command === "string"
    ? command
    : command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function pipePrefixedOutput(
  stream: NodeJS.ReadableStream | null | undefined,
  target: NodeJS.WriteStream,
) {
  if (!stream) {
    return;
  }

  let remainder = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    remainder += chunk;
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";

    for (const line of lines) {
      target.write(`[acp-client] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (remainder.length > 0) {
      target.write(`[acp-client] ${remainder}\n`);
    }
  });
}
