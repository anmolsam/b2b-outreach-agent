import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { join } from 'path';

const DB_PATH = new URL('../../data/leads.db', import.meta.url).pathname;
mkdirSync(new URL('../../data', import.meta.url).pathname, { recursive: true });

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      company_name TEXT,
      domain TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      linkedin_url TEXT,
      title TEXT,
      industry TEXT,
      headcount INTEGER,
      country TEXT,
      revenue TEXT,
      trade TEXT,
      icp_score INTEGER DEFAULT 0,
      icp_status TEXT DEFAULT 'pending',
      tier INTEGER DEFAULT 3,
      status TEXT DEFAULT 'new',
      instantly_lead_id TEXT,
      instantly_campaign_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      enriched_at TEXT,
      sequenced_at TEXT,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      trade TEXT,
      tier INTEGER,
      email_1_subject TEXT,
      email_1_body TEXT,
      email_2_subject TEXT,
      email_2_body TEXT,
      email_3_subject TEXT,
      email_3_body TEXT,
      linkedin_note TEXT,
      linkedin_followup TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      type TEXT,
      data TEXT,
      ts TEXT DEFAULT (datetime('now'))
    );
  `);
  return _db;
}

export function upsertLead(lead) {
  const db = getDb();
  db.prepare(`
    INSERT INTO leads (id, company_name, domain, first_name, last_name, email, linkedin_url,
      title, industry, headcount, country, revenue, trade, icp_score, icp_status, tier, status,
      created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      company_name=excluded.company_name, domain=excluded.domain,
      first_name=excluded.first_name, last_name=excluded.last_name,
      email=excluded.email, linkedin_url=excluded.linkedin_url,
      title=excluded.title, industry=excluded.industry,
      headcount=excluded.headcount, country=excluded.country,
      revenue=excluded.revenue, trade=excluded.trade,
      icp_score=excluded.icp_score, icp_status=excluded.icp_status,
      tier=excluded.tier, status=excluded.status
  `).run(
    lead.id, lead.company_name, lead.domain, lead.first_name, lead.last_name,
    lead.email, lead.linkedin_url, lead.title, lead.industry, lead.headcount,
    lead.country, lead.revenue, lead.trade, lead.icp_score, lead.icp_status,
    lead.tier, lead.status
  );
}

export function updateLeadStatus(id, status, extra = {}) {
  const db = getDb();
  const sets = ['status=?'];
  const vals = [status];
  if (extra.enriched_at) { sets.push('enriched_at=?'); vals.push(extra.enriched_at); }
  if (extra.sequenced_at) { sets.push('sequenced_at=?'); vals.push(extra.sequenced_at); }
  if (extra.sent_at) { sets.push('sent_at=?'); vals.push(extra.sent_at); }
  if (extra.instantly_lead_id) { sets.push('instantly_lead_id=?'); vals.push(extra.instantly_lead_id); }
  if (extra.instantly_campaign_id) { sets.push('instantly_campaign_id=?'); vals.push(extra.instantly_campaign_id); }
  vals.push(id);
  db.prepare(`UPDATE leads SET ${sets.join(',')} WHERE id=?`).run(...vals);
}

export function saveSequence(seq) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO sequences
      (id, lead_id, trade, tier, email_1_subject, email_1_body, email_2_subject, email_2_body,
       email_3_subject, email_3_body, linkedin_note, linkedin_followup, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  `).run(
    seq.id, seq.lead_id, seq.trade, seq.tier,
    seq.email_1_subject, seq.email_1_body,
    seq.email_2_subject, seq.email_2_body,
    seq.email_3_subject, seq.email_3_body,
    seq.linkedin_note, seq.linkedin_followup
  );
}

export function getLeads(filters = {}) {
  const db = getDb();
  let q = 'SELECT * FROM leads';
  const conditions = [];
  const vals = [];
  if (filters.status) { conditions.push('status=?'); vals.push(filters.status); }
  if (filters.tier) { conditions.push('tier=?'); vals.push(filters.tier); }
  if (filters.trade) { conditions.push('trade=?'); vals.push(filters.trade); }
  if (conditions.length) q += ' WHERE ' + conditions.join(' AND ');
  q += ' ORDER BY created_at DESC LIMIT 500';
  return db.prepare(q).all(...vals);
}

export function getLead(id) {
  return getDb().prepare('SELECT * FROM leads WHERE id=?').get(id);
}

export function getSequence(leadId) {
  return getDb().prepare('SELECT * FROM sequences WHERE lead_id=? ORDER BY created_at DESC LIMIT 1').get(leadId);
}

export function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM leads').get().n;
  const byStatus = db.prepare("SELECT status, COUNT(*) as n FROM leads GROUP BY status").all();
  const byTier = db.prepare("SELECT tier, COUNT(*) as n FROM leads GROUP BY tier").all();
  const byTrade = db.prepare("SELECT trade, COUNT(*) as n FROM leads WHERE trade IS NOT NULL GROUP BY trade ORDER BY n DESC").all();
  return { total, byStatus, byTier, byTrade };
}

export function logEvent(leadId, type, data) {
  const db = getDb();
  db.prepare('INSERT INTO events (id, lead_id, type, data) VALUES (?,?,?,?)').run(
    Math.random().toString(36).slice(2), leadId, type, JSON.stringify(data)
  );
}
