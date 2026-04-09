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
- `--prompt <text>`: seed prompt with repo context for the fixer
- `--model <name>`: model override for the built-in Codex client
- `--color <mode>`: `auto`, `always`, or `never` for `codex exec`

## Config

The runner looks for `deadpool-runner.config.ts`, `deadpool-runner.config.mts`, `deadpool-runner.config.js`, or `deadpool-runner.config.mjs` in the working directory unless `--config` is passed.

```ts
import type { DeadpoolRunnerConfig } from "@arcqdev/deadpool-runner";

export default {
  command: ["vp", "test"],
  retries: 3,
  initialPrompt: "The repo uses strict TypeScript and Vite+ commands.",
  maxOutputChars: 20000,
  env: {
    CI: "1",
  },
  acpClient: {
    name: "codex",
    model: "gpt-5.4",
    fullAuto: true,
    color: "never",
    extraArgs: ["--skip-git-repo-check"],
  },
} satisfies DeadpoolRunnerConfig;
```

## Built-In Codex Client

When a command fails, the built-in Codex client runs `codex exec` in the target repo and gives it:

- The failing command
- The attempt number and retry budget
- The seed prompt from config or CLI
- Captured stdout/stderr, truncated to the configured limit

By default the client runs with `--full-auto`. You can switch to a custom argument set through `acpClient.extraArgs`.

## Development

```bash
vp install
vp check
vp test
vp run build
```
