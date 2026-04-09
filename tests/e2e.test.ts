import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { runCommand } from "../src/process.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binEntry = path.join(repoRoot, "src", "bin.ts");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("dpr e2e", () => {
  test("uses repo config, repairs a delayed failure, and can be reset and rerun", async () => {
    const fixture = await createFixture({
      strategy: "single",
      retries: 2,
      withConfig: true,
      initialPrompt: "Seed repo context for the fixer.",
    });

    await resetFixture(fixture.dir);
    const firstRun = await runDpRun(fixture.dir);

    expect(firstRun.code).toBe(0);
    expect(firstRun.stdout).toContain("phase: boot");
    expect(firstRun.stdout).toContain("phase: fixed");
    expect(firstRun.stderr).toContain("BROKEN_AFTER_DELAY");
    expect(await readFixCount(fixture.dir)).toBe(1);
    expect(await readPrompt(fixture.dir)).toContain("Seed repo context for the fixer.");

    await resetFixture(fixture.dir);
    const secondRun = await runDpRun(fixture.dir);

    expect(secondRun.code).toBe(0);
    expect(secondRun.stderr).toContain("BROKEN_AFTER_DELAY");
    expect(await readFixCount(fixture.dir)).toBe(1);
  });

  test("supports cli-only execution and multiple fixer attempts", async () => {
    const fixture = await createFixture({
      strategy: "double",
      retries: 3,
      withConfig: false,
      initialPrompt: "CLI supplied context.",
    });

    await resetFixture(fixture.dir);
    const result = await runDpRun(fixture.dir, [
      "--client",
      "codex",
      "--retries",
      "3",
      "--prompt",
      "CLI supplied context.",
      "--",
      process.execPath,
      "script-under-test.mjs",
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("phase: partial-fix");
    expect(result.stdout).toContain("phase: fixed");
    expect(result.stderr).toContain("BROKEN_AFTER_DELAY");
    expect(result.stderr).toContain("BROKEN_STAGE_TWO");
    expect(await readFixCount(fixture.dir)).toBe(2);
    expect(await readPrompt(fixture.dir)).toContain("CLI supplied context.");
  });

  test("stops after the configured retry budget when the fixer never fully repairs the script", async () => {
    const fixture = await createFixture({
      strategy: "never",
      retries: 1,
      withConfig: true,
      initialPrompt: "Budgeted retry test.",
    });

    await resetFixture(fixture.dir);
    const result = await runDpRun(fixture.dir);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("BROKEN_AFTER_DELAY");
    expect(result.stderr).toContain("BROKEN_FOREVER");
    expect(await readFixCount(fixture.dir)).toBe(1);
  });

  test("streams verbose ACP client logs with the expected prefix", async () => {
    const fixture = await createFixture({
      strategy: "single",
      retries: 1,
      withConfig: false,
      initialPrompt: "Verbose mode test.",
    });

    await resetFixture(fixture.dir);
    const result = await runDpRun(fixture.dir, [
      "--client",
      "codex",
      "--retries",
      "1",
      "--verbose",
      "--prompt",
      "Verbose mode test.",
      "--",
      process.execPath,
      "script-under-test.mjs",
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("[acp-client] starting codex fix attempt 1/1");
    expect(result.stdout).toContain("[acp-client] fake codex stdout");
    expect(result.stderr).toContain("[acp-client] fake codex stderr");
  });
});

async function createFixture(options: {
  strategy: "single" | "double" | "never";
  retries: number;
  withConfig: boolean;
  initialPrompt: string;
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deadpool-runner-e2e-"));
  tempDirs.push(dir);

  const fakeCodexPath = path.join(dir, "fake-codex.mjs");
  const codexShimPath = path.join(dir, "codex");
  const resetPath = path.join(dir, "reset-fixture.mjs");

  await writeFile(
    path.join(dir, "broken-template.mjs"),
    createBrokenScript("BROKEN_AFTER_DELAY", "boot"),
  );
  await writeFile(
    path.join(dir, "partial-template.mjs"),
    createBrokenScript("BROKEN_STAGE_TWO", "partial-fix"),
  );
  await writeFile(
    path.join(dir, "never-template.mjs"),
    createBrokenScript("BROKEN_FOREVER", "never-fixed"),
  );
  await writeFile(path.join(dir, "fixed-template.mjs"), createFixedScript());
  await writeFile(path.join(dir, "fix-plan.json"), JSON.stringify({ strategy: options.strategy }));
  await writeFile(path.join(dir, "fix-state.json"), JSON.stringify({ invocations: 0 }));
  await writeFile(
    path.join(dir, "script-under-test.mjs"),
    createBrokenScript("BROKEN_AFTER_DELAY", "boot"),
  );
  await writeFile(path.join(dir, "reset-fixture.mjs"), createResetScript());
  await writeFile(path.join(dir, "fake-codex.mjs"), createFakeCodexScript());
  await writeFile(path.join(dir, "codex"), createFakeCodexScript());
  await chmod(fakeCodexPath, 0o755);
  await chmod(codexShimPath, 0o755);
  await chmod(resetPath, 0o755);

  if (options.withConfig) {
    await writeFile(
      path.join(dir, "deadpool-runner.config.ts"),
      `
      export default {
        command: [${JSON.stringify(process.execPath)}, "script-under-test.mjs"],
        retries: ${options.retries},
        initialPrompt: ${JSON.stringify(options.initialPrompt)},
        acpClient: {
          name: "codex",
          executable: ${JSON.stringify(fakeCodexPath)},
          color: "never",
        },
      };
      `,
    );
  }

  return {
    dir,
    fakeCodexPath,
  };
}

async function resetFixture(cwd: string) {
  const result = await runCommand([process.execPath, "reset-fixture.mjs"], {
    cwd,
  });
  expect(result.code).toBe(0);
}

async function runDpRun(cwd: string, args: string[] = []) {
  const defaultArgs =
    args.length > 0
      ? args
      : ["--client", "codex", "--model", "fake", "--config", "deadpool-runner.config.ts"];

  return await runCommand([process.execPath, tsxCli, binEntry, ...defaultArgs], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PATH: `${cwd}:${process.env.PATH ?? ""}`,
    },
  });
}

async function readFixCount(cwd: string) {
  const state = JSON.parse(await readFile(path.join(cwd, "fix-state.json"), "utf8")) as {
    invocations: number;
  };
  return state.invocations;
}

async function readPrompt(cwd: string) {
  return await readFile(path.join(cwd, "last-prompt.txt"), "utf8");
}

function createBrokenScript(marker: string, phase: string) {
  return `
  console.log("phase: ${phase}");
  await new Promise((resolve) => setTimeout(resolve, 120));
  console.error("${marker}");
  process.exit(1);
  `;
}

function createFixedScript() {
  return `
  console.log("phase: fixed");
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log("success: repaired");
  `;
}

function createResetScript() {
  return `
  import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
  copyFileSync("broken-template.mjs", "script-under-test.mjs");
  writeFileSync("fix-state.json", JSON.stringify({ invocations: 0 }));
  if (existsSync("last-prompt.txt")) {
    rmSync("last-prompt.txt");
  }
  `;
}

function createFakeCodexScript() {
  return `#!/usr/bin/env node
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const cwdIndex = process.argv.indexOf("-C");
const cwd = cwdIndex === -1 ? process.cwd() : process.argv[cwdIndex + 1];
const prompt = await new Promise((resolve) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => resolve(input));
});

writeFileSync(path.join(cwd, "last-prompt.txt"), String(prompt));

const plan = JSON.parse(readFileSync(path.join(cwd, "fix-plan.json"), "utf8"));
const statePath = path.join(cwd, "fix-state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
state.invocations += 1;
writeFileSync(statePath, JSON.stringify(state));

console.log("fake codex stdout");
console.error("fake codex stderr");

if (plan.strategy === "single") {
  copyFileSync(path.join(cwd, "fixed-template.mjs"), path.join(cwd, "script-under-test.mjs"));
} else if (plan.strategy === "double") {
  const nextTemplate = state.invocations === 1 ? "partial-template.mjs" : "fixed-template.mjs";
  copyFileSync(path.join(cwd, nextTemplate), path.join(cwd, "script-under-test.mjs"));
} else {
  copyFileSync(path.join(cwd, "never-template.mjs"), path.join(cwd, "script-under-test.mjs"));
}
`;
}
