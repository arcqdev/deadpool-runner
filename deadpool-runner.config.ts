import type { DeadpoolRunnerConfig } from "./src/types.ts";

const config: DeadpoolRunnerConfig = {
  command: "vp test",
  retries: 2,
  initialPrompt: [
    "This repository contains the deadpool-runner Node utility.",
    "Use Vite+ commands instead of npm, pnpm, or yarn directly.",
    "Keep fixes focused, preserve output passthrough behavior, and maintain test coverage.",
  ].join("\n"),
  acpClient: {
    name: "codex",
    fullAuto: true,
    color: "auto",
  },
};

export default config;
