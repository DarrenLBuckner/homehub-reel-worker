import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

function listTracks() {
  // Explicit single-track override wins if set and present.
  if (config.musicPath) {
    try {
      fs.accessSync(config.musicPath);
      return [config.musicPath];
    } catch {
      log.warn('MUSIC_PATH set but file not found:', config.musicPath);
    }
  }
  try {
    return fs
      .readdirSync(config.musicDir)
      .filter((f) => f.toLowerCase().endsWith('.mp3'))
      .sort()
      .map((f) => path.join(config.musicDir, f));
  } catch {
    return []; // no music dir / no tracks -> reels render without music (unchanged behavior)
  }
}

// Pick a track deterministically from the property id, so the same listing always gets the
// same music (stable across re-renders) while different listings vary — at zero extra cost.
export function pickMusicTrack(propertyId) {
  const tracks = listTracks();
  if (tracks.length === 0) return null;

  let hash = 0;
  const s = String(propertyId || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  const track = tracks[Math.abs(hash) % tracks.length];
  log.info('music track selected', track);
  return track;
}
