import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './log.js';
import { buildNarration } from './util.js';

// Synthesize narration to an mp3. Best-effort: returns null (never throws) so a TTS
// outage or missing key degrades to a silent reel instead of failing the whole render.
export async function synthesizeNarration(listing, dir) {
  if (!config.openaiApiKey) {
    log.warn('no OPENAI_API_KEY — rendering without narration');
    return null;
  }
  try {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const script = buildNarration(listing);
    const speech = await openai.audio.speech.create({
      model: 'tts-1',
      voice: config.ttsVoice,
      input: script,
    });
    const buf = Buffer.from(await speech.arrayBuffer());
    const file = path.join(dir, 'narration.mp3');
    await fs.writeFile(file, buf);
    log.info('narration synthesized', `${buf.length} bytes`);
    return file;
  } catch (e) {
    log.warn('narration failed — continuing silent', e?.message);
    return null;
  }
}
