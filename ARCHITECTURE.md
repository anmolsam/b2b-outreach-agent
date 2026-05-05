# Architecture — B2B Outreach Agent

---

## The Problem

Sending 10,000 cold emails per day is easy. Sending 10,000 *personalized* emails per day is not — because true per-lead personalization (read the prospect's LinkedIn, research their company, write a custom email) takes 5–10 minutes per lead. At 10k/day that's 833 person-hours of work.

The solution is **tiered personalization**: spend AI compute proportional to lead quality. Strong ICP fits get the full Claude treatment. Possible fits get trade-segmented templates. Broad lists get name-merge. The corpus makes all three tiers smarter than generic templates because the pain points and language come from real transcripts of buyers in those exact trades.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Browser  (frontend/index.html)                          │
│  Dashboard │ Leads │ Sequences │ Corpus │ Instantly │ Settings              │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │  HTTP REST (localhost:3002)
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              Express Server  (src/server.js)                                │
│              src/api/routes.js  (20+ endpoints)                             │
└──┬──────────────────┬──────────────┬──────────────┬────────────────────────┘
   │                  │              │              │
   ▼                  ▼              ▼              ▼
┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐
│Enrichment│  │Personalization│ │ Corpus   │  │  Sending     │
│          │  │              │  │          │  │              │
│zoominfo  │  │email-writer  │  │loader.js │  │instantly.js  │
│icp-scorer│  │linkedin-     │  │          │  │              │
│          │  │writer        │  │          │  │              │
│          │  │sequence-     │  │          │  │              │
│          │  │builder       │  │          │  │              │
└──┬───────┘  └──────┬───────┘  └────┬─────┘  └──────┬───────┘
   │                 │               │               │
   ▼                 ▼               ▼               ▼
ZoomInfo API    OpenRouter API   Local Corpus    Instantly API
(GTM enrich)   (Claude/Gemini)  (beam-predictive (campaigns,
                                 -sales-agent     leads, webhooks)
                                 data/corpus)
                            │
                            ▼
               ┌────────────────────┐
               │  SQLite DB         │
               │  data/leads.db     │
               │                    │
               │  leads             │
               │  sequences         │
               │  events            │
               └────────────────────┘
```

---

## Data Flow — Full Pipeline

### Step 1: Lead Ingestion

**Two paths:**

**CSV Import** (`POST /api/import`):
```
CSV file (multer upload)
    ↓
csv-parse: parse rows, map column aliases
    ↓
detectTrade(industry, company_name) → trade label
    ↓
upsertLead() → leads table (status='new', tier=3, icp_score=0)
```

**Manual / API** (`POST /api/leads`):
```
JSON body with known fields
    ↓
detectTrade() → auto-label trade
    ↓
upsertLead() → leads table
```

---

### Step 2: Enrichment + ICP Scoring

**Single** (`POST /api/enrich`):
```
domain → enrichCompanyByDomain(domain)
    ↓
ZoomInfo GTM API /companies/enrich
    Okta Client Credentials auth (55-min token cache)
    Content-Type: application/vnd.api+json
    Returns: name, industry, employeeCount, revenueRange, country, state, city, techStack
    ↓
scoreCompany(enriched)
    Geo check (30 pts): country in {US, CA, AU, UK, IE, SA}
    Industry check (40 pts): matches ICP industries OR any of 30 construction trades
    Headcount check (30 pts): 6–271 = full, below range = partial
    → icpScore (0–100), icpStatus (ICP / Not ICP / Needs Review), tier (1/2/3), trade
    ↓
upsertLead() with enriched data + scores
updateLeadStatus() → status='enriched', enriched_at=now
```

**Bulk async** (`POST /api/enrich-all`):
```
Responds 200 immediately
Background: for each status='new' lead with domain:
    enrichCompanyByDomain() → scoreCompany() → upsertLead()
    300ms delay between calls (ZoomInfo rate limit)
```

---

### Step 3: Sequence Generation

**Single** (`POST /api/sequence/:leadId`):
```
getLead(id)
    ↓
loadTradePatterns(trade):
    Read clusters/[trade].json → winning_lines, objections, buying_signals
    If empty: mine best_prospect_line / best_ae_line from vectors/
    Merge with hardcoded TRADE_CONTEXT (pain points, value hooks, urgency triggers)
    ↓
buildSequence(lead):

    if tier === 1:
        [parallel]:
            writeTier1Email()     → Claude Sonnet 4.6
            writeTier1Followup()  → Claude Sonnet 4.6
            writeTier1Breakup()   → Claude Sonnet 4.6
            writeConnectionNote() → Claude Sonnet 4.6
            writeLinkedInDM()     → Claude Sonnet 4.6
        5 LLM calls, ~$0.003 total

    if tier === 2:
        writeTier2Email() → Gemini 2.5 Pro
        Template-based follow-up + breakup
        Template-based LinkedIn

    if tier === 3:
        buildTier3Template() → no LLM, pure string interpolation
        Template LinkedIn
    ↓
saveSequence() → sequences table
updateLeadStatus() → status='sequenced'
```

**Bulk async** (`POST /api/sequence-all`):
```
Responds 200 immediately
Background: for each status='enriched' lead (filtered by tier/trade/limit):
    buildSequence() → saveSequence() → updateLeadStatus()
    Tier 1: 2000ms delay (Claude calls take ~5s each)
    Tier 2: 200ms delay
    Tier 3: 200ms delay (no LLM, instant)
```

---

### Step 4: Instantly Push

**Bulk** (`POST /api/instantly/push-bulk`):
```
getLeads(status='sequenced', tier?, trade?)
Filter: must have email
Build sequencesMap: {leadId → sequence}
    ↓
pushBulkLeads(campaign_id, leads, sequencesMap):
    Batch leads into groups of 100
    POST /api/v1/lead/add?api_key=...
    Payload per lead:
        email, first_name, last_name, company_name, website
        personalization = email_1_body (Instantly injects this)
        custom_variables: trade, tier, linkedin_url, li_connection_note
    200ms between batches
    ↓
updateLeadStatus() → status='sent', instantly_campaign_id=...
```

---

### Step 5: Reply Tracking (Webhook)

```
Instantly fires POST to /api/instantly/webhook
Event types: reply_received, email_opened, email_clicked, meeting_booked
    ↓
Lookup lead by email in SQLite
If found: update status
    reply_received  → 'replied'
    meeting_booked  → 'booked'
```

---

## Personalization Tiers — Design Decisions

### Why 3 tiers instead of 1?

**Cost:** Claude Sonnet at $0.003/email × 10,000/day = $30/day. That's fine for top leads but unnecessary for a broad list where you don't even know the person fits.

**Speed:** Claude takes 5–10 seconds per email. At Tier 1 only, 10k/day requires 500 parallel Claude calls — expensive and slow. Tiers 2 and 3 handle volume; Tier 1 handles quality.

**Signal:** The ICP score tells you how much to invest. A 95/100 ICP lead in the right trade deserves Claude. A 35/100 lead from an unknown industry deserves a template.

### Why OpenRouter instead of direct Anthropic API?

Single key for Claude + Gemini + GPT-4o. The beam-qualification-agent already uses it. No separate Anthropic key management.

### Why Gemini for Tier 2?

Cheaper than Claude for high-volume batch generation. Gemini 2.5 Pro is strong enough for trade-segmented templates. Claude is reserved for Tier 1 where quality matters.

### Why not pre-generate all Tier 2 templates upfront?

Because Tier 2 still injects lead-specific signals (company name, city, headcount context) — it's not a pure template. The trade + company size context makes it feel personal even if the structure is reusable.

---

## ICP Model — Design

Built from 1,065 pilot customers enriched via ZoomInfo in `icp-match`.

**Scoring formula:**
```
Geo (30 pts):        country ∈ {US, CA, AU, UK, IE, SA}
Industry (40 pts):   industry matches topIndustries[] OR CONSTRUCTION_TRADES[]
Headcount (30 pts):  6 ≤ hc ≤ 271 → full; hc < 12 (2× min) → partial (15 pts)

Status:
  No country AND no industry → 'Needs Review'
  No geo match AND no industry match → 'Not ICP'
  score ≥ 70 → 'ICP'
  else → 'Not ICP'

Tier:
  score ≥ 70 → 1 (Strong Fit)
  score ≥ 40 → 2 (Possible Fit)
  else → 3 (Broad)
```

**Trade detection** runs independently of ICP scoring — it reads `industry` + `company_name` and maps to one of 14 trade keys. Trade drives which corpus patterns are used in personalization, regardless of ICP score.

---

## Corpus Intelligence — Design

The corpus comes from `beam-predictive-sales-agent/data/corpus/`:

```
corpus/
├── clusters/
│   ├── hvac.json         ← clustered deal patterns by trade
│   ├── roofing.json
│   └── ...               ← 14 trades
└── vectors/
    ├── 58366906924.json  ← per-deal: chunks with best_ae_line, best_prospect_line
    └── ...               ← 200+ deals
```

**Loading priority:**
1. Read `clusters/[trade].json` → extract `winning_lines`, `objections`, `buying_signals` from each cluster's `patterns`
2. If those are empty (not yet populated in the pipeline): mine `vectors/` — find chunks for that trade where `has_objection=true` or `has_close=true`, extract `best_prospect_line` / `best_ae_line`
3. Merge with `TRADE_CONTEXT[trade]` — the hardcoded pain points + value hooks written from domain knowledge of each trade

**Why hardcode pain points?**
The corpus vectors exist but the `winning_lines` and `objections` arrays in cluster patterns are currently empty (the mining pipeline hasn't run enough won deals yet — win rate is ~2%). The hardcoded context bridges that gap with expert knowledge about each trade while the corpus builds up over time. As the pipeline generates more Closed Won deals, the hardcoded fallbacks become less important.

---

## Database Schema

```sql
-- leads: one row per prospect
CREATE TABLE leads (
  id                   TEXT PRIMARY KEY,
  company_name         TEXT,
  domain               TEXT,
  first_name           TEXT,
  last_name            TEXT,
  email                TEXT,
  linkedin_url         TEXT,
  title                TEXT,
  industry             TEXT,       -- raw from ZoomInfo
  headcount            INTEGER,
  country              TEXT,
  revenue              TEXT,       -- ZoomInfo revenueRange string
  trade                TEXT,       -- detected: hvac, roofing, etc.
  icp_score            INTEGER DEFAULT 0,
  icp_status           TEXT DEFAULT 'pending',  -- ICP / Not ICP / Needs Review / pending
  tier                 INTEGER DEFAULT 3,        -- 1 / 2 / 3
  status               TEXT DEFAULT 'new',       -- new / enriched / sequenced / sent / replied / booked
  instantly_lead_id    TEXT,
  instantly_campaign_id TEXT,
  created_at           TEXT,
  enriched_at          TEXT,
  sequenced_at         TEXT,
  sent_at              TEXT
);

-- sequences: the 5-touch content per lead
CREATE TABLE sequences (
  id                   TEXT PRIMARY KEY,
  lead_id              TEXT NOT NULL,
  trade                TEXT,
  tier                 INTEGER,
  email_1_subject      TEXT,   -- D1 cold email subject (A/B: also email_1_subject_b)
  email_1_body         TEXT,   -- D1 cold email body
  email_2_subject      TEXT,   -- D5 follow-up subject
  email_2_body         TEXT,   -- D5 follow-up body
  email_3_subject      TEXT,   -- D14 breakup subject
  email_3_body         TEXT,   -- D14 breakup body
  linkedin_note        TEXT,   -- D3 connection request note (280 chars)
  linkedin_followup    TEXT,   -- D3 follow-up DM after connection accepted
  created_at           TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

-- events: webhook events and manual actions
CREATE TABLE events (
  id        TEXT PRIMARY KEY,
  lead_id   TEXT,
  type      TEXT,   -- reply_received / email_opened / meeting_booked / manually_enriched
  data      TEXT,   -- JSON blob
  ts        TEXT
);
```

---

## File Map

```
b2b-outreach-agent/
├── src/
│   ├── server.js                     Express on :3002, static frontend, init DB
│   ├── api/
│   │   └── routes.js                 20+ REST endpoints
│   ├── enrichment/
│   │   ├── zoominfo.js               ZoomInfo GTM API — Okta auth, single + batch enrich
│   │   └── icp-scorer.js             ICP model, trade detection, tier assignment
│   ├── corpus/
│   │   └── loader.js                 Trade patterns: clusters → vectors → hardcoded fallback
│   ├── personalization/
│   │   ├── email-writer.js           Tier 1 (Claude), Tier 2 (Gemini), Tier 3 (template)
│   │   ├── linkedin-writer.js        Connection note + follow-up DM
│   │   └── sequence-builder.js       Orchestrates 5-touch sequence per lead
│   ├── sending/
│   │   └── instantly.js              Instantly API: campaigns, bulk push, webhook
│   └── db/
│       └── leads.js                  SQLite (node:sqlite built-in), all DB helpers
├── frontend/
│   └── index.html                    Single-file dark dashboard (no build step)
├── data/
│   ├── icp-profile.json              ICP model built from 1,065 pilot domains (icp-match)
│   └── leads.db                      SQLite DB — gitignored, local only
├── .env.example
├── .gitignore
├── package.json                      ESM, Node 24+
├── README.md
├── ARCHITECTURE.md                   This file
└── PROMPTS.md                        Prompt design for each tier
```

---

## External APIs

| API | Auth | Used For | Rate Limits |
|-----|------|----------|-------------|
| ZoomInfo GTM | Okta Client Credentials (55-min token) | Company enrichment | 25/batch recommended |
| OpenRouter | Bearer token | Claude Sonnet (T1), Gemini 2.5 Pro (T2) | Per-model limits |
| Instantly | API key in query param | Campaign management, lead push, webhooks | 100/batch recommended |

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Daily email capacity | 10,000 (Instantly account-dependent) |
| Tier 1 volume target | ~500/day |
| Tier 2 volume target | ~3,000/day |
| Tier 3 volume target | ~6,500/day |
| Cost per Tier 1 email | ~$0.003 (Claude Sonnet) |
| Cost per Tier 2 email | ~$0.0005 (Gemini) |
| Cost per Tier 3 email | $0 (template, no LLM) |
| Cost per 10k/day | ~$3–5 AI + Instantly plan |
| ICP model accuracy | 84% Strong Fit on tested demo list |
| Supported trades | 14 construction verticals |
| Training data | 1,065 pilot customers, 5,360 pipeline deals, 54+ HVAC transcripts |
