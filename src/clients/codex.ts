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
          stdio: ["pipe", "inherit", "inherit"],
        });

        child.stdin?.end(prompt);
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
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

function buildCodexArgs(config: ACPClientConfig, cwd: string): string[] {
  const args = ["exec", "-C", cwd, "--skip-git-repo-check"];

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
  const sections = [
    "You are fixing a failing repository command so it can pass on the next retry.",
    `Working directory: ${context.cwd}`,
    `Attempt: ${context.attempt} of ${context.maxRetries}`,
    `Command: ${formatCommand(context.command)}`,
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
