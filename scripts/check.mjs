import { spawnSync } from "node:child_process";

const files = [
  "src/server/index.js",
  "src/server/state.js",
  "src/server/config.js",
  "src/server/context.js",
  "src/server/router.js",
  "src/server/queue.js",
  "src/server/adapters/ai.js",
  "src/server/adapters/music.js",
  "src/server/adapters/tts.js"
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("Server syntax checks passed.");
