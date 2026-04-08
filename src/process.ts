import { spawn, type SpawnOptions } from "node:child_process";
import type { Writable } from "node:stream";
import type { CommandSpec, RunResult } from "./types.js";

const decode = (chunk: string | Buffer) =>
  typeof chunk === "string" ? chunk : chunk.toString("utf8");

export async function runCommand(
  command: CommandSpec,
  options: SpawnOptions & {
    stdout?: Writable;
    stderr?: Writable;
  } = {},
): Promise<RunResult> {
  const stdoutTarget = options.stdout ?? process.stdout;
  const stderrTarget = options.stderr ?? process.stderr;
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    shell: typeof command === "string",
    stdio: ["inherit", "pipe", "pipe"],
  };

  return await new Promise<RunResult>((resolve, reject) => {
    const child =
      typeof command === "string"
        ? spawn(command, spawnOptions)
        : spawn(command[0], command.slice(1), spawnOptions);

    let stdout = "";
    let stderr = "";
    let combinedOutput = "";

    child.stdout?.on("data", (chunk) => {
      const text = decode(chunk);
      stdout += text;
      combinedOutput += text;
      stdoutTarget.write(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      const text = decode(chunk);
      stderr += text;
      combinedOutput += text;
      stderrTarget.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        stdout,
        stderr,
        combinedOutput,
      });
    });
  });
}
