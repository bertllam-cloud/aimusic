import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireBundled = createRequire(import.meta.url);
const BUNDLED_NCM_SERVER_PATH = fileURLToPath(new URL("./ncm-api/server.js", import.meta.url));
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Start the bundled NeteaseCloudMusicApi inside the Claudio API process.
 * A manually running local API is reused, while external NCM URLs remain
 * supported for advanced setups.
 */
export async function startNcmRuntime({
  baseUrl,
  autoStart = true,
  appPath = ""
} = {}) {
  const disabled = !autoStart || String(process.env.NCM_AUTO_START || "true").toLowerCase() === "false";
  if (disabled) return status({ enabled: false, reason: "disabled" });

  let target;
  try {
    target = new URL(String(baseUrl || ""));
  } catch {
    return status({ reason: "invalid-url" });
  }

  if (target.protocol !== "http:" || !LOOPBACK_HOSTS.has(target.hostname)) {
    return status({ reason: "external-url" });
  }

  const port = Number(target.port || 80);
  const host = target.hostname;
  const serverPath = appPath || process.env.NCM_APP_PATH || BUNDLED_NCM_SERVER_PATH;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return status({ reason: "invalid-port" });
  }

  if (!fs.existsSync(serverPath)) {
    return status({ reason: "missing-bundled-api", appPath: serverPath });
  }

  if (await isPortOpen(host, port)) {
    return status({ running: true, ready: true, reason: "already-running", port });
  }

  try {
    ensureAnonymousToken();
    const root = path.dirname(serverPath);
    const generateConfig = requireBundled(path.join(root, "generateConfig.js"));
    await generateConfig();
    const ncmServer = requireBundled(serverPath);
    const ncmApp = await ncmServer.serveNcmApi({ host, port, checkVersion: false });
    const server = ncmApp.server;
    await waitForListening(server);
    console.log(`Embedded Netease API ready on http://${host}:${port}`);
    return status({
      running: true,
      started: true,
      ready: true,
      owned: true,
      port,
      close: () => closeServer(server)
    });
  } catch (error) {
    console.warn(`Embedded Netease API failed to start: ${error.message}. Using demo tracks.`);
    return status({ reason: "startup-failed", error: error.message });
  }
}

function ensureAnonymousToken() {
  const tokenPath = path.join(os.tmpdir(), "anonymous_token");
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, "", "utf8");
}

function status(values = {}) {
  return {
    enabled: true,
    running: false,
    started: false,
    starting: false,
    ready: false,
    owned: false,
    ...values,
    close: values.close || (() => {})
  };
}

function closeServer(server) {
  if (server?.listening) server.close();
}

function waitForListening(server) {
  if (server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
