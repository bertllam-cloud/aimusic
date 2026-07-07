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

export function createMusicAdapter(runtime) {
  async function search(query) {
    const ncmBase = runtime.get("NCM_API_BASE");
    if (ncmBase) {
      const attempts = buildNeteaseQueries(query);
      const errors = [];
      const collected = [];
      const seenIds = new Set();
      try {
        for (const attempt of attempts) {
          const tracks = await searchNeteaseApi(ncmBase, runtime.get("NCM_COOKIE"), attempt);
          for (const track of tracks) {
            if (seenIds.has(track.id)) continue;
            seenIds.add(track.id);
            collected.push({
              ...track,
              query,
              ncmQuery: attempt
            });
          }
        }
        if (collected.length) return rankTracks(collected).slice(0, 6);
      } catch (error) {
        errors.push(error.message);
      }
      const detail = errors.length
        ? `Netease API failed: ${errors.join("; ")}`
        : `Netease returned no playable tracks for: ${attempts.join(" / ")}`;
      return withFallbackReason(query, detail);
    }
    return withFallbackReason(query, "NCM_API_BASE is empty; using playable demo tracks");
  }

  async function playbackUrl(id) {
    const ncmBase = runtime.get("NCM_API_BASE");
    if (!ncmBase) throw new Error("NCM_API_BASE is empty");
    return getNeteasePlaybackUrl(ncmBase, runtime.get("NCM_COOKIE"), id);
  }

  async function tracksByIds(ids, limit = 20) {
    const ncmBase = runtime.get("NCM_API_BASE");
    if (!ncmBase) throw new Error("NCM_API_BASE is empty");
    return getNeteaseTracksByIds(ncmBase, runtime.get("NCM_COOKIE"), ids, limit);
  }

  async function tracksFromSongs(songs, limit = 20) {
    const ncmBase = runtime.get("NCM_API_BASE");
    if (!ncmBase) throw new Error("NCM_API_BASE is empty");
    return getNeteaseTracksFromSongs(ncmBase, runtime.get("NCM_COOKIE"), songs, limit);
  }

  return { search, playbackUrl, tracksByIds, tracksFromSongs };
}

async function getNeteasePlaybackUrl(baseUrl, cookie, id) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const response = await fetch(
    `${base}/song/url/v1?id=${encodeURIComponent(id)}&level=standard`,
    { headers }
  );
  if (!response.ok) throw new Error(`Netease url ${response.status}`);
  const data = await response.json();
  const item = (data.data || []).find((entry) => String(entry.id) === String(id)) || data.data?.[0];
  if (!item?.url) throw new Error(`Netease returned no playable url for ${id}`);
  return item.url;
}

async function searchNeteaseApi(baseUrl, cookie, query) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const searchUrl = `${base}/search?keywords=${encodeURIComponent(query)}&limit=8&type=1`;
  const searchResponse = await fetch(searchUrl, { headers });
  if (!searchResponse.ok) throw new Error(`Netease search ${searchResponse.status}`);
  const searchData = await searchResponse.json();
  const songs = searchData.result?.songs || [];
  const ids = songs.map((song) => song.id).filter(Boolean);
  if (!ids.length) return [];

  const urlResponse = await fetch(
    `${base}/song/url/v1?id=${ids.join(",")}&level=standard`,
    { headers }
  );
  const urlData = urlResponse.ok ? await urlResponse.json() : { data: [] };
  const urls = new Map((urlData.data || []).map((item) => [String(item.id), item.url]));
  const details = await getSongDetails(base, headers, ids);

  const playable = songs
    .slice(0, 8)
    .map((song, index) => ({
      ...toTrack(song, details.get(String(song.id)), urls, index)
    }))
    .filter((track) => Boolean(track.url))
    .slice(0, 6);

  return Promise.all(playable.map((track) => attachLyric(base, headers, track)));
}

async function getNeteaseTracksByIds(baseUrl, cookie, ids, limit = 20) {
  const cleanIds = uniqueIds(ids).slice(0, Math.max(1, limit));
  if (!cleanIds.length) return [];
  const base = baseUrl.replace(/\/$/, "");
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const details = await getSongDetails(base, headers, cleanIds);
  const detailSongs = cleanIds
    .map((id) => details.get(String(id)))
    .filter(Boolean);
  return getNeteaseTracksFromSongs(baseUrl, cookie, detailSongs, limit);
}

async function getNeteaseTracksFromSongs(baseUrl, cookie, songs, limit = 20) {
  const cleanSongs = Array.isArray(songs) ? songs.filter((song) => song?.id) : [];
  if (!cleanSongs.length) return [];
  const base = baseUrl.replace(/\/$/, "");
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const ids = uniqueIds(cleanSongs.map((song) => song.id)).slice(0, Math.max(1, limit * 2));

  const urlResponse = await fetch(
    `${base}/song/url/v1?id=${ids.join(",")}&level=standard`,
    { headers }
  );
  const urlData = urlResponse.ok ? await urlResponse.json() : { data: [] };
  const urls = new Map((urlData.data || []).map((item) => [String(item.id), item.url]));
  const details = await getSongDetails(base, headers, ids);

  const playable = cleanSongs
    .slice(0, limit * 2)
    .map((song, index) => toTrack(song, details.get(String(song.id)) || song, urls, index))
    .filter((track) => Boolean(track.url))
    .slice(0, limit);

  return Promise.all(playable.map((track) => attachLyric(base, headers, track)));
}

function toTrack(song, detail, urls, index) {
  const album = detail?.al || song.album || {};
  const artists = detail?.ar || song.artists || [];
  return {
      id: String(song.id),
      title: detail?.name || song.name || "Untitled",
      artist: artists.map((artist) => artist.name).join(" / ") || "Netease",
      album: album.name || "NeteaseCloudMusicApi",
      source: "netease",
      duration: Math.round((song.duration || song.dt || 0) / 1000),
      url: urls.get(String(song.id)) || "",
      streamUrl: `/api/audio/${encodeURIComponent(song.id)}`,
      cover: album.picUrl || album.pic_str || song.album?.picUrl || DEMO_TRACKS[index % DEMO_TRACKS.length].cover
  };
}

async function getSongDetails(base, headers, ids) {
  try {
    const response = await fetch(`${base}/song/detail?ids=${ids.join(",")}`, { headers });
    if (!response.ok) return new Map();
    const data = await response.json();
    return new Map((data.songs || []).map((song) => [String(song.id), song]));
  } catch {
    return new Map();
  }
}

async function attachLyric(base, headers, track) {
  try {
    const response = await fetch(`${base}/lyric?id=${encodeURIComponent(track.id)}`, { headers });
    if (!response.ok) return track;
    const data = await response.json();
    const rawLyric = data.lrc?.lyric || data.yrc?.lyric || "";
    const lyric = parseLyric(rawLyric);
    return {
      ...track,
      lyric,
      lyricText: lyric.map((line) => line.text).join("\n")
    };
  } catch {
    return track;
  }
}

function parseLyric(rawLyric) {
  return String(rawLyric || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
      if (!match) return null;
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const ms = Number((match[3] || "0").padEnd(3, "0"));
      const text = match[4].trim();
      if (!text) return null;
      return {
        time: minutes * 60 + seconds + ms / 1000,
        stamp: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
        text
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

function buildNeteaseQueries(query) {
  const raw = String(query || "").trim();
  const candidates = [];
  const push = (value) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };

  push(raw);
  push(
    raw
      .replace(/适合.*$/g, "")
      .replace(/想听|播放|来点|搜索|找|音乐|歌曲|的歌|一点|一些/g, " ")
  );

  const tokens = raw
    .split(/[，,。！？!?\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (!/适合|夜晚|晚上|工作|学习|放松|专注|的歌|音乐/.test(token)) {
      push(token);
    }
  }

  return candidates.length ? candidates.slice(0, 4) : ["周杰伦"];
}

function withFallbackReason(query, reason) {
  return DEMO_TRACKS.map((track, index) => ({
    ...track,
    id: `${track.id}-${Date.now()}-${index}`,
    source: "demo",
    reason,
    query
  }));
}

function rankTracks(tracks) {
  return [...tracks].sort((a, b) => scoreTrack(b) - scoreTrack(a));
}

function scoreTrack(track) {
  let score = 0;
  if (track.lyric?.length) score += 6;
  if (track.cover && !track.cover.startsWith("/covers/")) score += 3;
  if (track.source === "netease") score += 2;
  if (/周杰伦/.test(`${track.artist} ${track.title}`)) score += 1;
  return score;
}

function uniqueIds(ids) {
  const seen = new Set();
  const result = [];
  for (const id of ids || []) {
    const value = String(id || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
