import fs from "node:fs";
import path from "node:path";

const SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "FISH_AUDIO_API_KEY",
  "FEISHU_APP_SECRET",
  "NCM_COOKIE"
]);

const DEFAULTS = {
  AI_PROVIDER: "mock",
  AI_TIMEOUT_MS: "60000",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_MODEL: "gpt-4.1-mini",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  ANTHROPIC_MODEL: "claude-3-5-sonnet-latest",
  CLAUDE_CLI_BIN: "claude",
  NCM_API_BASE: "http://127.0.0.1:3300",
  NCM_AUTO_START: "true",
  NCM_APP_PATH: "",
  CLAUDIO_API_PORT: "4217"
};

export const SETTINGS_KEYS = [
  "AI_PROVIDER",
  "AI_TIMEOUT_MS",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CLI_BIN",
  "FISH_AUDIO_API_KEY",
  "FISH_AUDIO_VOICE_ID",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "OPENWEATHER_API_KEY",
  "NCM_COOKIE",
  "NCM_API_BASE",
  "UPNP_TARGET_URL"
];

export function loadDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function getDefaultDataDir() {
  if (process.env.CLAUDIO_DATA_DIR) return process.env.CLAUDIO_DATA_DIR;
  return path.join(process.cwd(), ".claudio-data");
}

export function createRuntimeConfig(store) {
  function get(key) {
    const saved = store?.getSetting(key);
    if (saved !== undefined && saved !== null && saved !== "") return saved;
    if (process.env[key] !== undefined && process.env[key] !== "") {
      return process.env[key];
    }
    return DEFAULTS[key] ?? "";
  }

  function has(key) {
    return Boolean(get(key));
  }

  function publicSettings() {
    const result = {};
    for (const key of SETTINGS_KEYS) {
      const saved = store?.getSetting(key);
      const envValue = process.env[key];
      const value = get(key);
      if (SECRET_KEYS.has(key)) {
        result[key] = {
          secret: true,
          configured: Boolean(value),
          source: saved ? "local" : envValue ? "env" : "empty"
        };
      } else {
        result[key] = {
          secret: false,
          value,
          source: saved ? "local" : envValue ? "env" : DEFAULTS[key] ? "default" : "empty"
        };
      }
    }
    return result;
  }

  return { get, has, publicSettings };
}

export function sanitizeSettingsPayload(payload = {}) {
  const updates = {};
  for (const key of SETTINGS_KEYS) {
    if (!(key in payload)) continue;
    const value = String(payload[key] ?? "").trim();
    if (SECRET_KEYS.has(key) && value === "") continue;
    updates[key] = value;
  }
  return updates;
}
