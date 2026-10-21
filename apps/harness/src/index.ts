#!/usr/bin/env node
import { createHarnessRuntime } from "./orchestrator.js";
import { JsonRpcServer } from "./rpc.js";
import { pathToFileURL } from "node:url";

export * from "./context.js";
export * from "./agents.js";
export * from "./code.js";
export * from "./errors.js";
export * from "./extensions.js";
export * from "./logging.js";
export * from "./orchestrator.js";
export * from "./permissions.js";
export * from "./persistence.js";
export * from "./providers.js";
export * from "./release.js";
export * from "./rpc.js";
export * from "./tools.js";
export * from "./types.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await createHarnessRuntime({ dataDirectory: process.env.ORDERCODE_DATA_DIR, onOAuthTokensRotated: (credential) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "provider.oauth.tokens.rotated", params: { providerId: "openai_chatgpt", credential } })}\n`), onXaiOAuthTokensRotated: (credential) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "provider.oauth.tokens.rotated", params: { providerId: "xai_plan", credential } })}\n`) });
  const server = new JsonRpcServer(runtime);
  server.attach();
  process.stderr.write(`OrderCode harness ready (protocol 1, pid ${process.pid})\n`);
}
