import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const ncmDir = path.join(root, "work", "ncm-api-enhanced");
const appPath = path.join(ncmDir, "app.js");

if (!existsSync(appPath)) {
  console.error("Missing work/ncm-api-enhanced/app.js. Clone ncm-api-enhanced into work/ first.");
  process.exit(1);
}

const port = process.env.NCM_PORT || "3300";
const child = spawn(process.execPath, ["app.js"], {
  cwd: ncmDir,
  stdio: "inherit",
  env: {
    ...process.env,
    HOST: process.env.NCM_HOST || "127.0.0.1",
    PORT: port
  }
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
