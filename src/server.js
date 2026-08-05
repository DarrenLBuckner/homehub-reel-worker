import express from 'express';
import { config, assertConfig } from './config.js';
import { runPipeline } from './pipeline.js';
import { log } from './log.js';

assertConfig();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'homehub-reel-worker' }));

app.post('/render', (req, res) => {
  // Auth: Bearer must equal the shared REEL_WORKER_API_KEY.
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!config.workerApiKey || token !== config.workerApiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const job = req.body;
  if (!job || !job.property_id || !Array.isArray(job.images) || job.images.length === 0) {
    return res.status(400).json({ error: 'invalid job payload: need property_id and non-empty images[]' });
  }

  // ACK FAST — the Portal's dispatch has an 8s timeout. Respond now, render async.
  res.status(202).json({ accepted: true, property_id: job.property_id });

  runPipeline(job).catch((err) => log.error('pipeline crashed (unhandled)', err));
});

app.listen(config.port, () => log.info(`reel worker listening on :${config.port}`));
