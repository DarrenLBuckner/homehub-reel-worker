# homehub-reel-worker

External render worker for HomeHub **AI Reels**. Turns an agent listing's photos into a short
captioned Ken Burns (pan/zoom) mp4 with optional voiceover, and posts the result back to the
Portal. Lives outside Vercel because a multi-minute FFmpeg render can't run in a serverless
function.

## How it fits

```
Portal /api/ai/generate-reel  ──POST job──▶  this worker  /render   (202 ACK immediately)
                                                   │ render async (ffmpeg + tts-1)
                                                   │ upload mp4 → Supabase property-videos
                                                   ▼
Portal /api/webhooks/reel-complete  ◀──signed callback──  { property_id, status, video_url }
```

Full contract: see `docs/reel-worker-setup.md` in the **home-hub-portal** repo. The two sides
are already implemented there (PR 3) and rendered on the consumer listing page (PR 6).

## Endpoints

- `GET /health` → `{ ok: true }`
- `POST /render` — `Authorization: Bearer <REEL_WORKER_API_KEY>`, JSON body:
  ```json
  {
    "property_id": "…",
    "user_id": "…",
    "images": ["https://…/property-images/{user_id}/a.jpg", "…"],
    "listing": { "title","price","currency","bedrooms","bathrooms","address","agent_name" }
  }
  ```
  Responds `202` immediately, then renders and calls the Portal back.

## Run locally

```bash
cp .env.example .env   # fill in the secrets
npm install
npm start              # needs ffmpeg on PATH; the Docker image bundles it
```

## Deploy (Railway)

Railway builds from the `Dockerfile` (which installs `ffmpeg` + a caption font). Set the env
vars from `.env.example`. After the first deploy, put the service's public URL **plus the
`/render` path** into the Portal's Vercel env as `REEL_WORKER_URL`.

## Notes / current state

- **Voiceover** (`tts-1`) is best-effort — if the key is missing or the call fails, the reel
  renders silent rather than failing.
- **Background music** is deferred: set `MUSIC_PATH` to a bundled royalty-free track to enable
  mixing; until then reels render without music.
- **Format** is 1920×1080 landscape (matches property photos). Switch to vertical/social by
  changing `width`/`height` in `src/config.js`.
- The FFmpeg filtergraph in `src/video.js` is the piece to validate on the first real render —
  any failure sends `status:'failed'` so the listing is never stuck in `pending`.
