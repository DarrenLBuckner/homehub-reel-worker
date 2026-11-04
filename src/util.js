import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { downloadStorageObject } from './storage.js';

export async function makeWorkDir(propertyId) {
  const base = path.join(os.tmpdir(), 'reel-');
  const dir = await fs.mkdtemp(base);
  log.info('workdir', propertyId, dir);
  return dir;
}

export async function cleanup(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    log.warn('cleanup failed', dir, e?.message);
  }
}

// A listing photo stored in the property-images bucket, however the address was written
// (public object URL, or the render/image form). The bucket may be private, so these are read
// with the service key, never over plain HTTP.
const STORAGE_PHOTO = /\/storage\/v1\/(?:object|render\/image)\/public\/property-images\/([^?#]+)/i;

// What the downloaded bytes really are (by content, never by the address), so the file gets the
// right extension and an unreadable download (an error page, a HEIC) is caught here, not by ffmpeg.
function sniffImage(buf) {
  if (!buf || buf.length < 1024) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function fetchPhotoBytes(url) {
  const m = STORAGE_PHOTO.exec(url);
  if (m) {
    return downloadStorageObject('property-images', decodeURIComponent(m[1]));
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// Download up to config.maxImages images to the workdir, in order. Returns
// { files, failures }: every photo that could not be loaded is logged with the listing id and
// the file, and listed in failures. The caller decides whether the job may go on (it must not
// when anything failed: a reel is never published short or partial).
export async function downloadImages(urls, dir, propertyId = '?') {
  const limited = urls.slice(0, config.maxImages);
  const files = [];
  const failures = [];
  for (let i = 0; i < limited.length; i++) {
    const url = limited[i];
    try {
      const buf = await fetchPhotoBytes(url);
      const ext = sniffImage(buf);
      if (!ext) throw new Error('not a readable JPEG/PNG/WebP image');
      const file = path.join(dir, `img_${String(i).padStart(3, '0')}.${ext}`);
      await fs.writeFile(file, buf);
      files.push(file);
    } catch (e) {
      const name = String(url).split('/').slice(-2).join('/');
      log.error('PHOTO DOWNLOAD FAILED', 'listing', propertyId, 'file', name, 'reason', e?.message || e);
      failures.push({ index: i, file: name, reason: String(e?.message || e) });
    }
  }
  return { files, failures };
}

// Fallback user_id derivation: images live at property-images/{user_id}/{file}.
// Preferred source is job.user_id (see pipeline); this only covers a missing field.
export function deriveUserIdFromImages(urls) {
  const marker = '/property-images/';
  for (const url of urls) {
    const idx = url.indexOf(marker);
    if (idx < 0) continue;
    const rest = url.substring(idx + marker.length);
    const seg = rest.split('/')[0];
    // A user_id segment looks like a UUID; a bare filename (root-uploaded) does not.
    if (seg && /^[0-9a-f-]{16,}$/i.test(seg)) return seg;
  }
  return null;
}

export function formatPrice(price, currency) {
  const n = Number(price);
  const amount = Number.isFinite(n) ? n.toLocaleString('en-US') : String(price ?? '');
  return `${currency || ''} ${amount}`.trim();
}

// Greedy word-wrap so long lines (addresses) fit inside the narrow vertical frame instead of
// running off the edge. A single word longer than `max` is left on its own line.
export function wrapText(text, max) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      out.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) out.push(line);
  return out;
}

// Build the burned-in caption block from listing facts.
export function buildCaption(listing = {}) {
  const lines = [];
  const price = formatPrice(listing.price, listing.currency);
  if (price) lines.push(price);
  const bb = [];
  if (listing.bedrooms) bb.push(`${listing.bedrooms} bd`);
  if (listing.bathrooms) bb.push(`${listing.bathrooms} ba`);
  if (bb.length) lines.push(bb.join('  ·  '));
  if (listing.address) lines.push(...wrapText(listing.address, config.captionWrapChars));
  return lines.join('\n');
}

// Build a short narration script from listing facts.
export function buildNarration(listing = {}) {
  const parts = [];
  const bedBath = [];
  if (listing.bedrooms) bedBath.push(`${listing.bedrooms} bedroom`);
  if (listing.bathrooms) bedBath.push(`${listing.bathrooms} bathroom`);
  const desc = bedBath.length ? bedBath.join(', ') + ' property' : 'property';
  parts.push(`Welcome to this ${desc}`);
  if (listing.address) parts.push(`located at ${listing.address}`);
  const price = formatPrice(listing.price, listing.currency);
  if (price) parts.push(`priced at ${price}`);
  let script = parts.join(', ') + '.';
  if (listing.agent_name) script += ` Contact ${listing.agent_name} today to arrange a viewing.`;
  return script;
}
