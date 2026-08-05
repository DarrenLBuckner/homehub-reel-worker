import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

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

// Download up to config.maxImages images to the workdir. Returns local file paths, in order.
export async function downloadImages(urls, dir) {
  const limited = urls.slice(0, config.maxImages);
  const out = [];
  for (let i = 0; i < limited.length; i++) {
    const url = limited[i];
    const resp = await fetch(url);
    if (!resp.ok) {
      log.warn('skipping image (fetch failed)', resp.status, url);
      continue;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const file = path.join(dir, `img_${String(i).padStart(3, '0')}.jpg`);
    await fs.writeFile(file, buf);
    out.push(file);
  }
  if (out.length === 0) throw new Error('no images could be downloaded');
  return out;
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

// Build the burned-in caption block from listing facts.
export function buildCaption(listing = {}) {
  const lines = [];
  const price = formatPrice(listing.price, listing.currency);
  if (price) lines.push(price);
  const bb = [];
  if (listing.bedrooms) bb.push(`${listing.bedrooms} bd`);
  if (listing.bathrooms) bb.push(`${listing.bathrooms} ba`);
  if (bb.length) lines.push(bb.join('  ·  '));
  if (listing.address) lines.push(String(listing.address));
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
