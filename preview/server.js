// Separate Render preview entrypoint. It never constructs a Replicate client.
const express = require('express');
const { Pool } = require('pg');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createApp, initDatabase, databaseOptions } = require('../server');

function previewSettings(settings) {
  if (settings.PREVIEW_MODE !== 'mock') throw new Error('Preview requires PREVIEW_MODE=mock');
  if (settings.RENDER_SERVICE_NAME !== 'velora-account-preview') throw new Error('Only the dedicated preview service is allowed');
  if (settings.REPLICATE_API_TOKEN || settings.VELORA_TEST_KEY) throw new Error('Do not attach production/provider credentials to preview');
  if (!settings.JWT_SECRET || Buffer.byteLength(settings.JWT_SECRET) < 32) throw new Error('Preview needs its own JWT secret');
  const database = new URL(settings.DATABASE_URL);
  if (!/^velora_preview(?:_[a-z0-9_]+)?$/.test(decodeURIComponent(database.pathname.slice(1)))) {
    throw new Error('Only a dedicated velora_preview database is allowed');
  }
  const origin = new URL(settings.RENDER_EXTERNAL_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Preview requires a clean HTTPS origin');
  }
  if (!/^velora-account-preview(?:-[a-z0-9]+)?\.onrender\.com$/.test(origin.hostname)) {
    throw new Error('Only the dedicated preview origin is allowed');
  }
  return { jwtSecret: settings.JWT_SECRET, origin: origin.origin };
}

function createPreview({pool, settings}) {
  const {jwtSecret, origin} = previewSettings(settings);
  let providerCalls = 0;
  const mock = {async run(model, options, progress) {
    providerCalls++;
    if (options.input.prompt.includes('[mock:fail]')) {
      progress({status:'failed'});
      throw new Error('Simulated provider failure');
    }
    return `${origin}/preview-result.svg`;
  }};
  const app = express();
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Velora-Preview', 'mock-no-replicate');
    next();
  });
  app.get('/', (req, res) => {
    const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    res.type('html').send(html.replace('<body>', '<body><aside role="status" style="padding:16px;background:#ffe9a8;color:#161616;text-align:center">ТЕСТОВАЯ СРЕДА: только вымышленные данные. Фото имитируется, Replicate не вызывается. Баланс тестовый.</aside>'));
  });
  app.get('/preview-result.svg', (req, res) => res.sendFile(path.join(__dirname, 'mock-result.svg')));
  app.use(createApp({pool, jwtSecret, replicate:mock, generationEnabled:true, enableLegacyGeneration:false}));
  return {app, mockCalls:()=>providerCalls};
}

async function startPreview(settings=process.env) {
  previewSettings(settings); // Fail before opening any database connection.
  const pool = new Pool(databaseOptions(settings));
  await initDatabase(pool);
  const {app} = createPreview({pool, settings});
  return app.listen(settings.PORT || 3000, '0.0.0.0', () => console.log('Isolated mock preview ready; no Replicate calls'));
}
if (require.main === module) startPreview().catch(() => {console.error('Preview startup failed: check isolated configuration');process.exitCode=1;});
module.exports={previewSettings,createPreview};
