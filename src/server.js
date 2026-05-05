import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { fileURLToPath } from 'url';
import routes from './api/routes.js';
import { getDb } from './db/leads.js';

const PORT = process.env.PORT || 3002;
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Init DB on startup
getDb();

// API
app.use('/api', routes);

// Frontend
app.use(express.static(join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(join(__dirname, '../frontend/index.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 B2B Outreach Agent running at http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api/health`);
  console.log(`   Dashboard: http://localhost:${PORT}/\n`);
  if (!process.env.OPENROUTER_API_KEY) console.warn('⚠️  OPENROUTER_API_KEY not set — AI personalization will fail');
  if (!process.env.ZOOMINFO_CLIENT_ID) console.warn('⚠️  ZOOMINFO_CLIENT_ID not set — enrichment will be skipped');
  if (!process.env.INSTANTLY_API_KEY) console.warn('⚠️  INSTANTLY_API_KEY not set — Instantly push will fail');
});
