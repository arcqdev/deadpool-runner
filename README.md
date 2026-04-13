# @arcqdev/deadpool-runner

<p align="center">
  <img src="docs/deadpool-mascot.png" alt="Deadpool Runner" width="200" />
</p>

<p align="center">
  <strong>Self-healing command runner for CLI and SDK usage.</strong><br/>
  Wrap a failing command, let an ACP client fix the repo, and retry until it passes or hits a hard stop.<br/><br/>
  Part of <a href="https://foldablestack.com/dev/">Run Suite</a> · <a href="https://arcqdev.github.io/deadpool-runner/">Docs</a>
</p>

## Install

Use it as a local dependency for SDK or repo-level CLI usage:

```bash
vp add @arcqdev/deadpool-runner
```

Or install the CLI globally:

```bash
npm i -g @arcqdev/deadpool-runner
```

## CLI Quick Start

Run a command directly:

```bash
dpr -- vp test
```

Pass context and a retry budget:

```bash
dpr --retries 3 --prompt "Vite+ monorepo, fix root causes" -- vp check
```

Or define a config file:

```ts
import { defineDeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

export default defineDeadpoolRunnerConfig({
  command: ["vp", "test"],
  retries: 5,
  initialPrompt: "Fix the actual regression, not the assertion.",
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    fullAuto: true,
  },
  critique: {
    enabled: true,
    repeatFailureLimit: 1,
    acpClient: {
      sandbox: "read-only",
      fullAuto: false,
    },
  },
});
```

Then run:

```bash
dpr
```

## SDK Quick Start

The package now exposes a first-class SDK entrypoint for running repairs programmatically:

```ts
import { runDeadpoolRunner } from "@arcqdev/deadpool-runner";

const result = await runDeadpoolRunner({
  cwd: process.cwd(),
  command: ["vp", "test"],
  retries: 2,
  initialPrompt: "TypeScript package. Keep fixes minimal and rerunnable.",
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    sandbox: "workspace-write",
  },
});

if (result.code !== 0) {
  throw new Error(`Repair loop failed with exit code ${result.code}`);
}
```

For advanced integrations, the lower-level runner is still available:

```ts
import { createRunner } from "@arcqdev/deadpool-runner";

const runner = createRunner({
  runCommand: async (command, options) => {
    return {
      code: 0,
      signal: null,
      stdout: `stubbed ${String(command)}`,
      stderr: "",
      combinedOutput: `stubbed ${String(command)}`,
    };
  },
});

await runner.run({
  command: ["vp", "test"],
});
```

## Register a Custom ACP Client

Deadpool Runner is SDK-friendly because the ACP client registry is public:

```ts
import {
  registerACPClient,
  runDeadpoolRunner,
  type ACPClient,
  type ACPClientConfig,
} from "@arcqdev/deadpool-runner";

registerACPClient(
  "internal-agent",
  (config?: ACPClientConfig): ACPClient => ({
    name: "internal-agent",
    async fixFailure(context) {
      console.log("Repairing", context.command, "with", config?.model ?? "default model");
      return { summary: "Applied internal-agent repair." };
    },
  }),
);

await runDeadpoolRunner({
  command: ["vp", "test"],
  acpClient: {
    name: "internal-agent",
    model: "my-internal-model",
  },
});
```

## CLI Flags

| Flag                     | What it does                                            |
| ------------------------ | ------------------------------------------------------- |
| `--retries <n>`          | Max fix attempts after the initial failure              |
| `--prompt <text>`        | Extra repo context for the fixer                        |
| `--cwd, --repo <path>`   | Target a different repo or working directory            |
| `--client <name>`        | ACP client name, currently `codex` by default           |
| `--model <name>`         | Model override for the ACP client                       |
| `--sandbox <mode>`       | `read-only`, `workspace-write`, or `danger-full-access` |
| `--max-output-chars <n>` | Limit the trailing error text sent to the fixer         |
| `--verbose, -v`          | Stream ACP client logs during fix attempts              |
| `--config <path>`        | Explicit config file path                               |

## Repeat-Failure Critique

Deadpool Runner keeps the normal retry budget and adds an optional loop guard for repeated failures.

- `retries` caps the total number of fixer attempts.
- `critique.repeatFailureLimit` stops early when the same failure repeats consecutively.
- The default repeat-failure limit is `1`.
- Critique defaults to the main ACP client unless you override it.
- Critique runs read-only by default.

Environment overrides:

- `DEADPOOL_RUNNER_REPEAT_FAILURE_LIMIT`
- `DEADPOOL_RUNNER_DISABLE_CRITIQUE=1`
- `DEADPOOL_RUNNER_CRITIQUE_CLIENT`
- `DEADPOOL_RUNNER_CRITIQUE_MODEL`
- `DEADPOOL_RUNNER_CRITIQUE_COLOR`
- `DEADPOOL_RUNNER_CRITIQUE_SANDBOX`
- `DEADPOOL_RUNNER_CRITIQUE_BYPASS_SANDBOX`
- `DEADPOOL_RUNNER_CRITIQUE_FULL_AUTO`
- `DEADPOOL_RUNNER_CRITIQUE_EXECUTABLE`

## Package Exports

The published package includes typed ESM exports for both direct use and tooling compatibility:

- `@arcqdev/deadpool-runner`
- `@arcqdev/deadpool-runner/cli`
- `@arcqdev/deadpool-runner/bin`

## How It Works

1. Run the wrapped command.
2. If it fails, the ACP client gets the repo context and captured error output.
3. Deadpool Runner writes per-run artifacts under `~/.deadpool-runner/runs/`.
4. The command reruns until it passes, repeats the same failure too many times, or exhausts the retry budget.

## Development

This repo uses Vite+.

```bash
./node_modules/.bin/vp check
./node_modules/.bin/vp test
./node_modules/.bin/vp run build
```

GitHub Pages is deployed from the committed `docs/` directory through the workflow in `.github/workflows/ci-pages.yml`.

## License

MIT
