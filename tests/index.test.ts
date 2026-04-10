import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  buildCodexArgs,
  getHelpText,
  loadConfig,
  parseCliArgs,
  resolveConfig,
  runCli,
} from "../src/index.ts";
import { runCommand } from "../src/process.ts";
import { createRunner } from "../src/runner.ts";
import type { ACPClient, FailureContext, RunResult } from "../src/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("parseCliArgs", () => {
  test("parses a command after --", () => {
    const args = parseCliArgs(["--retries", "4", "--prompt", "seed", "--", "vp", "test"]);

    expect(args.retries).toBe(4);
    expect(args.prompt).toBe("seed");
    expect(args.command).toEqual(["vp", "test"]);
  });

  test("parses --help", () => {
    const args = parseCliArgs(["--help"]);

    expect(args.help).toBe(true);
  });

  test("parses --repo as a cwd alias", () => {
    const args = parseCliArgs(["--repo", "/tmp/other-repo", "--prompt", "fix it"]);

    expect(args.repo).toBe("/tmp/other-repo");
    expect(args.prompt).toBe("fix it");
  });

  test("parses --verbose", () => {
    const args = parseCliArgs(["--verbose"]);

    expect(args.verbose).toBe(true);
  });

  test("parses --max-output-chars", () => {
    const args = parseCliArgs(["--max-output-chars", "9000"]);

    expect(args.maxOutputChars).toBe(9000);
  });

  test("parses codex sandbox overrides", () => {
    const args = parseCliArgs([
      "--sandbox",
      "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);

    expect(args.sandbox).toBe("danger-full-access");
    expect(args.dangerouslyBypassApprovalsAndSandbox).toBe(true);
  });
});

describe("runCli", () => {
  test("prints help and exits successfully", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runCli(["--help"])).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith(getHelpText());

    write.mockRestore();
  });
});

describe("loadConfig", () => {
  test("loads a TypeScript config file", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "deadpool-runner.config.ts"),
      `
      export default {
        retries: 5,
        command: ["node", "script.js"],
        initialPrompt: "repo context",
      };
      `,
    );

    const config = await loadConfig(dir);
    expect(config.retries).toBe(5);
    expect(config.command).toEqual(["node", "script.js"]);
    expect(config.initialPrompt).toBe("repo context");
  });

  test("creates and loads the default global config when no repo config exists", async () => {
    const dir = await createTempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    try {
      const config = await loadConfig(dir);
      const globalConfigPath = path.join(dir, ".config", "deadpool-runner", "config.json");

      await access(globalConfigPath);
      expect(config.acpClient?.name).toBe("codex");
      expect(config.acpClient?.model).toBe("gpt-5.4");
      expect(config.acpClient?.fullAuto).toBe(true);
      expect(config.retries).toBe(5);
      expect(config.maxOutputChars).toBe(12000);

      const fileContents = JSON.parse(await readFile(globalConfigPath, "utf8")) as {
        retries?: number;
        acpClient?: { model?: string; fullAuto?: boolean };
      };
      expect(fileContents.retries).toBe(5);
      expect(fileContents.acpClient?.model).toBe("gpt-5.4");
      expect(fileContents.acpClient?.fullAuto).toBe(true);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});

describe("resolveConfig", () => {
  test("defaults retries to five failures", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "deadpool-runner.config.ts"),
      `
      export default {
        command: ["node", "script.js"],
      };
      `,
    );

    const { config } = await resolveConfig({
      cwd: dir,
    });

    expect(config.retries).toBe(5);
  });

  test("merges codex sandbox overrides from the cli", async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, "deadpool-runner.config.ts"),
      `
      export default {
        command: ["node", "script.js"],
        acpClient: {
          name: "codex",
          sandbox: "workspace-write",
        },
      };
      `,
    );

    const { config } = await resolveConfig({
      cwd: dir,
      sandbox: "danger-full-access",
      dangerouslyBypassApprovalsAndSandbox: true,
    });

    expect(config.acpClient?.sandbox).toBe("danger-full-access");
    expect(config.acpClient?.dangerouslyBypassApprovalsAndSandbox).toBe(true);
  });
});

describe("runCommand", () => {
  test("captures and mirrors stdout and stderr", async () => {
    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const result = await runCommand(
      [
        process.execPath,
        "-e",
        'process.stdout.write("hello\\n"); process.stderr.write("boom\\n");',
      ],
      {
        stdout,
        stderr,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.stderr).toContain("boom");
    expect(result.combinedOutput).toContain("hello");
    expect(result.combinedOutput).toContain("boom");
    expect(stdout.toString()).toContain("hello");
    expect(stderr.toString()).toContain("boom");
  });
});

describe("buildCodexArgs", () => {
  test("supports explicit sandbox overrides", () => {
    expect(buildCodexArgs({ sandbox: "danger-full-access", fullAuto: false }, "/repo")).toEqual([
      "exec",
      "-C",
      "/repo",
      "--skip-git-repo-check",
      "--sandbox",
      "danger-full-access",
      "-",
    ]);
  });

  test("treats bypassing approvals and sandboxing as overriding full-auto", () => {
    expect(
      buildCodexArgs(
        {
          dangerouslyBypassApprovalsAndSandbox: true,
        },
        "/repo",
      ),
    ).toEqual([
      "exec",
      "-C",
      "/repo",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ]);
  });

  test("supports bypassing approvals and sandboxing", () => {
    expect(
      buildCodexArgs(
        {
          dangerouslyBypassApprovalsAndSandbox: true,
          fullAuto: false,
        },
        "/repo",
      ),
    ).toEqual([
      "exec",
      "-C",
      "/repo",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ]);
  });
});

describe("createRunner", () => {
  test("defaults to five fixer attempts when retries are omitted", async () => {
    const fixFailure = vi.fn(async () => ({ summary: "attempted" }));
    const runner = createRunner({
      createClient: () =>
        ({
          name: "fake",
          fixFailure,
        }) satisfies ACPClient,
      runCommand: vi.fn(async () => ({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "fail",
        combinedOutput: "fail",
      })),
    });

    const result = await runner.run({
      cwd: process.cwd(),
      command: "vp test",
    });

    expect(result.code).toBe(1);
    expect(fixFailure).toHaveBeenCalledTimes(5);
  });

  test("fixes and reruns a failing command until it passes", async () => {
    const dir = await createTempDir();
    const targetFile = path.join(dir, "target.js");
    await writeFile(
      targetFile,
      ['console.log("before fix");', 'throw new Error("broken");'].join("\n"),
    );

    const fixFailure = vi.fn(async (context: FailureContext) => {
      expect(context.initialPrompt).toContain("repo guidance");
      expect(context.combinedOutput).toContain("broken");
      await writeFile(targetFile, 'console.log("after fix");\n');
      return { summary: "fixed" };
    });

    const client: ACPClient = {
      name: "fake",
      fixFailure,
    };

    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const runner = createRunner({
      createClient: () => client,
      runCommand: async (command, options = {}) =>
        await runCommand(command, {
          ...options,
          stdout,
          stderr,
        }),
    });

    const previousHome = process.env.HOME;
    process.env.HOME = dir;

    let result: RunResult;
    try {
      result = await runner.run({
        cwd: dir,
        command: [process.execPath, targetFile],
        retries: 2,
        initialPrompt: "repo guidance",
        maxOutputChars: 5000,
        env: {
          FORCE_COLOR: "0",
        },
      });
    } finally {
      process.env.HOME = previousHome;
    }

    expect(result.code).toBe(0);
    expect(fixFailure).toHaveBeenCalledTimes(1);
    expect(stdout.toString()).toContain("before fix");
    expect(stdout.toString()).toContain("after fix");
    expect(stderr.toString()).toContain("broken");
    expect(fixFailure.mock.calls[0]?.[0].solutionPath).toContain(".deadpool-runner/runs/");
    expect(fixFailure.mock.calls[0]?.[0].fullErrorPath).toContain("full-error.md");
    expect(fixFailure.mock.calls[0]?.[0].inputErrorPath).toContain("input-error.md");
  });

  test("stops after the configured retry budget", async () => {
    const resultSequence: RunResult[] = [
      { code: 1, signal: null, stdout: "", stderr: "fail 1", combinedOutput: "fail 1" },
      { code: 1, signal: null, stdout: "", stderr: "fail 2", combinedOutput: "fail 2" },
    ];

    const fixFailure = vi.fn(async () => ({ summary: "attempted" }));
    const runner = createRunner({
      createClient: () =>
        ({
          name: "fake",
          fixFailure,
        }) satisfies ACPClient,
      runCommand: vi.fn(async () => resultSequence.shift() ?? resultSequence.at(-1)!),
    });

    const result = await runner.run({
      cwd: process.cwd(),
      command: "vp test",
      retries: 1,
    });

    expect(result.code).toBe(1);
    expect(fixFailure).toHaveBeenCalledTimes(1);
  });
});

function createBufferStream() {
  const chunks: Buffer[] = [];

  return Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    }),
    {
      toString() {
        return Buffer.concat(chunks).toString("utf8");
      },
    },
  );
}

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deadpool-runner-"));
  tempDirs.push(dir);
  return dir;
}
