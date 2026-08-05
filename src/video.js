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
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      // ffmpeg is verbose; surface the tail where the actual error lives.
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

const CLIP_FRAMES = Math.round(config.clipSeconds * config.fps);

// One Ken Burns (zoompan) clip per image, with the caption burned into a lower-third.
async function buildClip(imgPath, captionFile, outPath) {
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
    `box=1:boxcolor=black@0.5:boxborderw=22:x=64:y=h-th-64[v]`;

  await runFFmpeg([
    '-y',
    '-loop', '1',
    '-t', String(config.clipSeconds),
    '-i', imgPath,
    '-filter_complex', vf,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-an',
    outPath,
  ]);
}

// Cross-fade the clips into one silent video. For equal-length clips of duration D and
// transition T, each xfade offset advances by (D - T).
async function crossfadeClips(clipPaths, outPath) {
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], outPath);
    return;
  }
  const { transitionSeconds, clipSeconds } = config;
  const step = clipSeconds - transitionSeconds;

  const inputs = [];
  clipPaths.forEach((p) => inputs.push('-i', p));

  let filter = '';
  let last = '[0:v]';
  let offset = 0;
  for (let i = 1; i < clipPaths.length; i++) {
    offset += step;
    const out = i === clipPaths.length - 1 ? '[vout]' : `[x${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset.toFixed(3)}${out};`;
    last = out;
  }
  filter = filter.replace(/;$/, '');

  await runFFmpeg([
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-r', String(config.fps),
    outPath,
  ]);
}

// Mux narration over the silent video. Video length drives the output (no -shortest),
// so a short narration just leaves trailing silence rather than truncating the visuals.
async function muxAudio(silentVideo, narrationPath, outPath) {
  if (!narrationPath) {
    await fs.copyFile(silentVideo, outPath);
    return;
  }
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
}

// Orchestrate: per-clip -> crossfade -> audio. Returns the final mp4 path.
export async function renderVideo(imagePaths, listing, narrationPath, dir) {
  const captionFile = path.join(dir, 'caption.txt');
  await fs.writeFile(captionFile, buildCaption(listing) || ' ');

  const clipPaths = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const clip = path.join(dir, `clip_${String(i).padStart(3, '0')}.mp4`);
    await buildClip(imagePaths[i], captionFile, clip);
    clipPaths.push(clip);
  }

  const silent = path.join(dir, 'silent.mp4');
  await crossfadeClips(clipPaths, silent);

  const final = path.join(dir, 'reel.mp4');
  await muxAudio(silent, narrationPath, final);
  log.info('render complete', final);
  return final;
}
