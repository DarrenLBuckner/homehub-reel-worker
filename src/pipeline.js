import { log } from './log.js';
import { makeWorkDir, cleanup, downloadImages, deriveUserIdFromImages } from './util.js';
import { synthesizeNarration } from './tts.js';
import { pickMusicTrack } from './music.js';
import { renderVideo } from './video.js';
import { uploadVideo } from './storage.js';
import { sendCallback } from './callback.js';

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

    const localImages = await downloadImages(job.images, workdir);
    log.info('downloaded images', propertyId, localImages.length);

    const narration = await synthesizeNarration(job.listing || {}, workdir); // null on failure
    const musicTrack = pickMusicTrack(propertyId); // null if no tracks bundled

    const videoPath = await renderVideo(localImages, job.listing || {}, narration, musicTrack, workdir);

    const objectPath = `${userId}/${propertyId}-reel.mp4`;
    const publicUrl = await uploadVideo(videoPath, objectPath);

    await sendCallback({ property_id: propertyId, status: 'ready', video_url: publicUrl });
  } catch (err) {
    log.error('pipeline failed', propertyId, err?.message || err);
    await sendCallback({ property_id: propertyId, status: 'failed' }).catch((e) =>
      log.error('failed-callback also failed', propertyId, e?.message),
    );
  } finally {
    await cleanup(workdir);
  }
}
