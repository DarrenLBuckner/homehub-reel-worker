import crypto from 'node:crypto';
import { config } from './config.js';
import { log } from './log.js';

// Sign the raw JSON body with the shared secret and POST it to the Portal webhook.
// Signature scheme MUST match PR 3: hex HMAC-SHA256 over the exact bytes sent, in the
// x-reel-signature header. The callback URL MUST keep the www. prefix (body-strip rule).
export async function sendCallback(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(body)
    .digest('hex');

  // Small retry: the Portal webhook is idempotent, so retrying a transient 5xx/network
  // blip is safe and keeps the listing from being stranded on a flaky callback.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(config.callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-reel-signature': signature,
        },
        body,
      });
      if (resp.ok) {
        log.info('callback delivered', payload.property_id, payload.status);
        return true;
      }
      // 4xx (e.g. bad signature) won't be fixed by retrying — stop.
      if (resp.status >= 400 && resp.status < 500) {
        log.error('callback rejected', resp.status, await resp.text().catch(() => ''));
        return false;
      }
      log.warn(`callback ${resp.status} (attempt ${attempt}/${maxAttempts})`);
    } catch (e) {
      log.warn(`callback threw (attempt ${attempt}/${maxAttempts})`, e?.message);
    }
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  log.error('callback failed after retries', payload.property_id);
  return false;
}
