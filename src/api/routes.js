import express from 'express';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { enrichCompanyByDomain, enrichBatch } from '../enrichment/zoominfo.js';
import { scoreCompany, detectTrade } from '../enrichment/icp-scorer.js';
import { loadTradePatterns, getTradeContext, ALL_TRADES } from '../corpus/loader.js';
import { buildSequence } from '../personalization/sequence-builder.js';
import {
  getDb, upsertLead, updateLeadStatus, saveSequence,
  getLeads, getLead, getSequence, getStats,
} from '../db/leads.js';
import {
  listCampaigns, pushLeadToCampaign, pushBulkLeads,
  validateApiKey, getCampaignAnalytics,
} from '../sending/instantly.js';

const router = express.Router();
const upload = multer({ dest: '/tmp/outreach-uploads/' });

// ── Health ──────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), version: '1.0.0' });
});

// ── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    res.json(getStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Leads: list ──────────────────────────────────────────────────────────────
router.get('/leads', (req, res) => {
  try {
    const leads = getLeads({
      status: req.query.status,
      tier: req.query.tier ? Number(req.query.tier) : undefined,
      trade: req.query.trade,
    });
    res.json({ leads, total: leads.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Leads: get one ──────────────────────────────────────────────────────────
router.get('/leads/:id', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const sequence = getSequence(req.params.id);
  res.json({ lead, sequence });
});

// ── Leads: manual add ───────────────────────────────────────────────────────
router.post('/leads', async (req, res) => {
  try {
    const body = req.body;
    const id = uuidv4();
    const lead = {
      id,
      company_name: body.company_name || '',
      domain: body.domain || '',
      first_name: body.first_name || '',
      last_name: body.last_name || '',
      email: body.email || '',
      linkedin_url: body.linkedin_url || '',
      title: body.title || '',
      industry: body.industry || '',
      headcount: body.headcount ? Number(body.headcount) : 0,
      country: body.country || '',
      revenue: body.revenue || '',
      trade: body.trade || detectTrade(body.industry || '', body.company_name || ''),
      icp_score: 0,
      icp_status: 'pending',
      tier: 3,
      status: 'new',
    };
    upsertLead(lead);
    res.json({ lead });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Enrich: single domain ───────────────────────────────────────────────────
router.post('/enrich', async (req, res) => {
  const { domain, lead_id } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  try {
    const enriched = await enrichCompanyByDomain(domain);
    if (!enriched) return res.json({ enriched: null, message: 'ZoomInfo: no match' });

    const scored = await scoreCompany(enriched);

    if (lead_id) {
      const existing = getLead(lead_id);
      if (existing) {
        upsertLead({
          ...existing,
          ...enriched,
          icp_score: scored.icpScore,
          icp_status: scored.icpStatus,
          tier: scored.tier,
          trade: scored.trade || existing.trade,
          status: 'enriched',
        });
        updateLeadStatus(lead_id, 'enriched', { enriched_at: new Date().toISOString() });
      }
    }

    res.json({ enriched, scored });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Enrich: CSV import ───────────────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });

  const rows = [];
  await new Promise((resolve, reject) => {
    createReadStream(req.file.path)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on('data', row => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  const leads = rows.map(row => ({
    id: uuidv4(),
    company_name: row.company_name || row.Company || row.company || '',
    domain: row.domain || row.Domain || row.website || row.Website || '',
    first_name: row.first_name || row['First Name'] || row.firstName || '',
    last_name: row.last_name || row['Last Name'] || row.lastName || '',
    email: row.email || row.Email || '',
    linkedin_url: row.linkedin_url || row.LinkedIn || row.linkedin || '',
    title: row.title || row.Title || row.job_title || '',
    industry: row.industry || row.Industry || '',
    headcount: Number(row.headcount || row.Headcount || row.employees || 0),
    country: row.country || row.Country || '',
    revenue: row.revenue || row.Revenue || '',
    trade: detectTrade(row.industry || row.Industry || '', row.company_name || row.Company || ''),
    icp_score: 0,
    icp_status: 'pending',
    tier: 3,
    status: 'new',
  }));

  leads.forEach(l => upsertLead(l));
  res.json({ imported: leads.length, leads: leads.slice(0, 10) });
});

// ── Enrich all pending leads ─────────────────────────────────────────────────
router.post('/enrich-all', async (req, res) => {
  // Fire async, respond immediately
  res.json({ message: 'Enrichment started', status: 'running' });

  const pending = getLeads({ status: 'new' });
  for (const lead of pending) {
    if (!lead.domain) continue;
    try {
      const enriched = await enrichCompanyByDomain(lead.domain);
      if (enriched) {
        const scored = await scoreCompany(enriched);
        upsertLead({
          ...lead,
          ...enriched,
          icp_score: scored.icpScore,
          icp_status: scored.icpStatus,
          tier: scored.tier,
          trade: scored.trade || lead.trade,
          status: 'enriched',
        });
        updateLeadStatus(lead.id, 'enriched', { enriched_at: new Date().toISOString() });
      }
    } catch (e) {
      console.error(`Enrich failed for ${lead.domain}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }
});

// ── Generate sequence for one lead ──────────────────────────────────────────
router.post('/sequence/:leadId', async (req, res) => {
  const lead = getLead(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    const sequence = await buildSequence(lead);
    saveSequence(sequence);
    updateLeadStatus(lead.id, 'sequenced', { sequenced_at: new Date().toISOString() });
    res.json({ sequence });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bulk generate sequences (async) ─────────────────────────────────────────
router.post('/sequence-all', async (req, res) => {
  const { tier, trade, limit = 50 } = req.body;
  const leads = getLeads({ status: 'enriched', tier: tier ? Number(tier) : undefined, trade });
  const toProcess = leads.slice(0, Number(limit));

  res.json({ message: `Generating sequences for ${toProcess.length} leads`, status: 'running' });

  let done = 0;
  for (const lead of toProcess) {
    try {
      const sequence = await buildSequence(lead);
      saveSequence(sequence);
      updateLeadStatus(lead.id, 'sequenced', { sequenced_at: new Date().toISOString() });
      done++;
    } catch (e) {
      console.error(`Sequence failed for ${lead.id}:`, e.message);
    }
    // Tier 1 needs more time (Claude calls), Tier 3 is instant
    await new Promise(r => setTimeout(r, lead.tier === 1 ? 2000 : 200));
  }
  console.log(`[sequence-all] Done: ${done}/${toProcess.length}`);
});

// ── Preview sequence (without saving) ────────────────────────────────────────
router.post('/sequence/preview', async (req, res) => {
  const { lead } = req.body;
  if (!lead) return res.status(400).json({ error: 'lead object required' });
  try {
    const sequence = await buildSequence({ id: 'preview', ...lead });
    res.json({ sequence });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Instantly: validate key ──────────────────────────────────────────────────
router.get('/instantly/validate', async (req, res) => {
  try {
    const result = await validateApiKey();
    res.json(result);
  } catch (e) {
    res.json({ valid: false, error: e.message });
  }
});

// ── Instantly: list campaigns ────────────────────────────────────────────────
router.get('/instantly/campaigns', async (req, res) => {
  try {
    const data = await listCampaigns();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Instantly: push one lead ─────────────────────────────────────────────────
router.post('/instantly/push/:leadId', async (req, res) => {
  const { campaign_id } = req.body;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });

  const lead = getLead(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.email) return res.status(400).json({ error: 'Lead has no email' });

  try {
    const sequence = getSequence(lead.id);
    const result = await pushLeadToCampaign(campaign_id, lead, sequence);
    updateLeadStatus(lead.id, 'sent', {
      sent_at: new Date().toISOString(),
      instantly_campaign_id: campaign_id,
    });
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Instantly: bulk push ──────────────────────────────────────────────────────
router.post('/instantly/push-bulk', async (req, res) => {
  const { campaign_id, tier, trade, limit = 100 } = req.body;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });

  const leads = getLeads({ status: 'sequenced', tier: tier ? Number(tier) : undefined, trade });
  const eligible = leads.filter(l => l.email).slice(0, Number(limit));

  // Build sequences map
  const sequencesMap = {};
  for (const l of eligible) {
    const seq = getSequence(l.id);
    if (seq) sequencesMap[l.id] = seq;
  }

  res.json({ message: `Pushing ${eligible.length} leads to Instantly`, status: 'running' });

  try {
    const result = await pushBulkLeads(campaign_id, eligible, sequencesMap);
    for (const l of eligible) {
      updateLeadStatus(l.id, 'sent', {
        sent_at: new Date().toISOString(),
        instantly_campaign_id: campaign_id,
      });
    }
    console.log('[push-bulk]', result);
  } catch (e) {
    console.error('[push-bulk] failed:', e.message);
  }
});

// ── Instantly: webhook receiver (reply/open/click tracking) ─────────────────
router.post('/instantly/webhook', express.json(), (req, res) => {
  const event = req.body;
  console.log('[Instantly webhook]', event?.event_type, event?.lead_email);

  const db = getDb();
  if (event?.lead_email) {
    const lead = db.prepare('SELECT * FROM leads WHERE email=?').get(event.lead_email);
    if (lead) {
      const newStatus = event.event_type === 'reply_received' ? 'replied'
        : event.event_type === 'meeting_booked' ? 'booked'
        : lead.status;
      if (newStatus !== lead.status) {
        updateLeadStatus(lead.id, newStatus);
        console.log(`[webhook] Lead ${lead.email} → ${newStatus}`);
      }
    }
  }
  res.json({ ok: true });
});

// ── Corpus: trade patterns ────────────────────────────────────────────────────
router.get('/corpus/trades', (req, res) => {
  res.json({ trades: ALL_TRADES });
});

router.get('/corpus/:trade', async (req, res) => {
  try {
    const patterns = await loadTradePatterns(req.params.trade);
    res.json(patterns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
