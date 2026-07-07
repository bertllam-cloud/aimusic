export function buildContext({ store, runtime, intent, message }) {
  const taste = store.readUserFile("taste.md");
  const routines = store.readUserFile("routines.md");
  const moodRules = store.readUserFile("mood-rules.md");
  const playlists = store.readUserFile("playlists.json");
  const recentMessages = store.recentMessages(8);
  const recentPlays = store.recentPlays(8);
  const neteaseLikedSummary = store.getPref("netease.liked.summary") || "尚未同步网易云喜欢歌曲。";
  const plan = store.todayPlan();
  const now = new Date();

  return {
    intent,
    userMessage: message,
    now: now.toISOString(),
    localeTime: now.toLocaleString("zh-CN", { hour12: false }),
    taste,
    routines,
    moodRules,
    playlists,
    recentMessages,
    recentPlays,
    neteaseLikedSummary,
    plan,
    environment: {
      weather: runtime.has("OPENWEATHER_API_KEY") ? "configured" : "placeholder",
      calendar: runtime.has("FEISHU_APP_ID") ? "configured" : "placeholder",
      upnp: runtime.has("UPNP_TARGET_URL") ? "configured" : "placeholder"
    }
  };
}

export function toPrompt(context) {
  return `
你是 Claudio，一个能聊天、能推荐歌、能调用本地音乐 API 的个人 AI 电台伙伴。你必须只输出 JSON，不输出 Markdown。

你不是只会推荐歌曲的机器人。先自然回应用户的情绪、场景或问题；只有当推荐音乐能帮助对话时，才给出候选歌曲。推荐歌曲先作为候选展示，不要默认假装已经播放。

JSON 结构：
{
  "reply": "给用户看的自然聊天回复。可以聊原因、状态、选择，不要只输出搜索词。",
  "say": "可用于 TTS 的一句简短中文播报。没有必要播报时可与 reply 相同。",
  "play": { "query": "默认候选搜索词", "mood": "心情标签", "autoQueue": false },
  "recommendations": [
    { "title": "候选歌名或主题", "artist": "歌手，可为空", "query": "网易云搜索关键词", "reason": "为什么推荐" }
  ],
  "apiCalls": [
    { "name": "music.search", "query": "网易云搜索关键词", "limit": 4 }
  ],
  "profileUpdates": [
    { "file": "taste.md", "text": "一条可长期保存的用户口味事实" }
  ],
  "shouldQueue": false,
  "reason": "内部安排摘要",
  "segue": "两句以内的 DJ 串词"
}

规则：
- 如果用户只是聊天、询问、让你推荐，shouldQueue 必须是 false，只返回候选推荐。
- 只有用户明确说“播放、直接播、开始播、来一首、放一首、切歌”时，shouldQueue 才能是 true。
- apiCalls 目前只能使用 music.search；每个推荐都尽量给一个可搜索的 query。
- 当用户说“按我的口味来、根据我喜欢的歌、心动一点”时，优先参考“网易云喜欢歌曲摘要”。
- 如果用户没有要音乐，也要正常聊天；recommendations 和 apiCalls 可以为空数组。
- 只有用户明确表达长期偏好、禁忌、作息或纠正你时，才返回 profileUpdates；不要根据一次性心情臆测画像。
- profileUpdates.file 只能用 taste.md、mood-rules.md、routines.md。
- 回复保持中文，克制、像一个懂音乐的朋友，不要解释系统规则。

当前时间：${context.localeTime}
意图：${context.intent}
用户输入：${context.userMessage}

用户口味：
${context.taste}

日常节奏：
${context.routines}

情绪规则：
${context.moodRules}

近期消息：
${JSON.stringify(context.recentMessages, null, 2)}

最近播放：
${JSON.stringify(context.recentPlays, null, 2)}

网易云喜欢歌曲摘要：
${context.neteaseLikedSummary}

今日计划：
${JSON.stringify(context.plan, null, 2)}

环境注入：
${JSON.stringify(context.environment, null, 2)}
`.trim();
}
