import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  CalendarDays,
  CircleUserRound,
  CloudSun,
  Disc3,
  Heart,
  KeyRound,
  ListMusic,
  Pause,
  PanelRightOpen,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Waves,
  X
} from "lucide-react";
import "./styles.css";

const API_BASE = window.localStorage.getItem("claudio_api_base") || "http://127.0.0.1:4217";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const FONT_OPTIONS = [
  {
    id: "apple-system",
    name: "Apple 系统感",
    note: "最接近 Apple Music，界面清爽、中文稳。",
    ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    display: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", sans-serif',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei UI"]
  },
  {
    id: "pingfang",
    name: "苹方圆润",
    note: "中文更柔和，适合播放器和聊天界面。",
    ui: '"PingFang SC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Microsoft YaHei UI", sans-serif',
    display: '"PingFang SC", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["PingFang SC"]
  },
  {
    id: "hiragino",
    name: "冬青黑体",
    note: "笔画更细腻，日系杂志感更强。",
    ui: '"Hiragino Sans GB", "Hiragino Sans", "PingFang SC", "Microsoft YaHei UI", sans-serif',
    display: '"Hiragino Sans GB", "PingFang SC", "SF Pro Display", sans-serif',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["Hiragino Sans GB", "Hiragino Sans"]
  },
  {
    id: "microsoft",
    name: "Windows 清晰",
    note: "Windows 上更清楚，跨平台交付稳。",
    ui: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    display: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    mono: '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", monospace',
    fonts: ["Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei"]
  },
  {
    id: "noto",
    name: "思源黑体",
    note: "中性、干净，适合长期阅读和设置页。",
    ui: '"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
    display: '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC"]
  },
  {
    id: "songti",
    name: "宋体文艺",
    note: "更有唱片说明文字感，适合歌词和文案。",
    ui: '"Songti SC", "STSong", SimSun, "PingFang SC", "Microsoft YaHei UI", serif',
    display: '"Songti SC", "STSong", SimSun, serif',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["Songti SC", "STSong", "SimSun"]
  },
  {
    id: "mono-radio",
    name: "电台等宽",
    note: "数字和标题更像播放器终端，个性强。",
    ui: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
    display: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", Consolas, monospace',
    fonts: ["SF Mono", "Cascadia Mono", "Cascadia Code", "Consolas"]
  }
];

applyStoredFontChoice();

function applyStoredFontChoice() {
  const option = FONT_OPTIONS.find((item) => item.id === window.localStorage.getItem("claudio_font_choice"));
  if (option) applyFontChoice(option);
}

function applyFontChoice(option) {
  document.documentElement.style.setProperty("--font-ui", option.ui);
  document.documentElement.style.setProperty("--font-display", option.display);
  document.documentElement.style.setProperty("--font-mono", option.mono);
  window.localStorage.setItem("claudio_font_choice", option.id);
}

function App() {
  const [activeView, setActiveView] = useState("player");
  const [now, setNow] = useState({ current: null, queue: [], decision: null });
  const [taste, setTaste] = useState(null);
  const [plan, setPlan] = useState([]);
  const [settings, setSettings] = useState({});
  const [ncmAccount, setNcmAccount] = useState({ loggedIn: false, profile: null });
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "今晚先保持一个稳定的私人电台流。你可以直接说想听什么。"
    }
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [isPlaying, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    refresh();
    const socket = new WebSocket(`${WS_BASE}/stream`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "now") setNow(message.payload);
      if (message.type === "chat") {
        appendAssistantFromPayload(message.payload);
        if (message.payload?.profileUpdates?.length) refreshTaste().catch(() => {});
      }
    });
    return () => socket.close();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const source = audioSource(now.current);
    if (!audio || !source) return;
    setPlaybackError("");
    setCurrentTime(0);
    audio.src = source;
    audio.load();
    if (isPlaying) startAudio(audio);
  }, [now.current?.id, now.current?.streamUrl, now.current?.url]);

  async function refresh() {
    const [nowRes, tasteRes, planRes, settingsRes, ncmRes] = await Promise.all([
      getJson("/api/now"),
      getJson("/api/taste"),
      getJson("/api/plan/today"),
      getJson("/api/settings"),
      getJson("/api/ncm/login/status").catch(() => ({ loggedIn: false, profile: null }))
    ]);
    setNow(nowRes);
    setTaste(tasteRes.files);
    setPlan(planRes.items);
    setSettings(settingsRes.settings);
    setNcmAccount({ loggedIn: ncmRes.loggedIn, profile: ncmRes.profile || null });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setMessages((items) => [...items, { role: "user", content: message }]);
    setInput("");
    setPending(true);
    try {
      const result = await postJson("/api/chat", { message });
      setNow(result.now);
      appendAssistantFromPayload(result);
      if (result.profileUpdates?.length) refreshTaste();
      speak(result.decision.say || result.decision.reply);
    } finally {
      setPending(false);
    }
  }

  async function speak(text) {
    const result = await postJson("/api/tts", { text });
    if (result.audioUrl) {
      const voice = new Audio(`${API_BASE}${result.audioUrl}`);
      voice.play().catch(() => speakInBrowser(text));
      return;
    }
    speakInBrowser(text);
  }

  function appendAssistantFromPayload(payload) {
    appendAssistant(payload?.decision?.reply || payload?.decision?.say, payload?.recommendations || []);
  }

  function appendAssistant(content, recommendations = []) {
    const cleanContent = String(content || "").trim();
    if (!cleanContent) return;
    setMessages((items) => {
      const last = items[items.length - 1];
      if (last?.role === "assistant" && last.content === cleanContent) return items;
      return [...items, { role: "assistant", content: cleanContent, recommendations }];
    });
  }

  function speakInBrowser(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  async function nextTrack() {
    const result = await getJson("/api/next");
    setNow(result);
    setCurrentTime(0);
  }

  async function previousTrack() {
    const result = await getJson("/api/previous");
    setNow(result);
    setCurrentTime(0);
  }

  async function selectTrack(id) {
    const result = await postJson("/api/play", { id });
    setNow(result);
    setCurrentTime(0);
    setPlaying(true);
  }

  async function playRecommendation(track) {
    const result = await postJson("/api/play", { track });
    setNow(result);
    setCurrentTime(0);
    setPlaying(true);
  }

  async function loadNcmSource(source) {
    const result = await postJson(`/api/ncm/load/${source}`, {});
    setNow(result.now);
    setCurrentTime(0);
    setPlaying(true);
    return result;
  }

  async function toggleNcmLike(id, liked) {
    return postJson("/api/ncm/like", { id, like: liked });
  }

  function seekToRatio(ratio) {
    const audio = audioRef.current;
    const targetDuration = duration || now.current?.duration || audio?.duration || 0;
    if (!audio || !Number.isFinite(targetDuration) || targetDuration <= 0) return;
    const nextTime = Math.min(targetDuration, Math.max(0, ratio * targetDuration));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  async function refreshTaste() {
    const tasteRes = await getJson("/api/taste");
    setTaste(tasteRes.files);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !now.current?.url) return;
    if (audio.paused) {
      startAudio(audio);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  async function startAudio(audio) {
    if (!audio) return;
    setPlaybackError("");
    try {
      await audio.play();
      setPlaying(true);
    } catch (error) {
      console.warn("Claudio playback failed", error);
      setPlaybackError(error?.message ? `播放失败：${error.message}` : "播放失败：浏览器没有开始播放音频。");
      setPlaying(false);
    }
  }

  return (
    <div className="app-shell">
      <main className="main-surface">
        {activeView === "player" && (
          <PlayerView
            now={now}
            messages={messages}
            input={input}
            pending={pending}
            isPlaying={isPlaying}
            playbackError={playbackError}
            currentTime={currentTime}
            duration={duration}
            activeView={activeView}
            ncmAccount={ncmAccount}
            onSelectView={setActiveView}
            setInput={setInput}
            sendMessage={sendMessage}
            previousTrack={previousTrack}
            togglePlayback={togglePlayback}
            nextTrack={nextTrack}
            selectTrack={selectTrack}
            playRecommendation={playRecommendation}
            seekToRatio={seekToRatio}
            loadNcmSource={loadNcmSource}
            toggleNcmLike={toggleNcmLike}
          />
        )}
        {activeView === "profile" && (
          <StageShell activeView={activeView} onSelectView={setActiveView}>
            <ProfileView taste={taste} plan={plan} onSaved={setTaste} />
          </StageShell>
        )}
        {activeView === "settings" && (
          <StageShell activeView={activeView} onSelectView={setActiveView}>
            <SettingsView settings={settings} onSaved={setSettings} onAccount={setNcmAccount} />
          </StageShell>
        )}
      </main>
      <audio
        ref={audioRef}
        onEnded={nextTrack}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onCanPlay={() => setPlaybackError("")}
        onError={(event) => setPlaybackError(mediaErrorMessage(event.currentTarget.error))}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || now.current?.duration || 0)}
      />
    </div>
  );
}

function StageNav({ activeView, onSelectView }) {
  const items = [
    { id: "player", label: "播放器", icon: Radio },
    { id: "profile", label: "画像", icon: CircleUserRound },
    { id: "settings", label: "设置", icon: Settings }
  ];
  return (
    <header className="stage-nav">
      <div className="brand">
        <div className="brand-mark">
          <Waves size={18} />
        </div>
        <div>
          <strong>Claudio</strong>
          <span>个人 AI 电台</span>
        </div>
      </div>
      <nav className="nav-list" aria-label="主导航">
        {items.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? "nav-item active" : "nav-item"}
            onClick={() => onSelectView(item.id)}
            title={item.label}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}

function StageShell({ activeView, onSelectView, children }) {
  return (
    <section className="radio-stage utility-stage">
      <div className="dot-matrix" />
      <StageNav activeView={activeView} onSelectView={onSelectView} />
      <div className="utility-content">{children}</div>
    </section>
  );
}

function PlayerView({
  now,
  messages,
  input,
  pending,
  isPlaying,
  playbackError,
  currentTime,
  duration,
  activeView,
  ncmAccount,
  onSelectView,
  setInput,
  sendMessage,
  previousTrack,
  togglePlayback,
  nextTrack,
  selectTrack,
  playRecommendation,
  seekToRatio,
  loadNcmSource,
  toggleNcmLike
}) {
  const current = now.current;
  const [queueOpen, setQueueOpen] = useState(false);
  const [sourcePending, setSourcePending] = useState("");
  const [actionError, setActionError] = useState("");
  const [currentLiked, setCurrentLiked] = useState(false);
  const lyricListRef = useRef(null);
  const activeLyricRef = useRef(null);
  const lyricLines = current?.lyric?.length ? current.lyric : [];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);
  const effectiveDuration = duration || current?.duration || 0;
  const canSeek = Boolean(current?.id && effectiveDuration > 0);
  const progress = canSeek ? Math.min(100, ((currentTime || 0) / effectiveDuration) * 100) : 0;
  const cover = coverUrl(current?.cover);
  const hostProfile = ncmAccount?.loggedIn ? ncmAccount.profile : null;
  const hostName = hostProfile?.nickname || "Claudio";
  const hostAvatar = hostProfile?.avatarUrl ? coverUrl(hostProfile.avatarUrl) : "";
  const sourceLabel = [
    current?.source || "local",
    current?.album && current.album !== current.title ? current.album : ""
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    const list = lyricListRef.current;
    const activeLine = activeLyricRef.current;
    if (!list || !activeLine) return;
    const nextTop = activeLine.offsetTop - list.clientHeight / 2 + activeLine.clientHeight / 2;
    list.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  }, [activeLyricIndex, current?.id]);

  useEffect(() => {
    let cancelled = false;
    setActionError("");
    setCurrentLiked(false);
    if (!current?.id || current.source !== "netease") return undefined;
    getJson(`/api/ncm/like/check?id=${encodeURIComponent(current.id)}`)
      .then((result) => {
        if (!cancelled) setCurrentLiked(Boolean(result.liked));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.source]);

  async function runNcmSource(source) {
    if (sourcePending) return;
    setSourcePending(source);
    setActionError("");
    try {
      await loadNcmSource(source);
      if (source !== "heartbeat") setQueueOpen(false);
    } catch (error) {
      setActionError(error.message || "网易云操作失败");
    } finally {
      setSourcePending("");
    }
  }

  async function toggleLike() {
    if (!current?.id || current.source !== "netease") return;
    const nextLiked = !currentLiked;
    setCurrentLiked(nextLiked);
    setActionError("");
    try {
      const result = await toggleNcmLike(current.id, nextLiked);
      setCurrentLiked(Boolean(result.liked));
    } catch (error) {
      setCurrentLiked(!nextLiked);
      setActionError(error.message || "喜欢状态更新失败");
    }
  }

  function seekFromPointer(event) {
    if (!canSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    seekToRatio(ratio);
  }

  return (
    <section className={["radio-stage", queueOpen ? "queue-is-open" : "", isPlaying ? "is-playing" : ""].filter(Boolean).join(" ")}>
      <div className="ambient-cover" style={{ backgroundImage: current?.cover ? `url("${cover}")` : undefined }} />
      <div className="dot-matrix" />
      <StageNav activeView={activeView} onSelectView={onSelectView} />

      <div className="radio-console">
          <div className="console-topline">
            <div className="console-identity">
              <div className="host-avatar">
              {hostAvatar ? <img src={hostAvatar} alt="" /> : <Waves size={18} />}
            </div>
            <div>
              <strong>{hostName}</strong>
              <span className={pending ? "live-dot speaking" : "live-dot"}>{pending ? "Speaking..." : "On air"}</span>
            </div>
          </div>
          <time>{formatClock(new Date())}</time>
        </div>

        <div className="glass-player">
          <div className="track-hero">
            <span className="eyebrow">Now Playing</span>
            <h2>{current?.title || "Monday Night Exhale"}</h2>
            <p>{current?.artist || "告诉 Claudio 你想听什么"}</p>
          </div>

          <div className="album-strip">
            <div className="album-art">
              {current?.cover ? <img src={cover} alt="" /> : <Disc3 size={52} />}
            </div>
            <div className="track-meta">
              <span>{sourceLabel}</span>
              <strong>{current?.title || "等待播放"}</strong>
            </div>
            <div className="transport-cluster" aria-label="播放控制">
              <button
                className={currentLiked ? "transport-lite like-button active" : "transport-lite like-button"}
                onClick={toggleLike}
                disabled={!current?.id || current.source !== "netease"}
                title={currentLiked ? "取消喜欢" : "喜欢当前歌曲"}
              >
                <Heart size={16} fill={currentLiked ? "currentColor" : "none"} />
              </button>
              <button
                className="mode-button heartbeat-button"
                onClick={() => runNcmSource("heartbeat")}
                disabled={!current?.id || current.source !== "netease" || Boolean(sourcePending)}
                title="心动模式"
              >
                <Sparkles size={15} />
                <span>心动</span>
              </button>
              <button className="transport-lite" onClick={previousTrack} title="上一首">
                <SkipBack size={16} />
              </button>
              <button className="transport-main" onClick={togglePlayback} title={isPlaying ? "暂停" : "播放"}>
                {isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button className="transport-lite" onClick={nextTrack} title="下一首">
                <SkipForward size={16} />
              </button>
              <button className="pill-button queue-toggle" onClick={() => setQueueOpen(true)} title="队列">
                <PanelRightOpen size={15} />
                <span>队列</span>
              </button>
            </div>
          </div>

          <div className={canSeek ? "progress-row can-seek" : "progress-row"}>
            <button
              className="progress-track"
              aria-label="播放进度"
              type="button"
              disabled={!canSeek}
              onClick={seekFromPointer}
            >
              <span style={{ width: `${progress}%` }} />
            </button>
            <span>{formatDuration(currentTime)} / {formatDuration(effectiveDuration)}</span>
          </div>
          {playbackError && <div className="playback-alert">{playbackError}</div>}
          {actionError && <div className="playback-alert">{actionError}</div>}

          <div className={lyricLines.length ? "lyric-glass" : "lyric-glass empty"}>
            <div className="lyric-list" ref={lyricListRef}>
              {lyricLines.map((line, index) => (
                <p
                  className={index === activeLyricIndex ? "lyric-line active" : "lyric-line"}
                  ref={index === activeLyricIndex ? activeLyricRef : null}
                  key={`${line.stamp || index}-${line.text}`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className={queueOpen ? "queue-drawer open" : "queue-drawer"} aria-hidden={!queueOpen}>
        <div className="section-heading">
          <ListMusic size={18} />
          <h2>播放队列</h2>
          <button className="drawer-close" onClick={() => setQueueOpen(false)} title="关闭队列">
            <X size={17} />
          </button>
        </div>
        <div className="queue-source-grid" aria-label="网易云来源">
          <button onClick={() => runNcmSource("liked")} disabled={Boolean(sourcePending)}>
            <Heart size={15} />
            <span>{sourcePending === "liked" ? "载入中" : "我喜欢"}</span>
          </button>
          <button onClick={() => runNcmSource("daily")} disabled={Boolean(sourcePending)}>
            <CalendarDays size={15} />
            <span>{sourcePending === "daily" ? "载入中" : "每日推荐"}</span>
          </button>
          <button onClick={() => runNcmSource("fm")} disabled={Boolean(sourcePending)}>
            <Radio size={15} />
            <span>{sourcePending === "fm" ? "载入中" : "私人 FM"}</span>
          </button>
        </div>
        <div className="queue-list">
          {(now.queue || []).length ? (
            now.queue.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                onPlay={(id) => {
                  selectTrack(id);
                  setQueueOpen(false);
                }}
              />
            ))
          ) : (
            <div className="empty-state">队列为空</div>
          )}
        </div>
      </aside>
      {queueOpen && <button className="drawer-scrim" onClick={() => setQueueOpen(false)} aria-label="关闭队列" />}

      <div className="chat-panel glass-card">
        <div className="message-list">
          <div className="message assistant dj-thread">
            <span className="message-label">
              <Sparkles size={15} />
              AI DJ
            </span>
            <p>{now.decision?.reply || now.decision?.say || "告诉 Claudio 你现在想进入什么状态。"}</p>
            <div className="decision-row glass-row">
              <span>{now.decision?.play?.mood || "未开始"}</span>
              <span>{now.decision?.play?.query || "等待搜索词"}</span>
            </div>
          </div>
          {messages.slice(-7).map((message, index) => (
            <MessageBubble
              key={`${message.role}-${index}`}
              message={message}
              onPlayRecommendation={playRecommendation}
            />
          ))}
        </div>
        <form className="chat-form" onSubmit={sendMessage}>
          <Search size={18} />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="比如：来点适合写代码的电子乐"
          />
          <button className="icon-button" disabled={pending} title="发送">
            <Send size={18} />
          </button>
        </form>
      </div>
    </section>
  );
}

function TrackRow({ track, onPlay }) {
  return (
    <button className="track-row" onClick={() => onPlay(track.id)} title={`播放 ${track.title}`}>
      <img src={coverUrl(track.cover)} alt="" />
      <div>
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>
      <small>{track.source}</small>
    </button>
  );
}

function MessageBubble({ message, onPlayRecommendation }) {
  const recommendations = Array.isArray(message.recommendations) ? message.recommendations : [];
  return (
    <div className={`message ${message.role}`}>
      <p>{message.content}</p>
      {recommendations.length > 0 && (
        <details className="recommendation-panel" open>
          <summary>
            <ListMusic size={14} />
            <span>推荐歌曲</span>
            <small>{recommendations.length}</small>
          </summary>
          <div className="recommendation-list">
            {recommendations.map((track) => (
              <button
                className="recommendation-row"
                key={`${track.id}-${track.recommendationQuery || ""}`}
                type="button"
                onClick={() => onPlayRecommendation(track)}
                title={`播放 ${track.title}`}
              >
                <img src={coverUrl(track.cover)} alt="" />
                <div>
                  <strong>{track.title}</strong>
                  <span>{track.artist || track.recommendationQuery || "Netease"}</span>
                  {track.recommendationReason && <small>{track.recommendationReason}</small>}
                </div>
                <Play size={15} />
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function buildFallbackLyric(now, messages) {
  const say = now.decision?.reply
    || now.decision?.say
    || messages.findLast?.((message) => message.role === "assistant")?.content;
  const lines = [
    say || "This is Claudio.",
    now.decision?.segue || "让播放从这里开始。"
  ];
  return lines.filter(Boolean).map((text, index) => ({
    stamp: `0:${String(index * 4).padStart(2, "0")}`,
    time: index * 4,
    text
  }));
}

function getActiveLyricIndex(lines, currentTime) {
  if (!Array.isArray(lines) || !lines.length) return 0;
  let activeIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index].time || 0) <= currentTime) activeIndex = index;
  }
  return activeIndex;
}

function formatDuration(value) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function audioSource(track) {
  if (!track) return "";
  if (track.streamUrl) return absoluteApiUrl(track.streamUrl);
  if (track.source === "netease" && track.id) return absoluteApiUrl(`/api/audio/${encodeURIComponent(track.id)}`);
  if (track.url) return track.url;
  return "";
}

function absoluteApiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function mediaErrorMessage(error) {
  if (!error) return "播放失败：音频没有加载成功。";
  const messages = {
    1: "播放失败：加载被中断。",
    2: "播放失败：网络错误，已无法读取音频。",
    3: "播放失败：音频解码失败。",
    4: "播放失败：当前歌曲地址不可播放。"
  };
  return messages[error.code] || "播放失败：音频没有加载成功。";
}

function ProfileView({ taste, plan, onSaved }) {
  const [form, setForm] = useState({});
  const [status, setStatus] = useState("");
  const profileRows = [
    ["taste.md", "用户语料", CircleUserRound],
    ["mood-rules.md", "情绪规则", Activity],
    ["routines.md", "作息节奏", CloudSun],
    ["playlists.json", "播放列表语料", ListMusic]
  ];

  useEffect(() => {
    setForm(taste || {});
  }, [taste]);

  async function saveProfile(event) {
    event.preventDefault();
    setStatus("保存中");
    try {
      const result = await postJson("/api/taste", { files: form });
      onSaved(result.files);
      setStatus("已保存");
      setTimeout(() => setStatus(""), 1800);
    } catch (error) {
      setStatus(error.message || "保存失败");
    }
  }

  return (
    <form className="profile-grid" onSubmit={saveProfile}>
      <div className="profile-actions">
        <div className="section-heading">
          <SlidersHorizontal size={18} />
          <h2>画像</h2>
        </div>
        <span>{status}</span>
        <button className="save-button" type="submit">保存画像</button>
      </div>
      {profileRows.map(([file, title, Icon]) => (
        <EditableProfilePanel
          key={file}
          icon={Icon}
          title={title}
          value={form[file] || ""}
          onChange={(value) => setForm((current) => ({ ...current, [file]: value }))}
        />
      ))}
      <div className="info-panel">
        <div className="section-heading">
          <CalendarDays size={18} />
          <h2>今日计划</h2>
        </div>
        <div className="plan-list">
          {plan.map((item) => (
            <div className="plan-row" key={item.id}>
              <span>{item.starts_at || "--:--"}</span>
              <strong>{item.title}</strong>
              <small>{item.source}</small>
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}

function EditableProfilePanel({ icon: Icon, title, value, onChange }) {
  return (
    <label className="info-panel editable-profile-panel">
      <div className="section-heading">
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </label>
  );
}

function InfoPanel({ icon: Icon, title, body }) {
  return (
    <div className="info-panel">
      <div className="section-heading">
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      <pre>{body}</pre>
    </div>
  );
}

function SettingsView({ settings, onSaved, onAccount }) {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [fontChoice, setFontChoice] = useState(window.localStorage.getItem("claudio_font_choice") || "apple-system");
  const [fontAvailability, setFontAvailability] = useState({});
  const [ncmLogin, setNcmLogin] = useState({
    status: "idle",
    message: "",
    key: "",
    qrimg: "",
    profile: null,
    loggedIn: false
  });
  const rows = [
    ["AI_PROVIDER", "AI Provider", "mock / claude_cli / anthropic / openai"],
    ["AI_TIMEOUT_MS", "AI Timeout", "60000"],
    ["ANTHROPIC_API_KEY", "Anthropic Key", "留空保持不变"],
    ["ANTHROPIC_AUTH_TOKEN", "Anthropic Auth Token", "兼容代理 token，留空保持不变"],
    ["ANTHROPIC_BASE_URL", "Anthropic Base URL", "https://api.anthropic.com"],
    ["OPENAI_API_KEY", "OpenAI Key", "留空保持不变"],
    ["OPENAI_BASE_URL", "OpenAI Base URL", "兼容接口地址"],
    ["FISH_AUDIO_API_KEY", "Fish Audio Key", "留空保持不变"],
    ["FISH_AUDIO_VOICE_ID", "Fish Voice ID", "可选"],
    ["NCM_API_BASE", "NCM API Base", "http://127.0.0.1:3300"],
    ["NCM_COOKIE", "NCM Cookie", "留空保持不变"],
    ["FEISHU_APP_ID", "Feishu App ID", "预留"],
    ["OPENWEATHER_API_KEY", "OpenWeather Key", "预留"],
    ["UPNP_TARGET_URL", "UPnP Target", "预留"]
  ];

  useEffect(() => {
    setFontAvailability(detectFontAvailability(FONT_OPTIONS));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/ncm/login/status")
      .then((result) => {
        if (cancelled) return;
        setNcmLogin((current) => ({
          ...current,
          loggedIn: result.loggedIn,
          profile: result.profile || null,
          status: current.status === "idle" && result.loggedIn ? "success" : current.status,
          message:
            current.message ||
            (result.loggedIn && result.profile?.nickname
              ? `已登录：${result.profile.nickname}`
              : settings.NCM_COOKIE?.configured
                ? "已保存网易云 Cookie"
                : "未登录网易云")
        }));
        onAccount?.({ loggedIn: result.loggedIn, profile: result.profile || null });
        if (result.settings) onSaved(result.settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings.NCM_COOKIE?.configured, onSaved]);

  useEffect(() => {
    if (!ncmLogin.key || !["waiting", "scanned"].includes(ncmLogin.status)) return undefined;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await getJson(`/api/ncm/login/check?key=${encodeURIComponent(ncmLogin.key)}`);
        if (cancelled) return;
        const nextStatus = ncmStatusFromCode(result.code);
        setNcmLogin((current) => ({
          ...current,
          status: nextStatus,
          message: result.message || current.message
        }));
        if (result.account) {
          onAccount?.({
            loggedIn: result.account.loggedIn,
            profile: result.account.profile || null
          });
        }
        if (result.settings) onSaved(result.settings);
      } catch (error) {
        if (cancelled) return;
        setNcmLogin((current) => ({
          ...current,
          status: "error",
          message: error.message || "网易云登录检查失败"
        }));
      }
    }, 2200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ncmLogin.key, ncmLogin.status, onSaved]);

  function valueFor(key) {
    if (key in form) return form[key];
    const item = settings[key];
    if (!item || item.secret) return "";
    return item.value || "";
  }

  async function startNcmLogin() {
    setNcmLogin((current) => ({
      ...current,
      status: "loading",
      message: "正在生成网易云二维码",
      key: "",
      qrimg: ""
    }));
    try {
      const result = await getJson("/api/ncm/login/qr");
      setNcmLogin((current) => ({
        ...current,
        status: "waiting",
        message: result.message || "打开网易云音乐 App 扫码登录",
        key: result.key,
        qrimg: result.qrimg
      }));
    } catch (error) {
      setNcmLogin((current) => ({
        ...current,
        status: "error",
        message: error.message || "二维码生成失败"
      }));
    }
  }

  async function save(event) {
    event.preventDefault();
    const result = await postJson("/api/settings", form);
    onSaved(result.settings);
    setForm({});
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function chooseFont(option) {
    applyFontChoice(option);
    setFontChoice(option.id);
  }

  return (
    <section className="settings-surface">
      <div className="settings-header">
        <div className="section-heading">
          <SlidersHorizontal size={18} />
          <h2>本地配置</h2>
        </div>
        <span>{saved ? "已保存" : "仅保存在本机"}</span>
      </div>
      <FontGallery
        options={FONT_OPTIONS}
        selected={fontChoice}
        availability={fontAvailability}
        onChoose={chooseFont}
      />
      <div className="ncm-login-panel">
        <div className="ncm-login-copy">
          <div className="section-heading compact">
            <QrCode size={18} />
            <h2>网易云扫码登录</h2>
          </div>
          <p>{ncmLogin.message || "扫码后会把 Cookie 只保存到本机服务端。"}</p>
          <span className={`ncm-login-pill ${ncmLogin.status}`}>
            {ncmLogin.profile?.nickname || ncmStatusLabel(ncmLogin.status, settings.NCM_COOKIE)}
          </span>
        </div>
        <button
          className="ncm-login-button"
          type="button"
          disabled={ncmLogin.status === "loading"}
          onClick={startNcmLogin}
        >
          {ncmLogin.status === "loading" ? <RefreshCw size={17} /> : <QrCode size={17} />}
          {ncmLogin.status === "loading" ? "生成中" : "生成二维码"}
        </button>
        {ncmLogin.qrimg && (
          <div className="ncm-qr-card">
            <img src={ncmLogin.qrimg} alt="网易云登录二维码" />
            <small>使用网易云音乐 App 扫码并在手机上确认</small>
          </div>
        )}
      </div>
      <form className="settings-form" onSubmit={save}>
        {rows.map(([key, label, placeholder]) => (
          <label className="setting-row" key={key}>
            <span>
              <KeyRound size={16} />
              {label}
            </span>
            <input
              type={settings[key]?.secret ? "password" : "text"}
              value={valueFor(key)}
              placeholder={
                settings[key]?.secret && settings[key]?.configured ? "已保存，留空不变" : placeholder
              }
              onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
        <button className="save-button">保存配置</button>
      </form>
    </section>
  );
}

function FontGallery({ options, selected, availability, onChoose }) {
  return (
    <section className="font-gallery">
      <div className="section-heading compact">
        <SlidersHorizontal size={18} />
        <h2>字体预览</h2>
      </div>
      <div className="font-grid">
        {options.map((option) => {
          const status = availability[option.id] || { available: [], checked: false };
          const active = selected === option.id;
          return (
            <button
              className={active ? "font-card active" : "font-card"}
              key={option.id}
              type="button"
              style={{ fontFamily: option.ui }}
              onClick={() => onChoose(option)}
            >
              <div className="font-card-top">
                <strong>{option.name}</strong>
                <span>{status.available.length ? "可用" : status.checked ? "回退" : "检测中"}</span>
              </div>
              <p className="font-sample-title" style={{ fontFamily: option.display }}>
                周末夜航
              </p>
              <p className="font-sample-copy">
                Claudio 正在为你挑一首适合夜晚的歌。Apple Music style, clean and soft.
              </p>
              <p className="font-sample-meta" style={{ fontFamily: option.mono }}>
                21:03 / ON AIR / 100
              </p>
              <small>{status.available.length ? status.available.join(" · ") : option.note}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function detectFontAvailability(options) {
  return Object.fromEntries(
    options.map((option) => [
      option.id,
      {
        checked: true,
        available: option.fonts.filter((font) => isFontInstalled(font))
      }
    ])
  );
}

function isFontInstalled(fontName) {
  const canvas = isFontInstalled.canvas || document.createElement("canvas");
  isFontInstalled.canvas = canvas;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const sample = "Claudio字体测试1234567890";
  const size = "72px";
  const baselines = ["monospace", "serif", "sans-serif"];
  return baselines.some((baseline) => {
    context.font = `${size} ${baseline}`;
    const baselineWidth = context.measureText(sample).width;
    context.font = `${size} "${fontName}", ${baseline}`;
    return Math.abs(context.measureText(sample).width - baselineWidth) > 0.5;
  });
}

function ncmStatusFromCode(code) {
  if (code === 800) return "expired";
  if (code === 802) return "scanned";
  if (code === 803) return "success";
  if (code === 801) return "waiting";
  return "waiting";
}

function ncmStatusLabel(status, cookieSetting) {
  if (status === "loading") return "生成中";
  if (status === "waiting") return "等待扫码";
  if (status === "scanned") return "等待手机确认";
  if (status === "success") return "已登录";
  if (status === "expired") return "已过期";
  if (status === "error") return "登录异常";
  if (cookieSetting?.configured) return "Cookie 已保存";
  return "未登录";
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${path} ${response.status}`);
  return data;
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${path} ${response.status}`);
  return data;
}

function coverUrl(url) {
  if (!url) return "/covers/cover-red.svg";
  if (url.startsWith("http")) return url;
  const clean = url.replace(/^\//, "");
  if (window.location.protocol === "file:") {
    return new URL(clean, window.location.href).href;
  }
  return new URL(clean, `${window.location.origin}/`).href;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(<App />);
