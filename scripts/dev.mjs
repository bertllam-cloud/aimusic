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
    if (code && code !== 0) {
      console.error(`${name} exited with ${code}`);
      shutdown(code);
    }
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

run("api", process.execPath, ["src/server/index.js"], {
  CLAUDIO_API_PORT: process.env.CLAUDIO_API_PORT || "4217"
});
run("web", "npx", ["vite", "--host", "127.0.0.1", "--port", "5173"]);

console.log("Claudio API: http://127.0.0.1:4217");
console.log("Claudio PWA: http://127.0.0.1:5173");
