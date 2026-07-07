# Claudio

Claudio is a local-first personal AI radio prototype. It runs as a browser/PWA app during development and can be packaged as a Windows or macOS Electron app.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The local API runs on `http://127.0.0.1:4217`.

Desktop development:

```bash
npm run dev:desktop
```

## Build

```bash
npm run build
npm run dist:mac
npm run dist:win
```

## Configuration

Copy `.env.example` to `.env`, or use the Settings screen inside the app. Secrets are read by the local Node service and are not required for the demo path.

Supported keys:

- `AI_PROVIDER`: `mock`, `claude_cli`, `anthropic`, or `openai`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `FISH_AUDIO_API_KEY`
- `FISH_AUDIO_VOICE_ID`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `OPENWEATHER_API_KEY`
- `NCM_COOKIE`
- `NCM_API_BASE`
- `UPNP_TARGET_URL`

For NeteaseCloudMusicApi, run an NCM API server separately and set `NCM_API_BASE`. Claudio has been tested with `xiaoyangxiaozhang/ncm-api-enhanced` on `http://127.0.0.1:3300`:

```bash
mkdir -p work
cd work
git clone https://github.com/xiaoyangxiaozhang/ncm-api-enhanced.git
cd ncm-api-enhanced
pnpm install
cd ../../
npm run dev:ncm
```

Then set `NCM_API_BASE=http://127.0.0.1:3300` in the Claudio Settings screen. If NCM is not configured or unavailable, Claudio falls back to playable demo tracks.

## Data

Development data is stored in `.claudio-data/`. Packaged desktop builds use the OS app data directory. Claudio creates:

- `claudio.sqlite`
- `user/taste.md`
- `user/routines.md`
- `user/playlists.json`
- `user/mood-rules.md`
- `cache/tts/*.mp3`

## API

- `POST /api/chat`
- `GET /api/now`
- `GET /api/next`
- `GET /api/taste`
- `GET /api/plan/today`
- `GET /api/settings`
- `POST /api/settings`
- `POST /api/tts`
- `WS /stream`
