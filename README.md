# @arcqdev/deadpool-runner

<p align="center">
  <img src="docs/deadpool-mascot.png" alt="Deadpool Runner" width="200" />
</p>

<p align="center">
  <strong>Scripts that won't stay dead.</strong><br/>
  Deadpool doesn't die. Neither does your command. It fails, it heals, it runs again.<br/>
  <em>Regeneration factor built in — every red squiggle grows back fixed.</em><br/><br/>
  Part of <a href="https://foldablestack.com/dev/">Run Suite</a> · <a href="https://arcqdev.github.io/deadpool-runner/">Docs</a>
</p>

## Install

```bash
npm i -g @arcqdev/deadpool-runner
```

Or as a local dependency:

```bash
npm i @arcqdev/deadpool-runner
```

## Quick Start

Wrap any command. If it passes, you're done. If it fails, an ACP client (Codex by default) reads the error, patches your repo, and reruns — until it passes, the same failure repeats, or the retry budget runs out.

```bash
# run a command — auto-fixes and reruns on failure
dpr -- npm test

# tune retries and feed the fixer context
dpr --retries 3 --prompt "Node + Jest. Fix root causes, not assertions." -- npm test

# or commit to a config file and just run `dpr`
dpr
```

## Config

Drop a `deadpool-runner.config.ts` in your repo root:

```ts
import { defineDeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

export default defineDeadpoolRunnerConfig({
  command: ["npm", "test"],
  retries: 5,
  initialPrompt: "Fix the actual regression, not the assertion.",
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    fullAuto: true,
  },
});
```

## SDK

Embed the regeneration loop directly:

```ts
import { runDeadpoolRunner } from "@arcqdev/deadpool-runner";

const result = await runDeadpoolRunner({
  command: ["npm", "test"],
  retries: 2,
  initialPrompt: "TypeScript package. Keep fixes minimal.",
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

Need lower-level control? Use `createRunner` to inject your own `runCommand`.

## Custom ACP Clients

The registry is public — plug in any repair backend:

```ts
import { registerACPClient, runDeadpoolRunner } from "@arcqdev/deadpool-runner";

registerACPClient("internal-agent", () => ({
  name: "internal-agent",
  async fixFailure(context) {
    // your repair logic here
    return { summary: "Applied internal-agent repair." };
  },
}));

await runDeadpoolRunner({
  command: ["npm", "test"],
  acpClient: { name: "internal-agent" },
});
```

## Failure Conditions

By default, the critique step only guards against repeat failures. Add `critique.failureConditions` to classify named terminal blockers (third-party outages, missing secrets) and stop early with structured output:

```ts
await runDeadpoolRunner({
  command: ["npm", "test"],
  critique: {
    failureConditions: {
      instructions: "Only match when the output clearly proves the blocker.",
      conditions: [
        {
          id: "third-party-api-down",
          description: "A required hosted API is down.",
          stop: true,
          output: { code: "third_party_api_down", retryable: false },
        },
      ],
    },
  },
});
```

Or pass them from the CLI with `--failure-conditions-json` / `--failure-conditions-file`.

## CLI Flags

| Flag                               | What it does                                            |
| ---------------------------------- | ------------------------------------------------------- |
| `--retries <n>`                    | Max fix attempts after the initial failure              |
| `--prompt <text>`                  | Extra repo context for the fixer                        |
| `--cwd, --repo <path>`             | Target a different repo or working directory            |
| `--client <name>`                  | ACP client name (default: `codex`)                      |
| `--model <name>`                   | Model override for the ACP client                       |
| `--sandbox <mode>`                 | `read-only`, `workspace-write`, or `danger-full-access` |
| `--max-output-chars <n>`           | Trim the trailing error text sent to the fixer          |
| `--verbose, -v`                    | Stream ACP client logs during fix attempts              |
| `--config <path>`                  | Explicit config file path                               |
| `--failure-conditions-json <json>` | Inline JSON for `critique.failureConditions`            |
| `--failure-conditions-file <path>` | Load `critique.failureConditions` from a file           |

## Repeat-Failure Critique

- `retries` caps total fixer attempts.
- `critique.repeatFailureLimit` (default `1`) stops early when the same failure repeats.
- Critique defaults to the main ACP client, read-only sandbox.
- Override via env: `DEADPOOL_RUNNER_REPEAT_FAILURE_LIMIT`, `DEADPOOL_RUNNER_DISABLE_CRITIQUE`, `DEADPOOL_RUNNER_CRITIQUE_CLIENT`, `DEADPOOL_RUNNER_CRITIQUE_MODEL`, `DEADPOOL_RUNNER_CRITIQUE_SANDBOX`.

## Package Exports

- `@arcqdev/deadpool-runner`
- `@arcqdev/deadpool-runner/cli`
- `@arcqdev/deadpool-runner/bin`

## How It Works

1. Run the wrapped command.
2. If it fails, the ACP client gets the repo context and captured error output.
3. Per-run artifacts land in `~/.deadpool-runner/runs/`.
4. The command reruns until it passes, the same failure repeats too many times, or retries are exhausted.

## License

MIT
