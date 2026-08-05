import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { log } from './log.js';

// Lazily create the client on first use, so a bad/missing SUPABASE_URL can't throw at
// module-import time (which would crash the process before any logging or the health server).
let _supabase = null;
function client() {
  if (!_supabase) {
    _supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabase;
}

// Upload the mp4 to property-videos/{objectPath} and return its public URL.
// upsert:true so a re-render overwrites the previous reel at the same canonical path.
export async function uploadVideo(localPath, objectPath) {
  const buf = await fs.readFile(localPath);
  const { error } = await client()
    .storage.from(config.bucket)
    .upload(objectPath, buf, {
      contentType: 'video/mp4',
      upsert: true,
      cacheControl: '3600',
    });
  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const { data } = client().storage.from(config.bucket).getPublicUrl(objectPath);
  log.info('uploaded', objectPath, '->', data.publicUrl);
  return data.publicUrl;
}
