import express from 'express';
import { config, assertConfig } from './config.js';
import { runPipeline } from './pipeline.js';
import { log } from './log.js';

// Surface any boot-time crash in the deploy logs instead of dying silently.
process.on('uncaughtException', (e) => log.error('uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));

try {
  assertConfig();
} catch (e) {
  log.error('CONFIG ERROR at boot —', e?.message);
  process.exit(1);
}

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

// Bind explicitly to 0.0.0.0 and the platform-provided PORT. Railway's healthcheck cannot
// reach an app that only binds the default (::/localhost) interface — the #1 cause of a
// "service unavailable" healthcheck when the container otherwise built and deployed fine.
const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, '0.0.0.0', () => {
  log.info(`reel worker listening on 0.0.0.0:${port}`);
});
server.on('error', (e) => {
  log.error('listen error', e);
  process.exit(1);
});
