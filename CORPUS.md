# Corpus Intelligence

How the trade pattern library works and how to improve it over time.

---

## What the Corpus Is

The outreach corpus is mined from the `beam-predictive-sales-agent` project — specifically:

```
beam-predictive-sales-agent/data/corpus/
├── clusters/
│   ├── hvac.json        17 deals · 2 clusters · embedding centroids
│   ├── roofing.json      5 deals · 1 cluster
│   ├── steel.json        ...
│   └── [12 more trades]
└── vectors/
    ├── 58366906924.json  48 transcript chunks · best_ae_line · best_prospect_line
    └── [200+ more deals]
```

---

## Cluster File Structure

```json
{
  "trade": "hvac",
  "deal_count": 17,
  "won": 0,
  "clusters": [
    {
      "cluster_id": 0,
      "deal_count": 13,
      "chunk_count": 340,
      "deal_ids": ["58237937704", "..."],
      "patterns": {
        "phase": "DISCOVERY",
        "avg_call_pct": 55,
        "win_rate": 0,
        "winning_lines": [],
        "objections": [],
        "buying_signals": [],
        "has_objection_pct": 7,
        "has_close_pct": 10
      }
    }
  ]
}
```

**Why `winning_lines` and `objections` are empty:** The current pipeline has 0 Closed Won deals (win rate ~2%). The cluster patterns are populated from Closed Won deal chunks. As deals close and the predictive agent processes them, these arrays will fill up with real winning language.

---

## Vector File Structure

```json
{
  "deal_id": "58366906924",
  "deal_name": "Dunsteel Group - Blake",
  "trade": "steel",
  "outcome": "IN_PROGRESS",
  "chunks": [
    {
      "chunk_idx": 0,
      "turn_start": 0,
      "turn_end": 3,
      "call_pct": 0,
      "text": "Blake Dunlop: Can you hear me?...",
      "word_count": 16,
      "has_objection": false,
      "has_close": false,
      "has_competitor": false,
      "ae_talk_ratio": 0.625,
      "best_ae_line": "I can. So can you hear me? Yes.",
      "best_prospect_line": "Sorry. Can you hear me?",
      "embedding": [...]
    }
  ]
}
```

The loader mines `best_prospect_line` from chunks where `has_objection=true` (these are real objections buyers raised) and `best_ae_line` from chunks where `has_close=true` (these are real closing lines that worked).

---

## Loading Priority (loader.js)

```
1. clusters/[trade].json → patterns.winning_lines / objections / buying_signals
   (populated only when Closed Won deals exist for that trade)

2. vectors/*.json → chunks where has_objection || has_close, per trade
   (always available — mines raw transcript chunks)
   Limit: sample 30 files, 20 chunks each — fast enough for real-time use

3. TRADE_CONTEXT[trade] — hardcoded expert knowledge per trade
   (always available as baseline — never empty)

Result: merged context object with:
  - pain_points     (from hardcoded context)
  - value_hooks     (from hardcoded context)
  - urgency_triggers (from hardcoded context)
  - winning_lines   (from clusters or vectors)
  - objections      (from clusters or vectors)
  - buying_signals  (from clusters or vectors)
  - deal_count      (from clusters file)
  - won             (from clusters file)
```

---

## Hardcoded Trade Context

Extracted from domain knowledge + HVAC transcript analysis (54 calls, Jan–Mar 2026):

| Trade | Key Pain | Top Value Hook | Avg Deal Size |
|-------|----------|----------------|---------------|
| HVAC | Takeoffs take 2–3 days, estimators behind | Hours not days on HVAC takeoffs | $10k–$50k/yr |
| Plumbing | Can't bid > 3–4 jobs/week, fixture counts take all day | 60–70% reduction in takeoff time | $10k–$40k/yr |
| Electrical | 5–8 hrs per large commercial set, device counts | Counts devices and runs in minutes | $10k–$60k/yr |
| Roofing | Manual measurement, slope calc, material waste | Automates area + pitch + linear measurements | $8k–$30k/yr |
| Steel | Connection details time-intensive, revision rounds | Structural steel members from IFC/PDF | $15k–$70k/yr |
| Concrete | Volume calcs complex, form work underestimated | Volume + rebar + formwork automatically | $10k–$45k/yr |
| Flooring | Complex area calcs, material waste guesswork | Net areas + waste factors from drawings | $8k–$25k/yr |
| Painting | Wall area calcs tedious, deductions manual | Surfaces + deductions + quantities automatically | $6k–$20k/yr |
| Insulation | MEP pipe insulation linear footage slow | Quantities from MEP/architectural in minutes | $8k–$25k/yr |

---

## How to Improve the Corpus Over Time

### Short-term (no code changes needed)

1. **Add won emails** — when a cold email books a meeting, save the email to a `data/winning-emails/[trade]/` folder. The next version of the loader can mine these for subject line patterns.

2. **Add objection-response pairs** — when a prospect objects ("we already use Bluebeam") and you respond successfully, save the pair. The corpus becomes a live objection library.

3. **Tag closed won deals** — in beam-predictive-sales-agent, mark deals with `outcome: 'WON'`. The cluster pipeline will start populating `winning_lines`.

### Medium-term (small code changes)

4. **A/B result feed-in** — once Instantly A/B results come in (subject A vs B open rates), add a `POST /api/corpus/ab-result` endpoint that stores which subject lines win per trade. The email writer can then prefer the winning subject pattern.

5. **Reply analysis** — when a lead replies, store the reply text. A background job reads reply sentiment and flags whether the pain point in the original email was "right" or "wrong". Update trade pain point weights accordingly.

### Long-term (self-improving loop)

6. **Automatic winning line extraction** — schedule a weekly job: for every lead that booked a meeting, extract the D1 email body and run it through Claude to identify which sentence was the "hook". Add that sentence to the trade's `winning_lines` corpus.

7. **ICP model retraining** — every time a new batch of pilots signs up, re-run `build-icp.js` in icp-match and copy the updated `icp-profile.json` here.

---

## Corpus API

```bash
# List all trades
GET /api/corpus/trades

# Get full context for a trade
GET /api/corpus/hvac
→ {
    "trade": "hvac",
    "deal_count": 17,
    "won": 0,
    "winning_lines": [...],
    "objections": [...],
    "buying_signals": [...],
    "context": {
      "pain_points": [...],
      "urgency_triggers": [...],
      "value_hooks": [...],
      "competitor_context": "...",
      "avg_deal_size": "$10k–$50k/year"
    }
  }
```
