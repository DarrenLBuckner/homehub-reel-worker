import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { buildCaption } from './util.js';

// ---------------------------------------------------------------------------
// FFmpeg pipeline. NOTE: this is the part to validate on the first real render —
// filtergraphs can't be exercised without ffmpeg + real images, which only exist
// on Railway. Every failure here propagates up so the pipeline sends status:'failed'
// (the listing is never left stuck in 'pending').
// ---------------------------------------------------------------------------

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    log.info('ffmpeg', args.join(' '));
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      if (code === 0) return resolve();
      // signal is set when the process was killed (e.g. SIGKILL = OOM), which is far more
      // diagnostic than a null exit code. ffmpeg is verbose; surface the stderr tail too.
      reject(new Error(`ffmpeg exited code=${code} signal=${signal}: ${stderr.slice(-1200)}`));
    });
  });
}

const CLIP_FRAMES = Math.round(config.clipSeconds * config.fps);

// One Ken Burns (zoompan) clip per image, with the caption burned into a lower-third and the
// brand mark burned into the top-right (white + dark outline so it reads on any footage).
async function buildClip(imgPath, captionFile, brandFile, outPath) {
  const { width, height, fps, fontFile } = config;
  // Cover a 2560x1440 frame (a modest 1.33x over the 1920x1080 output — enough headroom to
  // keep the zoom smooth without the memory blowup of the old 8000px pre-scale), then slow
  // zoom-in down to the output size, then caption.
  const vf =
    `[0:v]scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,setsar=1,` +
    `zoompan=z='min(zoom+0.0012,1.35)':d=${CLIP_FRAMES}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}[z];` +
    `[z]drawtext=fontfile='${fontFile}':textfile='${captionFile}':reload=0:` +
    `fontcolor=white:fontsize=44:line_spacing=8:` +
    `box=1:boxcolor=black@0.5:boxborderw=22:x=64:y=h-th-64[c];` +
    `[c]drawtext=fontfile='${fontFile}':textfile='${brandFile}':reload=0:` +
    `fontcolor=white@0.7:fontsize=34:borderw=3:bordercolor=black@0.6:x=w-tw-40:y=40[v]`;

  await runFFmpeg([
    '-y',
    '-loop', '1',
    '-framerate', String(fps),
    '-i', imgPath,
    '-filter_complex', vf,
    '-map', '[v]',
    // Hard-cap the clip to exactly CLIP_FRAMES. The old input-side `-t` combined with
    // zoompan's `d` produced clips several times too long, which broke the crossfade
    // offsets and ballooned the composite to minutes (→ OOM). -frames:v is unambiguous.
    '-frames:v', String(CLIP_FRAMES),
    '-c:v', 'libx264',
    '-threads', String(config.x264Threads),
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-an',
    outPath,
  ]);
}

// Cross-fade the clips into one silent video — PAIRWISE (2 inputs at a time), not all N
// clips in a single filtergraph. Feeding 10 clips into one ffmpeg opens 10 simultaneous
// 1080p H.264 decoders at init (~700MB+), which SIGKILLs the process on a small container.
// Pairwise keeps exactly 2 decoders open at any moment, so memory stays flat regardless of
// clip count. Cost: N-1 sequential encodes of the growing accumulator (slower, but bounded).
async function crossfadeClips(clipPaths, outPath, dir) {
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], outPath);
    return;
  }
  const { transitionSeconds, clipSeconds, fps, x264Threads } = config;

  let accPath = clipPaths[0];
  let accDuration = clipSeconds; // each clip is hard-capped to exactly clipSeconds

  for (let i = 1; i < clipPaths.length; i++) {
    const offset = Math.max(0, accDuration - transitionSeconds);
    const isLast = i === clipPaths.length - 1;
    const stepOut = isLast ? outPath : path.join(dir, `xf_${String(i).padStart(3, '0')}.mp4`);

    await runFFmpeg([
      '-y',
      '-i', accPath,
      '-i', clipPaths[i],
      '-filter_complex',
      `[0:v][1:v]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset.toFixed(3)}[v]`,
      '-map', '[v]',
      '-c:v', 'libx264',
      '-threads', String(x264Threads),
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      stepOut,
    ]);

    accPath = stepOut;
    accDuration = offset + clipSeconds;
  }
}

// Lay audio over the silent video. Handles four cases: silent, narration-only, music-only,
// and narration + music. Music is a LOW-VOLUME BED — full-volume narration sits on top, and
// the music keeps playing after the (shorter) narration ends. `finalDuration` is the reel
// length; we trim to it with -t so looped music doesn't run past the video.
async function muxAudio(silentVideo, narrationPath, musicPath, finalDuration, outPath) {
  // Silent — no audio at all.
  if (!narrationPath && !musicPath) {
    await fs.copyFile(silentVideo, outPath);
    return;
  }

  // Narration only (no music) — video length drives; short narration = trailing silence.
  if (narrationPath && !musicPath) {
    await runFFmpeg([
      '-y',
      '-i', silentVideo,
      '-i', narrationPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      outPath,
    ]);
    return;
  }

  // Music only (no narration) — looped bed, a touch louder since nothing competes with it.
  if (!narrationPath && musicPath) {
    await runFFmpeg([
      '-y',
      '-i', silentVideo,
      '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex', `[1:a]volume=${config.musicVolumeNoVoice}[a]`,
      '-map', '0:v:0',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-t', finalDuration.toFixed(3),
      outPath,
    ]);
    return;
  }

  // Narration + music. Music at bed volume, narration at full; amix duration=longest keeps
  // the music going after narration ends; normalize=0 preserves our explicit volumes.
  await runFFmpeg([
    '-y',
    '-i', silentVideo,
    '-i', narrationPath,
    '-stream_loop', '-1', '-i', musicPath,
    '-filter_complex',
    `[2:a]volume=${config.musicVolume}[m];[1:a]volume=1[n];` +
      `[m][n]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]`,
    '-map', '0:v:0',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-t', finalDuration.toFixed(3),
    outPath,
  ]);
}

// Orchestrate: per-clip -> crossfade -> audio. Returns the final mp4 path.
export async function renderVideo(imagePaths, listing, narrationPath, musicPath, dir) {
  const captionFile = path.join(dir, 'caption.txt');
  await fs.writeFile(captionFile, buildCaption(listing) || ' ');
  const brandFile = path.join(dir, 'brand.txt');
  await fs.writeFile(brandFile, config.brand || ' ');

  const clipPaths = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const clip = path.join(dir, `clip_${String(i).padStart(3, '0')}.mp4`);
    await buildClip(imagePaths[i], captionFile, brandFile, clip);
    clipPaths.push(clip);
  }

  const silent = path.join(dir, 'silent.mp4');
  await crossfadeClips(clipPaths, silent, dir);

  // Crossfade output length for N equal clips of duration D and transition T.
  const finalDuration =
    config.clipSeconds + (clipPaths.length - 1) * (config.clipSeconds - config.transitionSeconds);

  const final = path.join(dir, 'reel.mp4');
  await muxAudio(silent, narrationPath, musicPath, finalDuration, final);
  log.info('render complete', final);
  return final;
}
