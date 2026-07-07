import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractMusicQuery } from "../router.js";
import { toPrompt } from "../context.js";

const execFileAsync = promisify(execFile);

export function createAiAdapter(runtime) {
  async function decide(context) {
    const provider = runtime.get("AI_PROVIDER") || "mock";
    try {
      if (provider === "claude_cli") return await callClaudeCli(runtime, context);
      if (provider === "anthropic") return await callAnthropic(runtime, context);
      if (provider === "openai") return await callOpenAi(runtime, context);
      return mockDecision(context);
    } catch (error) {
      const fallback = mockDecision(context);
      return {
        ...fallback,
        reason: `${fallback.reason}；真实 AI 适配器暂不可用：${error.message}`
      };
    }
  }

  return { decide };
}

function mockDecision(context) {
  const query = extractMusicQuery(context.userMessage, context.intent);
  const moment = inferMoment(context);
  const shouldQueue = wantsImmediatePlayback(context.userMessage);
  const reply = shouldQueue
    ? `收到，我先按「${query}」给你找一组适合${moment}的歌。`
    : `可以，我们先聊感觉。我会按「${query}」给你挑几首适合${moment}的候选，你可以从推荐里点一首开始。`;
  return {
    reply,
    say: shouldQueue ? `收到。我会按「${query}」给你排一段${moment}的播放流。` : reply,
    play: {
      query,
      mood: moment,
      autoQueue: shouldQueue
    },
    recommendations: [
      {
        title: query,
        query,
        reason: `贴合当前的${moment}状态，先用网易云搜索拿到可播放版本。`
      }
    ],
    apiCalls: [
      {
        name: "music.search",
        query,
        limit: 4
      }
    ],
    profileUpdates: inferProfileUpdates(context.userMessage),
    shouldQueue,
    reason: "Mock 大脑根据当前输入、用户口味和默认作息生成，未使用云端 API。",
    segue: "先把节奏稳住，再慢慢推进。"
  };
}

function inferMoment(context) {
  const hour = new Date(context.now).getHours();
  const text = String(context.userMessage || "");
  if (/累|放松|睡|夜/.test(text) || hour >= 21) return "夜间放松";
  if (/工作|专注|开工|学习/.test(text) || (hour >= 9 && hour <= 18)) return "专注";
  if (/早|醒|通勤/.test(text) || hour < 9) return "清晨";
  return "日常";
}

function wantsImmediatePlayback(message) {
  const text = String(message || "");
  if (blocksImmediatePlayback(text)) return false;
  return /播放|直接播|开始播|来一首|放一首|放首|切歌|下一首/.test(text);
}

function blocksImmediatePlayback(message) {
  return /(?:别|不要|不用|先别|先不|无需|暂时不|不需要).{0,8}(?:播放|自动播放|播)/.test(message)
    || /(?:推荐|聊聊).{0,16}(?:就好|即可|先看看)/.test(message);
}

function inferProfileUpdates(message) {
  const text = String(message || "").trim();
  if (!hasStablePreference(text)) return [];
  return [
    {
      file: "taste.md",
      text: `用户表达了偏好：${compactText(text, 96)}`
    }
  ];
}

function hasStablePreference(text) {
  return /我.{0,8}(喜欢|爱听|不喜欢|讨厌|偏好|口味)|以后.{0,12}(多|少|别|不要|优先)|别.{0,8}(推荐|放|播)|不要.{0,8}(推荐|放|播)/.test(text);
}

function compactText(text, maxLength) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

async function callClaudeCli(runtime, context) {
  const bin = runtime.get("CLAUDE_CLI_BIN") || "claude";
  const prompt = toPrompt(context);
  const { stdout } = await execFileAsync(
    bin,
    ["-p", prompt, "--output-format", "json"],
    { timeout: 45000, maxBuffer: 1024 * 1024 }
  );
  return normalizeDecision(parseMaybeJson(stdout), context);
}

async function callAnthropic(runtime, context) {
  const key = runtime.get("ANTHROPIC_API_KEY") || runtime.get("ANTHROPIC_AUTH_TOKEN");
  if (!key) throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is empty");
  const baseUrl = (runtime.get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "");
  const messagesUrl = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
  const data = await fetchJson(messagesUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: runtime.get("ANTHROPIC_MODEL"),
      max_tokens: 800,
      messages: [{ role: "user", content: toPrompt(context) }]
    })
  }, "Anthropic API", aiTimeoutMs(runtime));
  const text = data.content?.map((part) => part.text || "").join("\n") || "";
  return normalizeDecision(parseMaybeJson(text), context);
}

async function callOpenAi(runtime, context) {
  const key = runtime.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is empty");
  const baseUrl = runtime.get("OPENAI_BASE_URL").replace(/\/$/, "");
  const data = await fetchJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: runtime.get("OPENAI_MODEL"),
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are Claudio, a conversational local AI music companion. Return valid JSON only."
        },
        { role: "user", content: toPrompt(context) }
      ]
    })
  }, "OpenAI-compatible API", aiTimeoutMs(runtime));
  const text = data.choices?.[0]?.message?.content || "";
  return normalizeDecision(parseMaybeJson(text), context);
}

function aiTimeoutMs(runtime) {
  const value = Number(runtime.get("AI_TIMEOUT_MS") || 60000);
  return Number.isFinite(value) && value >= 5000 ? value : 60000;
}

async function fetchJson(url, options, label, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok) {
      const message = data.error?.message || data.message || data.msg || text || response.statusText;
      throw new Error(`${label} ${response.status}: ${String(message).slice(0, 180)}`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${label} timeout after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeDecision(raw, context) {
  const fallback = mockDecision(context);
  const recommendationValue = raw?.recommendations ?? raw?.songs ?? raw?.picks;
  const apiCallValue = raw?.apiCalls ?? raw?.toolCalls ?? raw?.tools;
  const hasRecommendationValue = Array.isArray(recommendationValue);
  const hasApiCallValue = Array.isArray(apiCallValue);
  const recommendations = normalizeRecommendations(recommendationValue, fallback, !hasRecommendationValue);
  const apiCalls = normalizeApiCalls(
    apiCallValue,
    recommendations,
    fallback,
    !hasApiCallValue && recommendations.length > 0
  );
  const reply = String(raw?.reply || raw?.message || raw?.answer || raw?.say || fallback.reply || fallback.say);
  const shouldQueue = Boolean(raw?.shouldQueue ?? raw?.play?.autoQueue ?? fallback.shouldQueue);
  return {
    reply,
    say: String(raw?.say || reply || fallback.say),
    play: {
      query: String(raw?.play?.query || raw?.query || fallback.play.query),
      mood: String(raw?.play?.mood || fallback.play.mood),
      autoQueue: shouldQueue
    },
    recommendations,
    apiCalls,
    profileUpdates: normalizeProfileUpdates(raw?.profileUpdates ?? raw?.memoryUpdates ?? fallback.profileUpdates),
    shouldQueue,
    reason: String(raw?.reason || fallback.reason),
    segue: String(raw?.segue || fallback.segue)
  };
}

function normalizeProfileUpdates(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const file = String(item?.file || "taste.md");
      const text = String(item?.text || item?.note || item?.content || "").trim();
      if (!text) return null;
      return { file, text: compactText(text, 180) };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeRecommendations(value, fallback, allowFallback) {
  const items = Array.isArray(value) ? value : [];
  const normalized = items
    .map((item) => {
      if (typeof item === "string") {
        return { title: item, query: item, reason: "" };
      }
      const query = String(item?.query || [item?.title, item?.artist].filter(Boolean).join(" ") || "").trim();
      if (!query) return null;
      return {
        title: String(item?.title || query),
        artist: String(item?.artist || ""),
        query,
        reason: String(item?.reason || item?.why || "")
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  if (normalized.length || !allowFallback) return normalized;
  return [
    {
      title: fallback.play.query,
      artist: "",
      query: fallback.play.query,
      reason: fallback.segue
    }
  ];
}

function normalizeApiCalls(value, recommendations, fallback, allowFallback) {
  const items = Array.isArray(value) ? value : [];
  const calls = items
    .map((item) => {
      const name = String(item?.name || item?.tool || item?.type || "").trim();
      const query = String(item?.query || item?.arguments?.query || item?.input?.query || "").trim();
      if (name !== "music.search" || !query) return null;
      const limit = Number(item?.limit || item?.arguments?.limit || item?.input?.limit || 4);
      return { name, query, limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 6) : 4 };
    })
    .filter(Boolean)
    .slice(0, 6);

  if (calls.length || !allowFallback) return calls;
  const source = recommendations.length ? recommendations : [{ query: fallback.play.query }];
  return source.slice(0, 3).map((item) => ({
    name: "music.search",
    query: item.query,
    limit: 4
  }));
}
