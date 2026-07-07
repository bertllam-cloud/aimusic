import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createRuntimeConfig, getDefaultDataDir, loadDotEnv, sanitizeSettingsPayload } from "./config.js";
import { createStateStore } from "./state.js";
import { routeIntent } from "./router.js";
import { buildContext } from "./context.js";
import { createPlaybackQueue } from "./queue.js";
import { createAiAdapter } from "./adapters/ai.js";
import { createMusicAdapter } from "./adapters/music.js";
import { createTtsAdapter } from "./adapters/tts.js";

loadDotEnv();

export async function startServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const dataDir = options.dataDir || getDefaultDataDir();
  const port = Number(options.port || process.env.CLAUDIO_API_PORT || 4217);
  const store = await createStateStore(dataDir);
  const runtime = createRuntimeConfig(store);
  const queue = createPlaybackQueue(store);
  const ai = createAiAdapter(runtime);
  const music = createMusicAdapter(runtime);
  const tts = createTtsAdapter(runtime, store);
  const profileFiles = ["taste.md", "routines.md", "mood-rules.md", "playlists.json"];
  const learnedProfileFiles = ["taste.md", "routines.md", "mood-rules.md"];

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/tts", express.static(store.ttsDir));

  const wss = new WebSocketServer({ server, path: "/stream" });
  const broadcast = (type, payload) => {
    const message = JSON.stringify({ type, payload, sentAt: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  };

  async function requestNcm(pathname, options = {}) {
    const baseValue = runtime.get("NCM_API_BASE");
    if (!baseValue) {
      const error = new Error("NCM_API_BASE is empty. Start ncm-api-enhanced and set its local URL first.");
      error.status = 400;
      throw error;
    }

    const base = baseValue.replace(/\/$/, "");
    const separator = pathname.includes("?") ? "&" : "?";
    const params = new URLSearchParams({ timestamp: String(Date.now()), ua: "pc" });
    if (options.cookie && !options.body) params.set("cookie", options.cookie);
    const url = `${base}${pathname}${separator}${params.toString()}`;
    const headers = {};
    if (options.cookie) headers.cookie = options.cookie;
    const body = options.body
      ? {
          ...options.body,
          ...(options.cookie && !options.body.cookie ? { cookie: options.cookie } : {})
        }
      : undefined;
    if (body) headers["content-type"] = "application/json";

    const ncmResponse = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await ncmResponse.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!ncmResponse.ok) {
      const error = new Error(data.message || data.msg || `Netease API ${ncmResponse.status}`);
      error.status = ncmResponse.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function sendNcmError(response, error) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
    response.status(status).json({
      error: error.message || "Netease login failed",
      detail: error.data
    });
  }

  function requireNcmCookie() {
    const cookie = runtime.get("NCM_COOKIE");
    if (!cookie) {
      const error = new Error("请先在设置里完成网易云扫码登录");
      error.status = 401;
      throw error;
    }
    return cookie;
  }

  async function getNcmAccount() {
    const cookie = runtime.get("NCM_COOKIE");
    if (!cookie) {
      return {
        loggedIn: false,
        profile: null,
        settings: runtime.publicSettings()
      };
    }

    const statusData = await requestNcm("/login/status", {
      method: "POST",
      cookie,
      body: { cookie }
    });
    const profile = statusData.data?.profile || statusData.profile || null;
    return {
      loggedIn: Boolean(profile),
      profile: normalizeNcmProfile(profile),
      settings: runtime.publicSettings()
    };
  }

  async function requireNcmProfile() {
    const cookie = requireNcmCookie();
    const account = await getNcmAccount();
    if (!account.profile?.userId) {
      const error = new Error("网易云登录状态无效，请重新扫码登录");
      error.status = 401;
      throw error;
    }
    return { cookie, profile: account.profile };
  }

  async function getNcmPlaylists(profile, cookie) {
    const data = await requestNcm(
      `/user/playlist?uid=${encodeURIComponent(profile.userId)}&limit=60`,
      { cookie }
    );
    return normalizeNcmPlaylists(data);
  }

  async function getNcmLikedTracks(limit = 30) {
    const { cookie, profile } = await requireNcmProfile();
    const data = await requestNcm(`/likelist?uid=${encodeURIComponent(profile.userId)}`, { cookie });
    const ids = extractLikedIds(data);
    const tracks = await music.tracksByIds(ids, limit);
    const summary = formatTrackSummary(tracks, ids.length);
    store.setPref("netease.liked.summary", summary);
    return { ids, tracks, summary, profile };
  }

  function loadNcmTracks(response, tracks, decision) {
    const snapshot = queue.load(tracks, decision);
    broadcast("now", snapshot);
    response.json({ tracks, now: snapshot, decision });
  }

  async function runDecisionApiCalls(decision) {
    const calls = Array.isArray(decision?.apiCalls) ? decision.apiCalls.slice(0, 6) : [];
    const results = [];
    for (const call of calls) {
      if (call?.name !== "music.search" || !call.query) continue;
      const limit = clamp(Number(call.limit || 4), 1, 6);
      try {
        const tracks = (await music.search(call.query)).slice(0, limit);
        results.push({ name: "music.search", query: call.query, limit, tracks });
      } catch (error) {
        results.push({
          name: "music.search",
          query: call.query,
          limit,
          tracks: [],
          error: error.message || "music.search failed"
        });
      }
    }
    return results;
  }

  async function searchFallbackTrack(decision, intent) {
    if (!decision?.play?.query || !["play", "search"].includes(intent)) return [];
    return music.search(decision.play.query);
  }

  function buildRecommendationTracks(decision, toolResults) {
    const recs = Array.isArray(decision?.recommendations) ? decision.recommendations : [];
    const seen = new Set();
    const tracks = [];
    for (const result of toolResults) {
      const matchingRec = recs.find((item) => item.query === result.query) || recs[0];
      for (const track of result.tracks || []) {
        const id = String(track.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        tracks.push({
          ...track,
          recommendationQuery: result.query,
          recommendationReason: matchingRec?.reason || decision?.segue || ""
        });
      }
    }
    return tracks.slice(0, 12);
  }

  function shouldAutoQueue(intent, message, decision) {
    const text = String(message || "");
    if (blocksImmediatePlayback(text)) return false;
    const explicit = /播放|直接播|开始播|来一首|放一首|放首|切歌/.test(text);
    return explicit || (intent === "play" && Boolean(decision?.shouldQueue || decision?.play?.autoQueue));
  }

  function blocksImmediatePlayback(message) {
    return /(?:别|不要|不用|先别|先不|无需|暂时不|不需要).{0,8}(?:播放|自动播放|播)/.test(message)
      || /(?:推荐|聊聊).{0,16}(?:就好|即可|先看看)/.test(message);
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function profilePayload() {
    return Object.fromEntries(profileFiles.map((file) => [file, store.readUserFile(file)]));
  }

  function saveProfileFiles(files) {
    const input = files && typeof files === "object" ? files : {};
    const saved = [];
    for (const file of profileFiles) {
      if (!(file in input)) continue;
      const value = String(input[file] ?? "");
      if (value.length > 40000) {
        const error = new Error(`${file} is too large`);
        error.status = 400;
        throw error;
      }
      if (file === "playlists.json" && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          const error = new Error("playlists.json must be valid JSON");
          error.status = 400;
          throw error;
        }
      }
      store.writeUserFile(file, value);
      saved.push(file);
    }
    return saved;
  }

  function applyConversationProfileUpdates(message, decision) {
    const updates = [
      ...normalizeProfileUpdates(decision?.profileUpdates),
      ...extractProfileUpdates(message)
    ];
    const seen = new Set();
    const applied = [];
    for (const update of updates) {
      const file = learnedProfileFiles.includes(update.file) ? update.file : "taste.md";
      const text = compactProfileText(update.text);
      if (!text) continue;
      const key = `${file}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (appendProfileLearning(file, text)) applied.push({ file, text });
    }
    return applied;
  }

  function normalizeProfileUpdates(value) {
    const items = Array.isArray(value) ? value : [];
    return items
      .map((item) => ({
        file: String(item?.file || "taste.md"),
        text: String(item?.text || item?.note || item?.content || "").trim()
      }))
      .filter((item) => item.text)
      .slice(0, 6);
  }

  function extractProfileUpdates(message) {
    const text = compactProfileText(message, 160);
    if (!text) return [];
    if (!/我.{0,8}(喜欢|爱听|不喜欢|讨厌|偏好|口味)|以后.{0,12}(多|少|别|不要|优先)|别.{0,8}(推荐|放|播)|不要.{0,8}(推荐|放|播)/.test(text)) {
      return [];
    }
    return [{ file: "taste.md", text: `用户表达了偏好：${text}` }];
  }

  function appendProfileLearning(file, text) {
    const title = "## Learned from conversations";
    const line = `- ${new Date().toISOString().slice(0, 10)} ${text}`;
    const existing = store.readUserFile(file);
    if (existing.includes(text)) return false;
    const trimmed = existing.trimEnd();
    const next = trimmed.includes(title)
      ? `${trimmed}\n${line}\n`
      : `${trimmed}\n\n${title}\n${line}\n`;
    store.writeUserFile(file, next);
    return true;
  }

  function compactProfileText(value, maxLength = 180) {
    const clean = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^[\-•\s]+/, "")
      .trim();
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
  }

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "now", payload: queue.snapshot() }));
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, dataDir, port });
  });

  app.get("/api/now", (_request, response) => {
    response.json(queue.snapshot());
  });

  app.get("/api/next", (_request, response) => {
    const snapshot = queue.next();
    broadcast("now", snapshot);
    response.json(snapshot);
  });

  app.get("/api/previous", (_request, response) => {
    const snapshot = queue.previous();
    broadcast("now", snapshot);
    response.json(snapshot);
  });

  app.post("/api/play", (request, response) => {
    const track = request.body?.track;
    const snapshot = track?.id ? queue.load([track], queue.snapshot().decision) : queue.play(request.body?.id);
    broadcast("now", snapshot);
    response.json(snapshot);
  });

  app.get("/api/audio/:id", async (request, response) => {
    try {
      const playbackUrl = await music.playbackUrl(request.params.id);
      const headers = {};
      if (request.headers.range) headers.range = request.headers.range;
      const audioResponse = await fetch(playbackUrl, { headers });
      if (!audioResponse.ok || !audioResponse.body) {
        response.status(audioResponse.status || 502).json({ error: "audio stream failed" });
        return;
      }

      response.status(audioResponse.status);
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = audioResponse.headers.get(header);
        if (value) response.setHeader(header, value);
      }
      if (!response.getHeader("content-type")) response.setHeader("content-type", "audio/mpeg");
      Readable.fromWeb(audioResponse.body).pipe(response);
    } catch (error) {
      response.status(502).json({ error: error.message || "audio proxy failed" });
    }
  });

  app.get("/api/taste", (_request, response) => {
    response.json({
      files: profilePayload()
    });
  });

  app.post("/api/taste", (request, response) => {
    try {
      const saved = saveProfileFiles(request.body?.files);
      response.json({ files: profilePayload(), saved });
    } catch (error) {
      response.status(error.status || 400).json({ error: error.message || "profile save failed" });
    }
  });

  app.get("/api/plan/today", (_request, response) => {
    response.json({ items: store.todayPlan() });
  });

  app.get("/api/settings", (_request, response) => {
    response.json({ settings: runtime.publicSettings() });
  });

  app.post("/api/settings", (request, response) => {
    const updates = sanitizeSettingsPayload(request.body);
    for (const [key, value] of Object.entries(updates)) {
      store.setSetting(key, value);
    }
    response.json({ ok: true, settings: runtime.publicSettings() });
  });

  app.get("/api/ncm/login/qr", async (_request, response) => {
    try {
      const keyData = await requestNcm("/login/qr/key");
      const key = keyData.data?.unikey || keyData.unikey;
      if (!key) {
        response.status(502).json({ error: "Netease did not return QR key" });
        return;
      }

      const qrData = await requestNcm(
        `/login/qr/create?key=${encodeURIComponent(key)}&platform=web&qrimg=true`
      );
      response.json({
        key,
        qrimg: qrData.data?.qrimg || "",
        qrurl: qrData.data?.qrurl || "",
        message: "打开网易云音乐 App 扫码登录"
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.get("/api/ncm/login/check", async (request, response) => {
    const key = String(request.query.key || "").trim();
    if (!key) {
      response.status(400).json({ error: "key is required" });
      return;
    }

    try {
      let statusData;
      try {
        statusData = await requestNcm(`/login/qr/check?key=${encodeURIComponent(key)}`);
      } catch (error) {
        if (error.status !== 502) throw error;
        statusData = await requestNcm(
          `/login/qr/check?key=${encodeURIComponent(key)}&noCookie=true`
        );
      }

      const code = Number(statusData.code ?? statusData.data?.code);
      if (code === 803 && statusData.cookie) {
        store.setSetting("NCM_COOKIE", statusData.cookie);
      }

      const account = code === 803 ? await getNcmAccount().catch(() => null) : null;

      response.json({
        code,
        success: code === 803,
        message: ncmLoginMessage(code, statusData.message || statusData.msg),
        account,
        settings: code === 803 ? runtime.publicSettings() : undefined
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.get("/api/ncm/login/status", async (_request, response) => {
    try {
      response.json(await getNcmAccount());
    } catch (error) {
      response.json({
        loggedIn: false,
        error: error.message || "Netease status failed",
        settings: runtime.publicSettings()
      });
    }
  });

  app.get("/api/ncm/me", async (_request, response) => {
    try {
      response.json(await getNcmAccount());
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.get("/api/ncm/playlists", async (_request, response) => {
    try {
      const { cookie, profile } = await requireNcmProfile();
      const playlists = await getNcmPlaylists(profile, cookie);
      response.json({
        profile,
        playlists,
        likedPlaylist: findLikedPlaylist(playlists)
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.get("/api/ncm/liked", async (request, response) => {
    try {
      const limit = Number(request.query.limit || 30);
      const { ids, tracks, summary, profile } = await getNcmLikedTracks(limit);
      response.json({
        profile,
        idsCount: ids.length,
        tracks,
        summary
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/ncm/load/liked", async (_request, response) => {
    try {
      const { tracks, summary } = await getNcmLikedTracks(24);
      loadNcmTracks(response, tracks, {
        say: "已接入你的网易云喜欢歌曲，先从最熟悉的口味开始。",
        play: { query: "网易云我喜欢", mood: "个人口味" },
        reason: summary,
        segue: "这组歌会作为 Claudio 后续判断你口味的参考。"
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/ncm/load/daily", async (_request, response) => {
    try {
      const cookie = requireNcmCookie();
      const data = await requestNcm("/recommend/songs", { cookie });
      const songs = extractNcmSongs(data);
      const tracks = await music.tracksFromSongs(songs, 24);
      loadNcmTracks(response, tracks, {
        say: "已载入网易云每日推荐。",
        play: { query: "网易云每日推荐", mood: "今日推荐" },
        reason: "来自网易云账号的每日推荐歌曲。",
        segue: "先听今天推荐给你的第一首。"
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/ncm/load/fm", async (_request, response) => {
    try {
      const cookie = requireNcmCookie();
      const data = await requestNcm("/personal_fm", { cookie });
      const songs = extractNcmSongs(data);
      const tracks = await music.tracksFromSongs(songs, 12);
      loadNcmTracks(response, tracks, {
        say: "私人 FM 已接入。",
        play: { query: "网易云私人 FM", mood: "私人电台" },
        reason: "来自网易云私人 FM 的即时推荐。",
        segue: "让它按你的收听习惯往下走。"
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/ncm/load/heartbeat", async (request, response) => {
    try {
      const { cookie, profile } = await requireNcmProfile();
      const current = queue.snapshot().current;
      const songId = request.body?.id || current?.id;
      if (!songId || current?.source !== "netease") {
        response.status(400).json({ error: "心动模式需要当前播放网易云歌曲" });
        return;
      }

      const playlists = await getNcmPlaylists(profile, cookie);
      const likedPlaylist = findLikedPlaylist(playlists);
      const playlistId = request.body?.playlistId || current?.playlistId || likedPlaylist?.id || playlists[0]?.id;
      if (!playlistId) {
        response.status(400).json({ error: "没有找到可用于心动模式的网易云歌单" });
        return;
      }

      const data = await requestNcm(
        `/playmode/intelligence/list?id=${encodeURIComponent(songId)}&pid=${encodeURIComponent(playlistId)}&sid=${encodeURIComponent(songId)}&count=18`,
        { cookie }
      );
      const songs = extractNcmSongs(data);
      const tracks = await music.tracksFromSongs(songs, 18);
      loadNcmTracks(response, tracks, {
        say: "心动模式已开启，会按当前歌曲继续延展。",
        play: { query: "网易云心动模式", mood: "智能续播" },
        reason: `基于当前歌曲和歌单「${likedPlaylist?.name || playlistId}」生成。`,
        segue: "下一首会贴近这首歌的气质。"
      });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/ncm/like", async (request, response) => {
    try {
      const cookie = requireNcmCookie();
      const id = String(request.body?.id || "").trim();
      if (!id) {
        response.status(400).json({ error: "id is required" });
        return;
      }
      const liked = request.body?.like !== false;
      const data = await requestNcm(`/like?id=${encodeURIComponent(id)}&like=${liked ? "true" : "false"}`, {
        cookie
      });
      response.json({ ok: Number(data.code) === 200, liked, code: data.code, message: data.message || data.msg });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.get("/api/ncm/like/check", async (request, response) => {
    try {
      const cookie = requireNcmCookie();
      const ids = String(request.query.ids || request.query.id || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (!ids.length) {
        response.status(400).json({ error: "ids is required" });
        return;
      }
      const data = await requestNcm(`/song/like/check?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
        cookie
      });
      const likedIds = Array.isArray(data.data) ? data.data.map(String) : [];
      response.json({ likedIds, liked: likedIds.includes(String(ids[0])) });
    } catch (error) {
      sendNcmError(response, error);
    }
  });

  app.post("/api/tts", async (request, response) => {
    const result = await tts.synthesize(request.body?.text || "");
    response.json(result);
  });

  app.post("/api/chat", async (request, response) => {
    const message = String(request.body?.message || "").trim();
    if (!message) {
      response.status(400).json({ error: "message is required" });
      return;
    }

    const intent = routeIntent(message);
    store.addMessage("user", message, intent);
    const context = buildContext({ store, runtime, intent, message });
    const decision = await ai.decide(context);
    let toolResults = await runDecisionApiCalls(decision);
    if (!toolResults.length) {
      const fallbackTracks = await searchFallbackTrack(decision, intent);
      if (fallbackTracks.length) {
        toolResults = [
          {
            name: "music.search",
            query: decision.play.query,
            limit: fallbackTracks.length,
            tracks: fallbackTracks
          }
        ];
      }
    }
    const recommendations = buildRecommendationTracks(decision, toolResults);
    const profileUpdates = applyConversationProfileUpdates(message, decision);
    const autoQueue = shouldAutoQueue(intent, message, decision);
    const snapshot = autoQueue && recommendations.length
      ? queue.enqueue(recommendations, decision)
      : queue.setDecision(decision);
    store.addMessage("assistant", decision.reply || decision.say, intent);

    const payload = {
      intent,
      decision,
      tracks: autoQueue ? recommendations : [],
      recommendations,
      profileUpdates,
      toolResults: toolResults.map((result) => ({
        name: result.name,
        query: result.query,
        limit: result.limit,
        count: result.tracks?.length || 0,
        error: result.error
      })),
      now: snapshot
    };
    broadcast("chat", payload);
    broadcast("now", snapshot);
    response.json(payload);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    app,
    server,
    port,
    dataDir,
    close() {
      wss.close();
      store.close();
      server.close();
    }
  };
}

function normalizeNcmProfile(profile) {
  if (!profile) return null;
  return {
    userId: profile.userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    signature: profile.signature || ""
  };
}

function normalizeNcmPlaylists(data) {
  const playlists = data.playlist || data.data?.playlist || [];
  return playlists.map((playlist) => ({
    id: String(playlist.id),
    name: playlist.name || "未命名歌单",
    cover: playlist.coverImgUrl || "",
    trackCount: playlist.trackCount || 0,
    subscribed: Boolean(playlist.subscribed),
    specialType: playlist.specialType || 0
  }));
}

function findLikedPlaylist(playlists) {
  return (
    playlists.find((playlist) => Number(playlist.specialType) === 5) ||
    playlists.find((playlist) => /喜欢|我喜欢/.test(playlist.name || "")) ||
    null
  );
}

function extractLikedIds(data) {
  const candidates = [data.ids, data.data?.ids, data.data, data.result?.ids];
  for (const value of candidates) {
    if (Array.isArray(value)) return uniqueValues(value);
  }
  return [];
}

function extractNcmSongs(data) {
  const result = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;

    if (value.songInfo) visit(value.songInfo);
    if (value.song) visit(value.song);
    if (value.resourceExtInfo?.songData) visit(value.resourceExtInfo.songData);
    if (value.simpleSong) visit(value.simpleSong);

    if (value.id && (value.name || value.al || value.album || value.ar || value.artists)) {
      result.push(value);
      return;
    }

    for (const key of [
      "dailySongs",
      "recommend",
      "songs",
      "tracks",
      "list",
      "resources",
      "data",
      "result",
      "playlist"
    ]) {
      visit(value[key]);
    }
  };

  visit(data);
  const seen = new Set();
  return result.filter((song) => {
    const id = String(song.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function formatTrackSummary(tracks, totalCount = 0) {
  const lines = tracks
    .slice(0, 36)
    .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
    .join("\n");
  return `网易云喜欢歌曲共 ${totalCount || tracks.length} 首；已同步摘要：\n${lines}`;
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const item = String(value || "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function ncmLoginMessage(code, fallback = "") {
  if (code === 800) return "二维码已过期，请重新生成";
  if (code === 801) return "等待网易云音乐扫码";
  if (code === 802) return "已扫码，请在手机上确认";
  if (code === 803) return "网易云登录成功，Cookie 已保存到本机";
  return fallback || "正在等待网易云登录状态";
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryPath) {
  startServer()
    .then(({ port, dataDir }) => {
      console.log(`Claudio API listening on http://127.0.0.1:${port}`);
      console.log(`Data directory: ${dataDir}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
