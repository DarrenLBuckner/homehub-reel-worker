import path from 'node:path';

export const config = {
  port: process.env.PORT || 8080,

  // Shared secret pair with the Portal.
  workerApiKey: process.env.REEL_WORKER_API_KEY || '',
  webhookSecret: process.env.REEL_WORKER_WEBHOOK_SECRET || '',

  openaiApiKey: process.env.OPENAI_API_KEY || '',

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // www. is mandatory — a bare-domain redirect strips the POST body (CLAUDE.md gotcha #1).
  callbackUrl: process.env.PORTAL_CALLBACK_URL || 'https://www.portalhomehub.com/api/webhooks/reel-complete',
  bucket: process.env.REEL_BUCKET || 'property-videos',

  ttsVoice: process.env.TTS_VOICE || 'nova',
  // Bundled royalty-free tracks live here (committed to the image). Any .mp3 dropped in is
  // auto-discovered and mixed as a low-volume bed — zero per-render cost. No files => silent
  // behavior (unchanged). Legacy MUSIC_PATH still honored as an explicit single-track override.
  musicDir: process.env.MUSIC_DIR || path.join(process.cwd(), 'assets', 'music'),
  // Music is organised by region (assets/music/{region}/*.mp3) so each territory gets its own
  // sound — Caribbean/Soca for Guyana, Latin for DR, Afrobeats for Africa, etc. Defaults to
  // caribbean for now; when the reel job carries a country/region, set this per-job from it.
  musicRegion: process.env.MUSIC_REGION || 'caribbean',
  musicPath: process.env.MUSIC_PATH || '',
  musicVolume: Number(process.env.MUSIC_VOLUME) || 0.3, // bed level under the voiceover
  musicVolumeNoVoice: Number(process.env.MUSIC_VOLUME_NO_VOICE) || 0.6, // louder if no narration

  // Render tuning.
  width: 1920,
  height: 1080,
  fps: 30,
  clipSeconds: 3.5,
  transitionSeconds: 0.6,
  maxImages: 12, // bound render time / cost
  fontFile: process.env.CAPTION_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  // Cap x264 threads. In a container, x264 otherwise auto-detects the HOST core count
  // (e.g. 34) and allocates per-thread encoder buffers on init — which SIGKILLs the
  // process on a small container. A low fixed count keeps memory bounded.
  x264Threads: Number(process.env.X264_THREADS) || 2,
};

// Fail fast at boot if the hard requirements are missing. OPENAI/MUSIC are soft (narration
// and music degrade gracefully), so they are NOT required here.
export function assertConfig() {
  const required = [
    ['REEL_WORKER_API_KEY', config.workerApiKey],
    ['REEL_WORKER_WEBHOOK_SECRET', config.webhookSecret],
    ['SUPABASE_URL', config.supabaseUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceKey],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
