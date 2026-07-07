import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_FILES = {
  "taste.md": `# Taste

- 偏好：旋律清晰、节奏稳定、适合长时间聆听。
- 不喜欢：突兀切歌、过多解说、过强侵略性的音色。
- 场景：工作、通勤、夜间放松。
`,
  "routines.md": `# Routines

- 07:00 轻量唤醒，适合低音量播报天气和今日计划。
- 09:00 专注工作，优先无歌词或轻人声。
- 21:00 放松收束，适合慢节奏和简短 DJ 串词。
`,
  "mood-rules.md": `# Mood Rules

- 如果用户说累了，降低 BPM，减少播报。
- 如果用户说开工，优先专注、电子、器乐。
- 如果用户要求像 DJ 一样，提供简短 segue，不超过两句话。
`,
  "playlists.json": JSON.stringify(
    {
      default: ["focus electronic", "lofi night drive", "indie pop"],
      morning: ["soft morning pop", "acoustic sunrise"],
      night: ["ambient piano", "late night jazz"]
    },
    null,
    2
  )
};

export async function createStateStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const userDir = path.join(dataDir, "user");
  const cacheDir = path.join(dataDir, "cache");
  const ttsDir = path.join(cacheDir, "tts");
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(ttsDir, { recursive: true });

  for (const [file, content] of Object.entries(DEFAULT_FILES)) {
    const target = path.join(userDir, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, content, "utf8");
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "claudio.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT,
      title TEXT NOT NULL,
      artist TEXT,
      source TEXT,
      url TEXT,
      reason TEXT,
      played_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      starts_at TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  seedPlans(db);

  return {
    dataDir,
    userDir,
    cacheDir,
    ttsDir,
    db,
    getSetting(key) {
      return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
    },
    setSetting(key, value) {
      db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(key, value, new Date().toISOString());
    },
    getSettings() {
      return db.prepare("SELECT key, value FROM settings").all();
    },
    addMessage(role, content, intent = null) {
      db.prepare(
        "INSERT INTO messages (role, content, intent, created_at) VALUES (?, ?, ?, ?)"
      ).run(role, content, intent, new Date().toISOString());
    },
    recentMessages(limit = 12) {
      return db
        .prepare("SELECT role, content, intent, created_at FROM messages ORDER BY id DESC LIMIT ?")
        .all(limit)
        .reverse();
    },
    addPlay(track, reason = "") {
      db.prepare(
        "INSERT INTO plays (song_id, title, artist, source, url, reason, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        track.id || "",
        track.title || "Untitled",
        track.artist || "",
        track.source || "",
        track.url || "",
        reason,
        new Date().toISOString()
      );
    },
    recentPlays(limit = 10) {
      return db.prepare("SELECT * FROM plays ORDER BY id DESC LIMIT ?").all(limit);
    },
    getPref(key) {
      return db.prepare("SELECT value FROM prefs WHERE key = ?").get(key)?.value;
    },
    setPref(key, value) {
      db.prepare(
        "INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(key, value, new Date().toISOString());
    },
    todayPlan() {
      return db
        .prepare("SELECT id, title, starts_at, source, status FROM plans ORDER BY COALESCE(starts_at, '') ASC, id ASC")
        .all();
    },
    readUserFile(file) {
      const safeFile = path.basename(file);
      const target = path.join(userDir, safeFile);
      if (!fs.existsSync(target)) return "";
      return fs.readFileSync(target, "utf8");
    },
    writeUserFile(file, content) {
      const safeFile = path.basename(file);
      const target = path.join(userDir, safeFile);
      fs.writeFileSync(target, String(content || ""), "utf8");
    },
    writeTtsFile(text, buffer) {
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
      const fileName = `${hash}.mp3`;
      fs.writeFileSync(path.join(ttsDir, fileName), buffer);
      return fileName;
    },
    close() {
      db.close();
    }
  };
}

function seedPlans(db) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM plans").get().count;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO plans (title, starts_at, source, status) VALUES (?, ?, ?, ?)"
  );
  insert.run("轻量天气和日程播报", "07:00", "seed", "pending");
  insert.run("专注歌单巡航", "09:00", "seed", "pending");
  insert.run("夜间放松收束", "21:00", "seed", "pending");
}
