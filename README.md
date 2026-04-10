# @arcqdev/deadpool-runner

<p align="center">
  <img src="docs/deadpool-mascot.png" alt="Deadpool Runner" width="200" />
</p>

<p align="center">
  <strong>Self-healing CLI.</strong><br/>
  Run a command. If it fails, AI fixes your code and reruns it. Done.<br/>
  <em>Named after Deadpool because it regenerates — your scripts heal themselves.</em>
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

## How it works

1. Runs your command
2. If it fails, AI reads your repo, fixes the code
3. Reruns — repeats until it passes or hits the retry limit

That's it. Self-healing scripts.

## License

MIT
