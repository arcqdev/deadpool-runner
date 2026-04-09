# @arcqdev/deadpool-runner

`@arcqdev/deadpool-runner` is a small Node utility that wraps any script, streams its output through unchanged, and when the script fails it asks an ACP-backed fixer to repair the repo before retrying.

Today it ships with a built-in Codex client. The runner is structured around a client interface so additional ACP clients can be added without changing the retry engine.

Pull requests are welcome.

## What It Does

- Runs any command from the current repo, or from explicit CLI arguments
- Mirrors `stdout` and `stderr` to your terminal while also capturing them for failure analysis
- On non-zero exit, sends the failure context to an ACP client
- Retries the command after the fixer runs, up to a configurable maximum
- Accepts repo-specific context via `deadpool-runner.config.ts` and/or CLI flags

## Install

From npm:

```bash
npm install -g @arcqdev/deadpool-runner
```

Or run it without installing globally:

```bash
npx @arcqdev/deadpool-runner --help
```

For local development in this repo:

```bash
vp install
vp run build
vp link . -- --global
```

That exposes the default binary as `dpr`.

## Quick Start

Create a `deadpool-runner.config.ts` in the repo you want to protect:

```ts
import type { DeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

const config: DeadpoolRunnerConfig = {
  command: "vp test",
  retries: 3,
  initialPrompt: `
This repo uses Vite+.
Use vp commands instead of npm, pnpm, or yarn directly.
Fix the root cause instead of suppressing errors.
`.trim(),
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    fullAuto: true,
  },
};

export default config;
```

If you do not have a repo-local config, `dpr` also falls back to:

```text
~/.config/deadpool-runner/config.json
```

If that file does not exist yet, `dpr` creates it automatically with a permissive Codex default using `gpt-5.4`.

Then run:

```bash
dpr
```

Or skip the config file and pass the command directly:

```bash
dpr --retries 2 --prompt "This is a Node CLI package. Keep fixes minimal." -- vp test
```

Target a different repository explicitly:

```bash
dpr --repo /path/to/other-repo -- vp test
```

Target a repo and provide a custom fixer prompt:

```bash
dpr --repo /path/to/other-repo --prompt "This repo uses pnpm and strict TypeScript. Fix root causes only." -- vp test
```

Enable verbose ACP client logs during fix attempts:

```bash
dpr --verbose --prompt "Show your work while fixing." -- vp test
```

Tune how much of the trailing error output gets sent into the ACP prompt:

```bash
dpr --max-output-chars 12000 --verbose -- vp test
```

If Codex is already running inside an external sandbox and its default `workspace-write` sandbox fails to initialize, pass through a different Codex execution mode:

```bash
dpr --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox -- vp test
```

## CLI

```bash
dpr [options] -- <command> [args...]
```

Options:

- `--config <path>`: explicit config file path
- `--cwd <path>`: working directory for the wrapped command and ACP client
- `--repo <path>`: alias for `--cwd`, useful when you want to point at another repository
- `--client <name>`: ACP client name, currently `codex`
- `--retries <n>`: maximum fixer attempts after the initial failure
- `--max-output-chars <n>`: maximum trailing error characters sent to the ACP client
- `--prompt <text>`: seed prompt with repo context for the fixer
- `--verbose`: stream detailed ACP client logs, with ACP output prefixed as `[acp-client]`
- `--model <name>`: model override for the built-in Codex client
- `--color <mode>`: `auto`, `always`, or `never` for `codex exec`
- `--sandbox <mode>`: `read-only`, `workspace-write`, or `danger-full-access` for `codex exec`
- `--dangerously-bypass-approvals-and-sandbox`: run `codex exec` without approvals or sandboxing

## Config

The runner looks for `deadpool-runner.config.ts`, `deadpool-runner.config.mts`, `deadpool-runner.config.js`, or `deadpool-runner.config.mjs` in the working directory unless `--config` is passed.

```ts
import type { DeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

export default {
  command: ["vp", "test"],
  retries: 3,
  initialPrompt: "The repo uses strict TypeScript and Vite+ commands.",
  maxOutputChars: 12000,
  env: {
    CI: "1",
  },
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    fullAuto: true,
    sandbox: "danger-full-access",
    dangerouslyBypassApprovalsAndSandbox: true,
    color: "never",
    verbose: true,
  },
} satisfies DeadpoolRunnerConfig;
```

Equivalent user-level default config:

```json
{
  "retries": 3,
  "maxOutputChars": 12000,
  "acpClient": {
    "name": "codex",
    "model": "gpt-5.4",
    "fullAuto": true,
    "color": "never"
  }
}
```

## Built-In Codex Client

When a command fails, the built-in Codex client runs `codex exec` in the target repo and gives it:

- The failing command
- The attempt number and retry budget
- The seed prompt from config or CLI
- Captured stdout/stderr, truncated to the configured limit

For each runner invocation, debug artifacts are written under:

```text
~/.deadpool-runner/runs/<run-hash>/<run-num>/
```

That directory includes:

- `solution.md`: where the ACP fixer is instructed to write its solution summary
- `full-error.md`: the full captured command output for the current failed attempt
- `input-error.md`: the truncated error payload that was actually sent to the ACP client

By default the client runs with `--full-auto`. You can switch to a custom argument set through `acpClient.extraArgs`.

If Codex is already externally sandboxed and `--full-auto` is too restrictive for that environment, set `acpClient.sandbox` and, if needed, `acpClient.dangerouslyBypassApprovalsAndSandbox`.

## Development

```bash
vp install
vp check
vp test
vp run build
```
