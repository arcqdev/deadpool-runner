import { spawn } from "node:child_process";
import type {
  ACPClientConfig,
  CritiqueContext,
  CritiqueJudge,
  CritiqueResult,
  DeadpoolRunnerConfig,
} from "./types.js";
import { buildCodexArgs } from "./clients/codex.js";

export function createCritiqueJudge(config: DeadpoolRunnerConfig): CritiqueJudge {
  const critiqueClient = resolveCritiqueACPClient(config);

  if ((critiqueClient.name ?? "codex") !== "codex") {
    throw new Error(`Unsupported critique ACP client "${critiqueClient.name}".`);
  }

  return async (context: CritiqueContext): Promise<CritiqueResult> => {
    const executable = critiqueClient.executable ?? "codex";
    const args = buildCodexArgs(critiqueClient, context.cwd);
    const prompt = buildCritiquePrompt(context);

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: context.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      if (critiqueClient.verbose) {
        process.stderr.write(
          `[critique-client] starting critique for attempts ${context.previousAttempt} -> ${context.currentAttempt}\n`,
        );
        process.stderr.write(`[critique-client] command: ${executable} ${args.join(" ")}\n`);
      }

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        if (critiqueClient.verbose) {
          process.stderr.write(`[critique-client] ${chunk}`);
          if (!chunk.endsWith("\n")) {
            process.stderr.write("\n");
          }
        }
      });

      child.stdin?.end(prompt);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        reject(
          new Error(
            `Critique ACP exited with code ${code ?? 1}.${stderr ? ` ${stderr.trim()}` : ""}`,
          ),
        );
      });
    });

    return parseCritiqueResult(output);
  };
}

function resolveCritiqueACPClient(config: DeadpoolRunnerConfig): ACPClientConfig {
  const critiqueConfig = config.critique?.acpClient ?? {};
  const fixerConfig = config.acpClient ?? {};

  return {
    name: critiqueConfig.name ?? fixerConfig.name ?? "codex",
    model: critiqueConfig.model ?? fixerConfig.model,
    color: critiqueConfig.color ?? fixerConfig.color ?? "never",
    sandbox: critiqueConfig.sandbox ?? "read-only",
    dangerouslyBypassApprovalsAndSandbox:
      critiqueConfig.dangerouslyBypassApprovalsAndSandbox ?? false,
    verbose: critiqueConfig.verbose ?? fixerConfig.verbose,
    fullAuto: critiqueConfig.fullAuto ?? false,
    extraArgs: critiqueConfig.extraArgs,
    executable: critiqueConfig.executable ?? fixerConfig.executable,
  };
}

function buildCritiquePrompt(context: CritiqueContext): string {
  const command = formatCommand(context.command);

  return [
    "You are a safeguard for a self-healing CLI loop.",
    "Your job is to decide whether two consecutive failures are broadly the same failure type.",
    "Bias toward calling them the same failure if rerunning a fixer would likely waste tokens on the same unresolved issue.",
    "Do not require exact string matches. Treat wording changes, stack trace shifts, line number changes, and equivalent symptoms as the same failure when they point to the same underlying blocker.",
    "Do not be so broad that unrelated failures collapse together. Different root causes or clearly different blockers should be treated as different failures.",
    "This decision is used to stop infinite repair loops, such as when the fixer keeps failing to make a required change.",
    "",
    "Respond with JSON only in this exact shape:",
    '{"sameFailure":true,"reason":"short explanation"}',
    "",
    `Working directory: ${context.cwd}`,
    `Command: ${command}`,
    `Previous attempt: ${context.previousAttempt}`,
    `Current attempt: ${context.currentAttempt}`,
    `Previous run directory: ${context.previousRunDirectory}`,
    `Current run directory: ${context.currentRunDirectory}`,
    context.initialPrompt ? `Repository context: ${context.initialPrompt}` : "",
    "",
    "Previous failure output:",
    "```text",
    context.previousOutput || "<no output captured>",
    "```",
    "",
    "Current failure output:",
    "```text",
    context.currentOutput || "<no output captured>",
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseCritiqueResult(output: string): CritiqueResult {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch?.[0] ?? output;

  try {
    const parsed = JSON.parse(candidate) as { sameFailure?: unknown; reason?: unknown };
    return {
      sameFailure: parsed.sameFailure === true,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim().length > 0
          ? parsed.reason.trim()
          : "No critique reason provided.",
      rawResponse: output,
    };
  } catch {
    const normalized = output.trim();
    return {
      sameFailure: /true/i.test(normalized) && !/false/i.test(normalized),
      reason: normalized || "Critique ACP returned an unparsable response.",
      rawResponse: output,
    };
  }
}

function formatCommand(command: CritiqueContext["command"]): string {
  return typeof command === "string"
    ? command
    : command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}
