import { spawn } from "node:child_process";

const children = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env }
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) console.error(`${name} exited with ${code}`);
    shutdown(code || 0);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("web", "npx", ["vite", "--host", "127.0.0.1", "--port", "5173"]);

setTimeout(() => {
  run("electron", "npx", ["electron", "."], {
    CLAUDIO_WEB_URL: "http://127.0.0.1:5173",
    CLAUDIO_API_PORT: process.env.CLAUDIO_API_PORT || "4217"
  });
}, 1800);
