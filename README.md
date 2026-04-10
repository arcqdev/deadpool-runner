# @arcqdev/deadpool-runner

<p align="center">
  <img src="docs/deadpool-mascot.png" alt="Deadpool Runner" width="200" />
</p>

<p align="center">
  <strong>Self-healing CLI.</strong><br/>
  Run a command. Let AI automatically fix and retry when it fails. Done.<br/>
  <em>Deadpool regenerates. So should your scripts...up to a certain limit.</em>
</p>

## Install

```bash
npm i -g @arcqdev/deadpool-runner
```

## Usage

```bash
# run a command (auto-fixes + reruns on failure)
dpr -- npm test

# set retries and give context
dpr --retries 3 --prompt "React app, Jest tests" -- npm test

# or just use a config file
dpr
```

## Config (optional)

Drop a `deadpool-runner.config.ts` in your repo:

```ts
import type { DeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

export default {
  command: "npm test",
  retries: 5,
  initialPrompt: "Fix root causes, not symptoms.",
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
} satisfies DeadpoolRunnerConfig;
```

## CLI Flags

| Flag                   | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `--retries <n>`        | Max fix attempts (default: 5)                           |
| `--prompt <text>`      | Context for the AI fixer                                |
| `--cwd, --repo <path>` | Target a different repo                                 |
| `--model <name>`       | Model override (default: gpt-5.4)                       |
| `--sandbox <mode>`     | `read-only`, `workspace-write`, or `danger-full-access` |
| `--verbose, -v`        | Show AI client logs                                     |
| `--config <path>`      | Explicit config file path                               |

## Repeat-Failure Critique

Deadpool Runner now keeps the original retry budget and adds a second loop guard by default.

- `retries` still caps the total number of fixer attempts.
- `critique.repeatFailureLimit` stops earlier when the same failure keeps happening consecutively.
- The default repeat-failure limit is `1`, so if the same failure comes back on the very next loop, Deadpool Runner exits instead of spending another repair attempt.
- Critique defaults to the same ACP client as the main fixer unless you override it.
- Critique runs are read-only by default and can use their own ACP settings separate from the fixer.

Config keys:

- `critique.enabled`
- `critique.repeatFailureLimit`
- `critique.acpClient.name`
- `critique.acpClient.model`
- `critique.acpClient.color`
- `critique.acpClient.sandbox`
- `critique.acpClient.dangerouslyBypassApprovalsAndSandbox`
- `critique.acpClient.verbose`
- `critique.acpClient.fullAuto`
- `critique.acpClient.extraArgs`
- `critique.acpClient.executable`

Environment variables:

- `DEADPOOL_RUNNER_REPEAT_FAILURE_LIMIT` overrides `critique.repeatFailureLimit`
- `DEADPOOL_RUNNER_DISABLE_CRITIQUE=1` disables critique and falls back to retry-budget-only behavior
- `DEADPOOL_RUNNER_CRITIQUE_CLIENT` overrides `critique.acpClient.name`
- `DEADPOOL_RUNNER_CRITIQUE_MODEL` overrides `critique.acpClient.model`
- `DEADPOOL_RUNNER_CRITIQUE_COLOR` overrides `critique.acpClient.color`
- `DEADPOOL_RUNNER_CRITIQUE_SANDBOX` overrides `critique.acpClient.sandbox`
- `DEADPOOL_RUNNER_CRITIQUE_BYPASS_SANDBOX` overrides `critique.acpClient.dangerouslyBypassApprovalsAndSandbox`
- `DEADPOOL_RUNNER_CRITIQUE_FULL_AUTO` overrides `critique.acpClient.fullAuto`
- `DEADPOOL_RUNNER_CRITIQUE_EXECUTABLE` overrides `critique.acpClient.executable`

Notes:

- If you do not set `critique.acpClient.name`, the critique inherits `acpClient.name`.
- Today the built-in critique runner only supports the `codex` ACP protocol path, so using another `name` requires matching support in the runtime.

## How it works

1. Runs your command
2. If it fails, AI reads your repo, fixes the code
3. On later failures, a critique ACP checks whether the new failure is basically the same as the previous one
4. Reruns until it passes, repeats the same failure too many times, or hits the retry limit

That's it. Self-healing scripts.

## License

MIT
