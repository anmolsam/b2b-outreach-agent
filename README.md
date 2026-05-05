# B2B Outreach Agent

> Hyper-personalized cold outreach at 10,000 emails/day — Signal → ICP → Corpus → AI → Send → Close

Built for construction & B2B SaaS GTM. Combines ZoomInfo enrichment, a custom ICP model trained on 1,065 pilot customers, trade-specific pain point intelligence from real deal transcripts, and Claude/Gemini AI personalization — pushing personalized sequences to Instantly (email) and HeyReach (LinkedIn).

**Stack:** Node.js 24 ESM · Express · SQLite · OpenRouter (Claude Sonnet 4.6 + Gemini 2.5 Pro) · ZoomInfo GTM API · Instantly API

---

## What It Does

```
ZoomInfo / CSV import
        ↓
Enrich (company data, tech stack, revenue)
        ↓
ICP Score (0–100) — trained on 1,065 pilot domains
        ↓
Trade Detection (14 construction trades)
        ↓
Corpus Retrieval — pain points, objections, winning language per trade
        ↓
AI Personalization (tiered):
  Tier 1: Claude Sonnet — fully custom email, ~$0.003/lead
  Tier 2: Gemini 2.5  — trade-segmented, ~$0.0005/lead
  Tier 3: Template     — name/company merge, $0
        ↓
5-Touch Sequence: D1 email → D3 LinkedIn → D5 follow-up → D8 call → D14 breakup
        ↓
Push to Instantly (email, 10k/day) + LinkedIn DM copy for HeyReach
        ↓
Webhook: reply/open/meeting tracking → lead status updates
        ↓
Meeting booked → Beam Qual Agent scores the call → Closed Won
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/anmolsam/b2b-outreach-agent.git
cd b2b-outreach-agent

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Fill in: OPENROUTER_API_KEY, ZOOMINFO_CLIENT_ID, ZOOMINFO_CLIENT_SECRET, INSTANTLY_API_KEY

# 4. Run
node src/server.js
# → http://localhost:3002
```

---

## Environment Variables

```env
# Required for AI personalization (Tier 1 + Tier 2)
OPENROUTER_API_KEY=sk-or-...

# Required for company enrichment
ZOOMINFO_CLIENT_ID=...
ZOOMINFO_CLIENT_SECRET=...

# Required for email sending
INSTANTLY_API_KEY=...

# Optional — path to beam-predictive-sales-agent corpus for pattern mining
CORPUS_PATH=/Users/anmol/beam-predictive-sales-agent/data/corpus

PORT=3002
```

---

## API Reference

### Leads

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/leads` | List leads. Query: `?status=enriched&tier=1&trade=hvac` |
| `GET` | `/api/leads/:id` | Get lead + sequence |
| `POST` | `/api/leads` | Add single lead (JSON body) |
| `POST` | `/api/import` | Import CSV (multipart, field: `file`) |
| `GET` | `/api/stats` | Dashboard stats (totals by status, tier, trade) |

### Enrichment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/enrich` | Enrich single domain. Body: `{domain, lead_id}` |
| `POST` | `/api/enrich-all` | Async: enrich all `status=new` leads |

### Sequences

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sequence/:leadId` | Generate + save 5-touch sequence for one lead |
| `POST` | `/api/sequence-all` | Async bulk sequence. Body: `{tier, trade, limit}` |
| `POST` | `/api/sequence/preview` | Preview without saving. Body: `{lead: {...}}` |

### Instantly

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/instantly/validate` | Check API key |
| `GET` | `/api/instantly/campaigns` | List campaigns |
| `POST` | `/api/instantly/push/:leadId` | Push one lead. Body: `{campaign_id}` |
| `POST` | `/api/instantly/push-bulk` | Async bulk push. Body: `{campaign_id, tier, trade, limit}` |
| `POST` | `/api/instantly/webhook` | Receive Instantly events (reply, open, meeting) |

### Corpus

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/corpus/trades` | List all supported trades |
| `GET` | `/api/corpus/:trade` | Get pain points, value hooks, objections for a trade |

---

## CSV Import Format

```csv
company_name,domain,email,first_name,last_name,title,industry,headcount,country,linkedin_url
Acme HVAC,acmehvac.com,john@acmehvac.com,John,Smith,Estimator,HVAC,35,United States,linkedin.com/in/johnsmith
```

Accepts any combination of these columns. Trade is auto-detected from `industry` + `company_name`.

---

## ICP Model

Trained on 1,065 pilot customers from icp-match project.

| Signal | Weight | ICP Range |
|--------|--------|-----------|
| Country (geo) | 30 pts | US, CA, AU, UK, IE, SA |
| Industry | 40 pts | Construction (76%), Manufacturing, Retail + all 14 trades |
| Headcount | 30 pts | 6–271 employees (partial credit below range) |

**Score → Tier:**
- 70–100 → Tier 1 (Strong Fit) — full Claude personalization
- 40–69 → Tier 2 (Possible Fit) — Gemini trade-segmented
- 0–39 → Tier 3 — template merge

---

## 5-Touch Sequence Schedule

| Day | Channel | Touch | Who |
|-----|---------|-------|-----|
| D1 | Email (Instantly) | Cold intro — trade pain hook | All tiers |
| D3 | LinkedIn (HeyReach) | Connection request + 280-char note | All tiers |
| D5 | Email (Instantly) | Follow-up — result/case study angle | All tiers |
| D8 | Call (Nooks) | AI dialer — Tier 1 only | Tier 1 |
| D14 | Email (Instantly) | Breakup — leave door open | All tiers |

---

## Supported Trades (14)

`hvac` · `plumbing` · `electrical` · `roofing` · `steel` · `concrete` · `flooring` · `painting` · `insulation` · `earthworks` · `gc` · `masonry` · `construction` · (generic fallback)

Each trade has: pain points, urgency triggers, value hooks, objection hooks, social proof, avg deal size.

---

## Instantly Webhook Setup

1. In Instantly → Settings → Webhooks → Add webhook
2. URL: `https://your-domain.com/api/instantly/webhook`
3. Events: `reply_received`, `email_opened`, `meeting_booked`

The agent auto-updates lead status: `sent → replied → booked`

---

## Related Projects

| Repo | What |
|------|------|
| [beam-qualification-agent](https://github.com/anmolsam/beam-qualification-agent) | Post-call BANT scoring — what happens after meeting is booked |
| [beam-predictive-sales-agent](../beam-predictive-sales-agent) | Corpus source — deal transcripts, trade clusters, AE patterns |
| [icp-match](../icp-match) | ICP profile source — 1,065 pilot customers, ZoomInfo enrichment |

---

*anmol@attentive.ai · 2026*
