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
  // Region-scoped: assets/music/{region}/*.mp3. A property only ever draws from its territory's
  // sound, so adding another region's tracks later can't leak into Guyana's reels.
  const regionDir = path.join(config.musicDir, config.musicRegion);
  try {
    return fs
      .readdirSync(regionDir)
      .filter((f) => f.toLowerCase().endsWith('.mp3'))
      .sort()
      .map((f) => path.join(regionDir, f));
  } catch {
    return []; // no tracks for this region -> reels render without music (unchanged behavior)
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
  log.info('music track selected (auto)', track);
  return track;
}

// Resolve the music track for a job, honoring the caller's explicit choice:
//   'none'                 -> no music (silent bed)
//   'auto' | undefined     -> deterministic auto-pick (pickMusicTrack)
//   '<filename>.mp3'       -> that specific bundled track, if it exists in this region
// The requested value is reduced to a bare basename (path.basename) so it can never escape
// the region folder — a caller can only ever select a file we actually bundled. An unknown
// or missing filename falls back to the auto-pick rather than rendering silent unexpectedly.
export function resolveMusicTrack(propertyId, requested) {
  const choice = typeof requested === 'string' ? requested.trim() : '';

  if (choice.toLowerCase() === 'none') {
    log.info('music: explicitly disabled for this reel');
    return null;
  }
  if (choice && choice.toLowerCase() !== 'auto') {
    const safe = path.basename(choice); // strip any path components
    const full = path.join(config.musicDir, config.musicRegion, safe);
    try {
      fs.accessSync(full);
      log.info('music track selected (chosen)', full);
      return full;
    } catch {
      log.warn('requested music track not found, falling back to auto:', safe);
    }
  }
  return pickMusicTrack(propertyId);
}
