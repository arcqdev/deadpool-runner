import { createCodexClient } from "./clients/codex.js";
import type { ACPClient, ACPClientConfig } from "./types.js";

export type ACPClientFactory = (config?: ACPClientConfig) => ACPClient;

const registry = new Map<string, ACPClientFactory>([["codex", createCodexClient]]);

export function registerACPClient(name: string, factory: ACPClientFactory) {
  registry.set(name, factory);
}

export function unregisterACPClient(name: string) {
  registry.delete(name);
}

export function getACPClientFactory(name: string): ACPClientFactory | undefined {
  return registry.get(name);
}
