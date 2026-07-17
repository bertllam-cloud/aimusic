import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Airplay,
  AudioLines,
  CalendarDays,
  CircleUserRound,
  CloudSun,
  Heart,
  House,
  KeyRound,
  LayoutGrid,
  LibraryBig,
  ListMusic,
  Mic2,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  QrCode,
  RadioTower,
  RefreshCw,
  Search,
  Send,
  SkipBack,
  SkipForward,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Volume1,
  Volume2
} from "lucide-react";
import "./styles.css";

const API_BASE = window.localStorage.getItem("claudio_api_base") || "http://127.0.0.1:4217";
const WS_BASE = API_BASE.replace(/^http/, "ws");

const DEMO_TRACKS = [
  {
    id: "demo-1",
    title: "Night Drive Signal",
    artist: "Claudio Demo",
    album: "Local First",
    source: "demo",
    duration: 358,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    cover: "/covers/cover-red.svg"
  },
  {
    id: "demo-2",
    title: "Focus Current",
    artist: "Claudio Demo",
    album: "Work Session",
    source: "demo",
    duration: 302,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    cover: "/covers/cover-green.svg"
  },
  {
    id: "demo-3",
    title: "Soft Reset",
    artist: "Claudio Demo",
    album: "Evening Queue",
    source: "demo",
    duration: 344,
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    cover: "/covers/cover-blue.svg"
  }
];

const EDITORIAL_RECOMMENDATIONS = [
  { ...DEMO_TRACKS[1], duration: 214, reason: "Warm synths · steady pulse" },
  { ...DEMO_TRACKS[2], duration: 196, title: "Silhouette", artist: "Luma Falls", reason: "Soft vocals · spacious mix" },
  { ...DEMO_TRACKS[0], duration: 238, title: "Aperture", artist: "Northbound", reason: "Gentle lift · no sharp edges" }
];

const INITIAL_MESSAGES = [
  {
    id: "welcome",
    role: "assistant",
    content: "你好，我是你的 AI 电台助手。告诉我你此刻想要什么感觉，我会为你调整整座电台。"
  },
  {
    id: "prompt",
    role: "user",
    content: "为傍晚的设计工作放一些温暖、专注的音乐。"
  },
  {
    id: "answer",
    role: "assistant",
    content: "我为你安排了一组柔和的电子乐序列：节奏稳定，适合专注，也保留一点向上的动力。",
    recommendations: EDITORIAL_RECOMMENDATIONS
  }
];

const DEFAULT_PALETTE = [
  [186, 55, 75],
  [229, 116, 82],
  [92, 74, 132],
  [40, 52, 83],
  [224, 161, 134]
];

function App() {
  const [now, setNow] = useState({ current: DEMO_TRACKS[0], queue: DEMO_TRACKS.slice(1) });
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [isPlaying, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(DEMO_TRACKS[0].duration);
  const [volume, setVolume] = useState(0.72);
  const [activeTab, setActiveTab] = useState("radio");
  const [theme, setTheme] = useState(getInitialTheme);
  const [voiceActive, setVoiceActive] = useState(false);
  const [airplayActive, setAirplayActive] = useState(false);
  const [taste, setTaste] = useState({});
  const [plan, setPlan] = useState([]);
  const [settings, setSettings] = useState({});
  const [ncmAccount, setNcmAccount] = useState({ loggedIn: false, profile: null });
  const [sourcePending, setSourcePending] = useState("");
  const [sourceNotice, setSourceNotice] = useState("");
  const audioRef = useRef(null);

  const current = now.current || DEMO_TRACKS[0];
  const artwork = coverUrl(current.cover || DEMO_TRACKS[0].cover);
  const paletteState = useArtworkPalette(coverPaletteUrl(artwork));
  const artworkVars = useMemo(() => {
    const colors = paletteState.current || DEFAULT_PALETTE;
    return {
      "--c1": colors[0].join(" "),
      "--c2": (colors[1] || colors[0]).join(" "),
      "--c3": (colors[2] || colors[0]).join(" "),
      "--c4": (colors[3] || colors[0]).join(" "),
      "--c5": (colors[4] || colors[1] || colors[0]).join(" ")
    };
  }, [paletteState.current]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("claudio_theme_choice", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    getJson("/api/now")
      .then((payload) => {
        if (active && payload?.current) setNow(payload);
      })
      .catch(() => {});

    Promise.all([
      getJson("/api/taste").catch(() => null),
      getJson("/api/plan/today").catch(() => null),
      getJson("/api/settings").catch(() => null),
      getJson("/api/ncm/login/status").catch(() => null)
    ]).then(([tastePayload, planPayload, settingsPayload, accountPayload]) => {
      if (!active) return;
      if (tastePayload?.files) setTaste(tastePayload.files);
      if (planPayload?.items) setPlan(planPayload.items);
      if (settingsPayload?.settings) setSettings(settingsPayload.settings);
      if (accountPayload) {
        setNcmAccount({ loggedIn: Boolean(accountPayload.loggedIn), profile: accountPayload.profile || null });
        if (accountPayload.settings) setSettings(accountPayload.settings);
      }
    });

    let socket;
    try {
      socket = new WebSocket(`${WS_BASE}/stream`);
      socket.addEventListener("message", (event) => {
        if (!active) return;
        const payload = JSON.parse(event.data);
        if (payload.type === "now" && payload.payload?.current) setNow(payload.payload);
        if (payload.type === "chat" && payload.payload?.decision) {
          appendAssistant(payload.payload.decision.reply || payload.payload.decision.say, payload.payload.recommendations);
        }
      });
    } catch {
      socket = null;
    }

    return () => {
      active = false;
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const source = audioSource(current);
    if (!audio || !source) return;
    audio.src = source;
    audio.load();
    setCurrentTime(0);
    setDuration(current.duration || 0);
    if (isPlaying) audio.play().catch(() => setPlaying(false));
  }, [current.id, current.url, current.streamUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  function appendAssistant(content, recommendations = []) {
    const text = String(content || "").trim();
    if (!text) return;
    setMessages((items) => [
      ...items,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: text,
        recommendations: Array.isArray(recommendations) ? recommendations : []
      }
    ]);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setMessages((items) => [...items, { id: `user-${Date.now()}`, role: "user", content: text }]);
    setInput("");
    setPending(true);
    try {
      const result = await postJson("/api/chat", { message: text });
      if (result.now?.current) setNow(result.now);
      appendAssistant(
        result.decision?.reply || result.decision?.say || "我已经按你的描述调整好电台。",
        result.recommendations || []
      );
    } catch {
      await wait(420);
      appendAssistant(
        "我已把电台调整为温暖、细腻又舒展的律动，接下来的音乐会自然地延续这个氛围。",
        EDITORIAL_RECOMMENDATIONS
      );
    } finally {
      setPending(false);
    }
  }

  async function chooseTrack(direction) {
    const endpoint = direction > 0 ? "/api/next" : "/api/previous";
    try {
      const payload = await getJson(endpoint);
      if (payload?.current) setNow(payload);
    } catch {
      const list = [current, ...(now.queue || []), ...DEMO_TRACKS].filter(
        (track, index, items) => items.findIndex((item) => item.id === track.id) === index
      );
      const currentIndex = Math.max(0, list.findIndex((track) => track.id === current.id));
      const nextIndex = (currentIndex + direction + list.length) % list.length;
      const next = list[nextIndex];
      setNow({ current: next, queue: list.filter((track) => track.id !== next.id) });
    }
    setCurrentTime(0);
  }

  async function playRecommendation(track) {
    try {
      const payload = await postJson("/api/play", { track });
      if (payload?.current) setNow(payload);
      else setNow((state) => ({ ...state, current: track }));
    } catch {
      setNow((state) => ({ ...state, current: track }));
    }
    setPlaying(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadMusicSource(source) {
    if (sourcePending) return;
    setSourcePending(source);
    setSourceNotice("");
    try {
      const payload = await postJson(`/api/ncm/load/${source}`, {});
      if (payload?.now?.current) setNow(payload.now);
      setPlaying(true);
      setSourceNotice(source === "liked" ? "已载入你喜欢的歌曲。" : "电台已更新。");
      setActiveTab("radio");
    } catch {
      const fallbackIndex = source === "daily" ? 1 : source === "fm" ? 2 : 0;
      const fallback = DEMO_TRACKS[fallbackIndex];
      setNow({ current: fallback, queue: DEMO_TRACKS.filter((track) => track.id !== fallback.id) });
      setSourceNotice("已载入预览音乐源。请在“搜索”中连接网易云账号以使用你的个人音乐。");
      setActiveTab("radio");
    } finally {
      setSourcePending("");
    }
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(value) {
    const next = Number(value);
    if (audioRef.current && Number.isFinite(next)) audioRef.current.currentTime = next;
    setCurrentTime(next);
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceActive((value) => !value);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.onstart = () => setVoiceActive(true);
    recognition.onend = () => setVoiceActive(false);
    recognition.onerror = () => setVoiceActive(false);
    recognition.onresult = (event) => setInput(event.results?.[0]?.[0]?.transcript || "");
    recognition.start();
  }

  return (
    <div className="app-shell" style={artworkVars}>
      <DynamicBackdrop
        artwork={artwork}
        currentPalette={paletteState.current}
        previousPalette={paletteState.previous}
      />

      <main className={activeTab === "radio" ? "radio-page" : "radio-page utility-page"}>
        <StatusBar />

        {activeTab === "radio" && <>
        <section className="liquid-card player-card" aria-label="正在播放">
          <header className="card-brand-row">
            <div className="music-wordmark"><Music2 size={19} strokeWidth={2.4} /> <span>音乐</span></div>
            <div className="card-actions">
              <button
                className="quiet-button"
                type="button"
                aria-label={`切换为${theme === "dark" ? "浅色" : "深色"}外观`}
                onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button className="quiet-button" type="button" aria-label="更多选项"><MoreHorizontal size={20} /></button>
            </div>
          </header>

          <div className="player-layout">
            <div className="artwork-shell">
              <img className="album-artwork" src={artwork} alt={`${current.title} 专辑封面`} />
            </div>

            <div className="track-and-controls">
              <div className="track-copy">
                <span className="eyebrow">AI 电台</span>
                <h1>{current.title}</h1>
                <p>{current.artist}</p>
                <span className="album-name">{current.album || "私人电台"}</span>
              </div>

              <div className="transport" aria-label="播放控制">
                <button type="button" aria-label="上一首" onClick={() => chooseTrack(-1)}><SkipBack size={26} fill="currentColor" /></button>
                <button className="play-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlayback}>
                  {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
                </button>
                <button type="button" aria-label="下一首" onClick={() => chooseTrack(1)}><SkipForward size={26} fill="currentColor" /></button>
              </div>
            </div>
          </div>

          <div className="playback-details">
            <input
              className="timeline"
              type="range"
              aria-label="歌曲进度"
              min="0"
              max={Math.max(1, duration || current.duration || 1)}
              step="0.1"
              value={Math.min(currentTime, duration || current.duration || 1)}
              onChange={(event) => seek(event.target.value)}
              style={{ "--range-progress": `${Math.min(100, (currentTime / Math.max(1, duration || current.duration || 1)) * 100)}%` }}
            />
            <div className="time-labels"><span>{formatDuration(currentTime)}</span><span>-{formatDuration(Math.max(0, (duration || current.duration || 0) - currentTime))}</span></div>

            <div className="volume-row">
              <Volume1 size={16} aria-hidden="true" />
              <input
                type="range"
                aria-label="音量"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                style={{ "--range-progress": `${volume * 100}%` }}
              />
              <Volume2 size={17} aria-hidden="true" />
              <button
                className={airplayActive ? "airplay-button active" : "airplay-button"}
                type="button"
                aria-label="隔空播放"
                onClick={() => setAirplayActive((value) => !value)}
              ><Airplay size={20} /></button>
            </div>
          </div>
        </section>

        <section className="liquid-card ai-card" aria-labelledby="assistant-title">
          <header className="assistant-heading">
            <div className="assistant-mark"><Sparkles size={20} /></div>
            <div>
              <h2 id="assistant-title">AI 电台助手</h2>
              <p>由 Apple 智能驱动</p>
            </div>
            <span className="live-pill">直播</span>
          </header>

          <div className="conversation" aria-live="polite">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} onPlay={playRecommendation} />
            ))}
            {pending && (
              <div className="message-row assistant-row">
                <AssistantAvatar />
                <div className="message-bubble assistant-bubble typing-bubble" aria-label="AI 正在回复"><i /><i /><i /></div>
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={sendMessage}>
            <button
              className={voiceActive ? "voice-button active" : "voice-button"}
              type="button"
              aria-label="语音输入"
              onClick={startVoiceInput}
            >
              {voiceActive ? <AudioLines size={21} /> : <Mic2 size={20} />}
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="问问 AI 音乐…"
              aria-label="向 AI 询问音乐"
            />
            <div className="input-wave" aria-hidden="true"><span /><span /><span /><span /></div>
            <button className="send-button" type="submit" disabled={!input.trim() || pending} aria-label="发送消息"><Send size={19} /></button>
          </form>
        </section>
        </>}

        {activeTab === "listen" && (
          <ListenNowView
            current={current}
            queue={now.queue || []}
            onOpenRadio={() => setActiveTab("radio")}
            onPlay={playRecommendation}
          />
        )}
        {activeTab === "browse" && (
          <BrowseView
            current={current}
            queue={now.queue || []}
            pendingSource={sourcePending}
            notice={sourceNotice}
            onLoadSource={loadMusicSource}
            onPlay={playRecommendation}
          />
        )}
        {activeTab === "library" && (
          <LibraryView taste={taste} plan={plan} onSaved={setTaste} />
        )}
        {activeTab === "search" && (
          <SettingsView
            settings={settings}
            account={ncmAccount}
            theme={theme}
            onThemeChange={setTheme}
            onSaved={setSettings}
            onAccount={setNcmAccount}
          />
        )}
      </main>

      <TabBar active={activeTab} onChange={setActiveTab} />

      <audio
        ref={audioRef}
        onEnded={() => chooseTrack(1)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || current.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
      />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <strong>9:41</strong>
      <div className="status-icons">
        <span className="signal-bars"><i /><i /><i /><i /></span>
        <span className="wifi-mark">⌁</span>
        <span className="battery-mark"><i /></span>
      </div>
    </div>
  );
}

function UtilityHeader({ icon: Icon, eyebrow, title, subtitle, action }) {
  return (
    <header className="utility-header">
      <div className="utility-title-mark"><Icon size={21} /></div>
      <div>
        <span className="utility-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function ListenNowView({ current, queue, onOpenRadio, onPlay }) {
  const picks = [current, ...queue].filter(Boolean).slice(0, 3);
  return (
    <section className="utility-screen listen-now-screen" aria-label="现在就听">
      <UtilityHeader
        icon={House}
        eyebrow="现在就听"
        title="为此刻而选"
        subtitle="一座随你当下状态变化的私人电台。"
      />
      <article className="liquid-card listen-feature">
        <img src={coverUrl(current.cover)} alt="" />
        <div className="listen-feature-copy">
          <span className="eyebrow">正在播出</span>
          <h2>{current.title}</h2>
          <p>{current.artist} · {current.album || "私人电台"}</p>
          <button className="utility-primary-button" type="button" onClick={onOpenRadio}>
            <RadioTower size={18} /> 打开 AI 电台
          </button>
        </div>
      </article>
      <section className="liquid-card utility-card compact-card" aria-label="最近选择">
        <div className="utility-card-heading"><h2>最近选择</h2><span>来自你的电台</span></div>
        <div className="mini-track-grid">
          {picks.map((track) => <MiniTrack key={track.id} track={track} onPlay={onPlay} />)}
        </div>
      </section>
    </section>
  );
}

function BrowseView({ current, queue, pendingSource, notice, onLoadSource, onPlay }) {
  const sources = [
    { id: "liked", label: "我喜欢", copy: "从你喜欢的歌曲开始。", Icon: Heart },
    { id: "daily", label: "每日推荐", copy: "今天的新鲜推荐。", Icon: Sparkles },
    { id: "fm", label: "私人 FM", copy: "让电台持续向前。", Icon: RadioTower }
  ];
  const tracks = [current, ...queue].filter(Boolean).slice(0, 8);
  return (
    <section className="utility-screen" aria-label="浏览">
      <UtilityHeader
        icon={LayoutGrid}
        eyebrow="浏览"
        title="延展你的电台"
        subtitle="播放队列、喜欢的歌曲和下一段音乐方向。"
      />
      <div className="source-grid">
        {sources.map(({ id, label, copy, Icon }) => (
          <button
            className="liquid-card source-card"
            key={id}
            type="button"
            onClick={() => onLoadSource(id)}
            disabled={Boolean(pendingSource)}
          >
            <span className="source-icon"><Icon size={20} /></span>
            <strong>{pendingSource === id ? "载入中…" : label}</strong>
            <small>{copy}</small>
          </button>
        ))}
      </div>
      <section className="liquid-card utility-card queue-card" aria-label="即将播放">
        <div className="utility-card-heading"><h2>即将播放</h2><span>{tracks.length} 首歌曲</span></div>
        {notice && <p className="utility-notice">{notice}</p>}
        <div className="queue-list-modern">
          {tracks.map((track) => <QueueTrack key={track.id} track={track} onPlay={onPlay} />)}
        </div>
      </section>
    </section>
  );
}

function LibraryView({ taste, plan, onSaved }) {
  const [form, setForm] = useState(taste || {});
  const [status, setStatus] = useState("");
  const profileRows = [
    ["taste.md", "口味画像", "你反复回到的声音、节奏与质感。", CircleUserRound],
    ["mood-rules.md", "情绪规则", "电台应如何回应你此刻的状态。", Activity],
    ["routines.md", "每日节奏", "按时间变化的音乐提示。", CloudSun],
    ["playlists.json", "歌单上下文", "电台可以使用的结构化音乐来源。", ListMusic]
  ];

  useEffect(() => setForm(taste || {}), [taste]);

  async function saveProfile(event) {
    event.preventDefault();
    setStatus("正在保存…");
    try {
      const result = await postJson("/api/taste", { files: form });
      onSaved(result.files || form);
      setStatus("已保存");
    } catch (error) {
      setStatus(error.message || "无法保存画像");
    }
  }

  return (
    <form className="utility-screen library-screen" onSubmit={saveProfile} aria-label="资料库">
      <UtilityHeader
        icon={LibraryBig}
        eyebrow="资料库"
        title="你的聆听记忆"
        subtitle="这些私密笔记会成为 AI 电台的长期口味。"
        action={<button className="utility-primary-button utility-save-button" type="submit">保存</button>}
      />
      {status && <p className="utility-status">{status}</p>}
      <div className="profile-editor-grid">
        {profileRows.map(([file, title, description, Icon]) => (
          <label className="liquid-card profile-editor" key={file}>
            <span className="profile-editor-heading"><span className="source-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{description}</small></span></span>
            <textarea
              value={form[file] || ""}
              onChange={(event) => setForm((current) => ({ ...current, [file]: event.target.value }))}
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <section className="liquid-card utility-card plan-card">
        <div className="utility-card-heading"><h2>今日节奏</h2><span>本地计划</span></div>
        <div className="plan-list-modern">
          {plan.length ? plan.map((item) => (
            <div className="plan-item" key={item.id}>
              <time>{item.starts_at || "--:--"}</time>
              <span>{item.title}</span>
              <small>{item.source}</small>
            </div>
          )) : <p className="empty-copy">本地服务可用后，你的计划会显示在这里。</p>}
        </div>
      </section>
    </form>
  );
}

function SettingsView({ settings, account, theme, onThemeChange, onSaved, onAccount }) {
  const [form, setForm] = useState({});
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState("");
  const [login, setLogin] = useState({ status: "idle", message: "", key: "", qrimg: "" });
  const configRows = [
    ["AI_PROVIDER", "AI 服务", "mock / claude_cli / anthropic / openai"],
    ["AI_TIMEOUT_MS", "AI 超时", "60000"],
    ["ANTHROPIC_BASE_URL", "Anthropic 地址", "https://api.anthropic.com"],
    ["OPENAI_BASE_URL", "OpenAI 地址", "兼容 API 地址"],
    ["NCM_API_BASE", "网易云 API 地址", "http://127.0.0.1:3300"],
    ["NCM_COOKIE", "网易云 Cookie", "留空即可保留已保存的值"],
    ["OPENAI_API_KEY", "OpenAI 密钥", "留空即可保留已保存的值"],
    ["ANTHROPIC_API_KEY", "Anthropic 密钥", "留空即可保留已保存的值"],
    ["FISH_AUDIO_API_KEY", "Fish Audio 密钥", "留空即可保留已保存的值"]
  ];
  const filteredRows = configRows.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!login.key || !["waiting", "scanned"].includes(login.status)) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const result = await getJson(`/api/ncm/login/check?key=${encodeURIComponent(login.key)}`);
        const status = ncmStatus(result.code);
        setLogin((current) => ({ ...current, status, message: result.message || current.message }));
        if (result.account) onAccount({ loggedIn: Boolean(result.account.loggedIn), profile: result.account.profile || null });
        if (result.settings) onSaved(result.settings);
      } catch (error) {
        setLogin((current) => ({ ...current, status: "error", message: error.message || "登录状态检查失败" }));
      }
    }, 2200);
    return () => window.clearInterval(interval);
  }, [login.key, login.status, onAccount, onSaved]);

  function valueFor(key) {
    if (key in form) return form[key];
    const setting = settings[key];
    return setting?.secret ? "" : setting?.value || "";
  }

  async function startLogin() {
    setLogin({ status: "loading", message: "正在生成网易云登录二维码…", key: "", qrimg: "" });
    try {
      const result = await getJson("/api/ncm/login/qr");
      setLogin({ status: "waiting", message: result.message || "请使用网易云音乐扫码", key: result.key, qrimg: result.qrimg });
    } catch (error) {
      setLogin({ status: "error", message: error.message || "无法生成二维码", key: "", qrimg: "" });
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSaved("正在保存…");
    try {
      const result = await postJson("/api/settings", form);
      onSaved(result.settings || settings);
      setForm({});
      setSaved("已保存");
    } catch (error) {
      setSaved(error.message || "无法保存设置");
    }
  }

  return (
    <form className="utility-screen settings-screen" onSubmit={saveSettings} aria-label="搜索与设置">
      <UtilityHeader
        icon={Search}
        eyebrow="搜索与设置"
        title="控制你的电台"
        subtitle="连接、本机偏好和账号访问。"
      />
      <label className="liquid-card settings-search">
        <Search size={19} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置" />
      </label>
      <section className="liquid-card utility-card appearance-card">
        <div className="utility-card-heading"><h2>外观</h2><span>本设备</span></div>
        <div className="appearance-switch" role="group" aria-label="外观">
          <button className={theme === "light" ? "active" : ""} type="button" onClick={() => onThemeChange("light")}><Sun size={17} /> 浅色</button>
          <button className={theme === "dark" ? "active" : ""} type="button" onClick={() => onThemeChange("dark")}><Moon size={17} /> 深色</button>
        </div>
      </section>
      <section className="liquid-card utility-card account-card">
        <div className="account-heading">
          <span className="source-icon"><QrCode size={20} /></span>
          <div><h2>网易云音乐</h2><p>{account.loggedIn ? account.profile?.nickname || "已连接" : login.message || "连接账号后即可使用喜欢歌曲和私人 FM。"}</p></div>
          <span className={account.loggedIn ? "connection-pill connected" : "connection-pill"}>{account.loggedIn ? "已连接" : login.status === "waiting" ? "等待中" : "本机"}</span>
        </div>
        <button className="utility-secondary-button" type="button" disabled={login.status === "loading"} onClick={startLogin}>
          {login.status === "loading" ? <RefreshCw className="spin" size={17} /> : <QrCode size={17} />}
          {login.status === "loading" ? "生成中…" : account.loggedIn ? "刷新登录" : "显示二维码"}
        </button>
        {login.qrimg && <div className="qr-panel"><img src={login.qrimg} alt="网易云登录二维码" /><small>请使用网易云音乐 App 扫码，并在手机上确认。</small></div>}
      </section>
      <section className="liquid-card utility-card config-card">
        <div className="utility-card-heading"><h2>本地配置</h2><span>{saved || "仅保存在本机"}</span></div>
        <div className="config-list">
          {filteredRows.map(([key, label, placeholder]) => (
            <label className="config-row" key={key}>
              <span><KeyRound size={15} />{label}</span>
              <input
                type={settings[key]?.secret ? "password" : "text"}
                value={valueFor(key)}
                placeholder={settings[key]?.secret && settings[key]?.configured ? "已保存，留空不变" : placeholder}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <button className="utility-primary-button utility-save-button" type="submit"><SlidersHorizontal size={17} /> 保存配置</button>
      </section>
    </form>
  );
}

function MiniTrack({ track, onPlay }) {
  return (
    <button className="mini-track" type="button" onClick={() => onPlay(track)}>
      <img src={coverUrl(track.cover)} alt="" />
      <span><strong>{track.title}</strong><small>{track.artist}</small></span>
      <Play size={16} fill="currentColor" />
    </button>
  );
}

function QueueTrack({ track, onPlay }) {
  return (
    <button className="queue-track-modern" type="button" onClick={() => onPlay(track)}>
      <img src={coverUrl(track.cover)} alt="" />
      <span><strong>{track.title}</strong><small>{track.artist}</small></span>
      <time>{formatDuration(track.duration)}</time>
      <Play size={17} fill="currentColor" />
    </button>
  );
}

function ncmStatus(code) {
  if (code === 803) return "success";
  if (code === 802) return "scanned";
  if (code === 800) return "expired";
  return "waiting";
}

function MessageBubble({ message, onPlay }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className={isAssistant ? "message-row assistant-row" : "message-row user-row"}>
      {isAssistant && <AssistantAvatar />}
      <div className={isAssistant ? "message-bubble assistant-bubble" : "message-bubble user-bubble"}>
        <p>{message.content}</p>
        {message.recommendations?.length > 0 && (
          <div className="recommendation-stack">
            {message.recommendations.slice(0, 3).map((track, index) => (
              <RecommendationCard key={`${track.id}-${index}`} track={track} onPlay={onPlay} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return <div className="assistant-avatar" aria-hidden="true"><AudioLines size={21} /></div>;
}

function RecommendationCard({ track, onPlay }) {
  return (
    <article className="recommendation-card">
      <img src={coverUrl(track.cover)} alt="" />
      <div className="recommendation-copy">
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
        <small>{formatDuration(track.duration)}</small>
      </div>
      <span className="apple-music-badge" aria-label="Apple Music"><Music2 size={13} /></span>
      <button type="button" aria-label={`播放 ${track.title}`} onClick={() => onPlay(track)}><Play size={17} fill="currentColor" /></button>
    </article>
  );
}

function TabBar({ active, onChange }) {
  const tabs = [
    { id: "listen", label: "现在就听", Icon: House },
    { id: "browse", label: "浏览", Icon: LayoutGrid },
    { id: "radio", label: "电台", Icon: RadioTower },
    { id: "library", label: "资料库", Icon: LibraryBig },
    { id: "search", label: "搜索", Icon: Search }
  ];
  return (
    <nav className="liquid-card tab-bar" aria-label="Apple Music 导航">
      {tabs.map(({ id, label, Icon }) => (
        <button key={id} className={active === id ? "active" : ""} type="button" onClick={() => onChange(id)}>
          <Icon size={22} fill={id === "listen" && active === id ? "currentColor" : "none"} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function DynamicBackdrop({ artwork, currentPalette, previousPalette }) {
  return (
    <div className="dynamic-backdrop" aria-hidden="true">
      {previousPalette && <PaletteLayer artwork={artwork} palette={previousPalette} phase="leaving" />}
      <PaletteLayer artwork={artwork} palette={currentPalette || DEFAULT_PALETTE} phase="current" />
      <div className="background-vignette" />
      <NoiseCanvas />
    </div>
  );
}

function PaletteLayer({ artwork, palette, phase }) {
  const colors = palette?.length ? palette : DEFAULT_PALETTE;
  const style = {
    "--c1": colors[0].join(" "),
    "--c2": (colors[1] || colors[0]).join(" "),
    "--c3": (colors[2] || colors[0]).join(" "),
    "--c4": (colors[3] || colors[0]).join(" "),
    "--c5": (colors[4] || colors[1] || colors[0]).join(" ")
  };
  return (
    <div className={`palette-layer ${phase}`} style={style}>
      <div className="blurred-artwork" style={{ backgroundImage: `url("${artwork}")` }} />
      <div className="color-diffusion diffusion-one" />
      <div className="color-diffusion diffusion-two" />
    </div>
  );
}

function NoiseCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 180;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 112 + Math.floor(Math.random() * 32);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = Math.floor(14 + Math.random() * 20);
    }
    context.putImageData(image, 0, 0);
  }, []);
  return <canvas className="noise-layer" ref={ref} />;
}

function useArtworkPalette(source) {
  const [state, setState] = useState({ current: DEFAULT_PALETTE, previous: null });

  useEffect(() => {
    let cancelled = false;
    let cleanupTimer;
    if (!source) return undefined;

    extractDominantColors(source)
      .then((palette) => {
        if (cancelled || !palette?.length) return;
        setState((old) => ({ current: palette, previous: old.current }));
        cleanupTimer = window.setTimeout(() => {
          if (!cancelled) setState((old) => ({ ...old, previous: null }));
        }, 1600);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.clearTimeout(cleanupTimer);
    };
  }, [source]);

  return state;
}

async function extractDominantColors(source) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, 64, 64);
  const data = context.getImageData(0, 0, 64, 64).data;
  const buckets = new Map();

  for (let index = 0; index < data.length; index += 16) {
    if (data[index + 3] < 220) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const chroma = max - min;
    const lightness = (max + min) / 2;
    if (lightness < 18 || lightness > 244) continue;
    const quantized = [red >> 4, green >> 4, blue >> 4];
    const key = quantized.join("-");
    const weight = 1 + chroma / 48;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += weight;
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map((bucket) => [bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count].map(Math.round));
  const palette = [];
  for (const color of ranked) {
    if (palette.every((chosen) => colorDistance(chosen, color) > 54)) palette.push(color);
    if (palette.length === 5) break;
  }
  while (palette.length < 5) {
    const base = palette[palette.length % Math.max(1, palette.length)] || DEFAULT_PALETTE[palette.length];
    palette.push(mixColor(base, palette.length % 2 ? [245, 232, 225] : [48, 54, 78], palette.length % 2 ? 0.34 : 0.28));
  }
  return palette;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function mixColor(source, target, amount) {
  return source.map((value, index) => Math.round(value * (1 - amount) + target[index] * amount));
}

function getInitialTheme() {
  const stored = window.localStorage.getItem("claudio_theme_choice");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function audioSource(track) {
  if (track?.streamUrl) return absoluteApiUrl(track.streamUrl);
  return track?.url || "";
}

function absoluteApiUrl(path) {
  if (!path || /^https?:/i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function coverUrl(url) {
  if (!url) return "/covers/cover-red.svg";
  if (/^https?:/i.test(url)) return url;
  const clean = url.replace(/^\//, "");
  if (window.location.protocol === "file:") return new URL(clean, window.location.href).href;
  return new URL(clean, `${window.location.origin}/`).href;
}

function coverPaletteUrl(url) {
  if (!url) return "";
  try {
    const target = new URL(url, window.location.href);
    if (/music\.126\.net$/i.test(target.hostname)) return `${API_BASE}/api/cover?url=${encodeURIComponent(target.href)}`;
  } catch {
    return url;
  }
  return url;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")).render(<App />);
