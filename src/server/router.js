const PLAY_WORDS = ["播放", "来点", "放一首", "听", "歌单", "音乐", "电台", "dj"];
const SEARCH_WORDS = ["搜索", "找", "查一下", "有没有"];
const PLAN_WORDS = ["计划", "日程", "今天", "安排", "提醒"];
const SETTINGS_WORDS = ["设置", "apikey", "api key", "key", "配置", "provider"];

export function routeIntent(message) {
  const text = String(message || "").toLowerCase();
  if (SETTINGS_WORDS.some((word) => text.includes(word))) return "settings";
  if (PLAN_WORDS.some((word) => text.includes(word))) return "plan";
  if (SEARCH_WORDS.some((word) => text.includes(word))) return "search";
  if (PLAY_WORDS.some((word) => text.includes(word))) return "play";
  return "chat";
}

export function extractMusicQuery(message, intent) {
  const text = String(message || "").trim();
  if (!text) return "focus electronic";
  const cleaned = text
    .replace(/播放|来点|放一首|听|搜索|找|音乐|电台|歌单|dj/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) return cleaned;
  if (intent === "plan") return "soft productivity";
  if (intent === "chat") return "late night radio";
  return "focus electronic";
}
