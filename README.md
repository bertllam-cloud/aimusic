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
- `NCM_AUTO_START`
- `NCM_APP_PATH`
- `UPNP_TARGET_URL`

Claudio includes the NeteaseCloudMusicApi source and its runtime dependencies under `src/server/ncm-api`. The normal `npm run dev` and `npm start` commands start both services inside the same Node process; no second terminal, clone, or separate NCM install is required. The bundled API listens on `http://127.0.0.1:3300` by default.

The bundled API is based on `xiaoyangxiaozhang/ncm-api-enhanced`; its upstream license is included at `src/server/ncm-api/LICENSE`.

`NCM_AUTO_START=false` disables the embedded API. `NCM_APP_PATH` can be used to point to a compatible replacement server module for advanced setups. If the embedded API is unavailable, Claudio falls back to playable demo tracks.

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
