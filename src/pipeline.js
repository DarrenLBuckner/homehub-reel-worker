import { log } from './log.js';
import { makeWorkDir, cleanup, downloadImages, deriveUserIdFromImages } from './util.js';
import { synthesizeNarration } from './tts.js';
import { resolveMusicTrack } from './music.js';
import { renderVideo, expectedDuration, probeDuration } from './video.js';
import fs from 'node:fs/promises';
import { uploadVideo } from './storage.js';
import { sendCallback } from './callback.js';
import { config } from './config.js';

// Shown to the agent when a reel cannot be made. Never publish a short or partial reel.
export const PHOTO_LOAD_MESSAGE = "Some photos couldn't be loaded, please try again.";

class ReelQualityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Full job lifecycle. Runs AFTER the HTTP 202 has already been sent (see server.js), so
// this is where all the time-consuming work happens. Guarantee: it ALWAYS ends by sending
// exactly one callback — 'ready' on success, 'failed' on any error — so the Portal's
// reel_status never gets stuck in 'pending'.
export async function runPipeline(job) {
  const propertyId = job.property_id;
  const workdir = await makeWorkDir(propertyId);

  try {
    // Prefer the explicit user_id from the payload; fall back to parsing the image path.
    const userId = job.user_id || deriveUserIdFromImages(job.images);
    if (!userId) {
      throw new Error('cannot determine user_id for the storage path (missing job.user_id and un-parseable image URLs)');
    }

    const { files: localImages, failures } = await downloadImages(job.images, workdir, propertyId);
    log.info('downloaded images', propertyId, localImages.length, 'failed', failures.length);

    // QUALITY GATE 1: every photo must load, and at least config.minPhotos. A reel is never built
    // from a partial set: it would be short or missing photos the agent chose.
    if (failures.length > 0 || localImages.length < config.minPhotos) {
      throw new ReelQualityError(
        'photo_load',
        `${failures.length} of ${Math.min(job.images.length, config.maxImages)} photos could not be loaded (${localImages.length} loaded, need all and at least ${config.minPhotos})`,
      );
    }

    const narration = await synthesizeNarration(job.listing || {}, workdir); // null on failure
    // Honor an explicit track choice from the job (job.music); 'auto'/absent = deterministic pick.
    const musicTrack = resolveMusicTrack(propertyId, job.music); // null if 'none' or no tracks bundled

    // job.brand is the listing territory's display_name (e.g. "Dominican Republic HomeHub"),
    // sent by the Portal so per-country branding needs no code here. Falls back to neutral.
    const videoPath = await renderVideo(localImages, job.listing || {}, narration, musicTrack, workdir, job.brand);

    // QUALITY GATE 2: the finished file must have the length and size its photo count implies.
    const seconds = await probeDuration(videoPath);
    const bytes = (await fs.stat(videoPath)).size;
    const wantSeconds = expectedDuration(localImages.length);
    log.info('render check', propertyId, 'photos', localImages.length, 'seconds', seconds.toFixed(1), 'expected', wantSeconds.toFixed(1), 'bytes', bytes);
    if (seconds < wantSeconds * 0.8 || bytes < localImages.length * config.minBytesPerPhoto) {
      throw new ReelQualityError(
        'render_short',
        `reel too short or small for ${localImages.length} photos: ${seconds.toFixed(1)}s (expected about ${wantSeconds.toFixed(1)}s), ${bytes} bytes`,
      );
    }

    const objectPath = `${userId}/${propertyId}-reel.mp4`;
    const publicUrl = await uploadVideo(videoPath, objectPath);

    await sendCallback({ property_id: propertyId, status: 'ready', video_url: publicUrl });
  } catch (err) {
    log.error('pipeline failed', propertyId, err?.message || err);
    const code = err?.code || 'error';
    await sendCallback({
      property_id: propertyId,
      status: 'failed',
      error: code,
      message: code === 'photo_load' ? PHOTO_LOAD_MESSAGE : 'The reel could not be made, please try again.',
      detail: String(err?.message || err).slice(0, 300),
    }).catch((e) =>
      log.error('failed-callback also failed', propertyId, e?.message),
    );
  } finally {
    await cleanup(workdir);
  }
}
