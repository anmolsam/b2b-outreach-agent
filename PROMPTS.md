# Prompt Design — B2B Outreach Agent

---

## Philosophy

The goal is emails that don't read like emails — that sound like a peer who happens to know exactly what your estimating team is dealing with. The corpus gives us the language. The ICP score decides how much Claude time we spend. The tier system makes this economical at scale.

Three rules applied to every prompt:
1. **No buzzwords.** "Cutting-edge", "revolutionary", "excited to share" = instant delete.
2. **Pain first.** Start with something they feel, not something we sell.
3. **One CTA.** "Worth a 15-minute call this week?" — that's it.

---

## Tier 1 — Full Custom (Claude Sonnet 4.6)

**When:** ICP score ≥ 70. Strong Fit leads in the right trade and geo.

**What Claude gets:**
- Prospect: name, company, title, headcount, city, country
- Trade pain points: top 2 from corpus (specific to their trade)
- Value hook: the #1 outcome statement for their trade
- Rules: under 150 words, don't start with "I", mention company once, one CTA, no buzzwords, sound like a human peer

**What it outputs (JSON):**
```json
{
  "subject_a": "...",
  "subject_b": "...",
  "body": "...",
  "ps": "..."
}
```

Subject A/B gives you two variants for A/B testing in Instantly without a second Claude call.
The PS line adds social proof — Claude is instructed to reference a similar company type.

**Follow-up (D5):** Shorter Claude call — "sent you a note last week", lead with the result (60–70% time savings), same CTA.

**Breakup (D14):** Shortest Claude call — under 60 words, acknowledge it's the last email, no guilt, leave the door open.

---

## Tier 2 — Trade-Segmented (Gemini 2.5 Pro)

**When:** ICP score 40–69. Possible Fit.

**What Gemini gets:**
- Prospect: first name, company, trade
- Top pain point for that trade
- Top value hook for that trade

**Output (JSON):**
```json
{
  "subject": "...",
  "body": "..."
}
```

Simpler prompt, simpler output. Gemini handles this well and costs ~6× less than Claude.

Follow-up and breakup for Tier 2 are template-based (no LLM). The D1 personalization already did the heavy lifting — the follow-ups just need to reference the first email.

---

## Tier 3 — Template Merge (No LLM)

**When:** ICP score < 40, or unknown lead with no enrichment.

**Template:**
```
Subject: Cutting takeoff time for {company_name}

Hi {first_name},

Quick question — how long does a typical {trade} takeoff take your team right now?

Beam AI automates construction takeoffs end-to-end. Most {trade} contractors 
using us have cut takeoff time by 60% and doubled their bid volume.

Worth 15 minutes to see if it fits {company_name}?

Best,
[Sender]
```

No LLM call. Instant. The only personalization is name, company, and trade — but the trade specificity still makes it feel more targeted than a generic "we help construction companies" email.

---

## LinkedIn — Connection Note (Claude Sonnet 4.6)

**Character limit:** 280 (LinkedIn enforces this)

**What Claude gets:**
- Name, title, company, trade
- Top pain point for the trade
- Instruction: sound human, don't open with "I noticed your profile", reference their trade specifically

**Output:** Raw text (no JSON wrapper needed — just the note)

---

## LinkedIn — Follow-up DM (Claude Sonnet 4.6)

**When:** After connection is accepted (D3 in sequence)

**What Claude gets:**
- Company, trade
- Top value hook for the trade
- Instruction: under 100 words, appreciate connection briefly (1 line max), lead with outcome not product name, soft CTA only

**Output (JSON):**
```json
{
  "dm": "..."
}
```

---

## Trade Context Injected Into All Prompts

Each trade has a `TRADE_CONTEXT` object with:

| Field | Example (HVAC) |
|-------|----------------|
| `pain_points` | "takeoffs take 2–3 days per project, slowing down bid volume" |
| `urgency_triggers` | "bid deadline", "estimator backlog", "losing bids" |
| `value_hooks` | "Beam AI turns HVAC takeoffs around in hours, not days" |
| `competitor_context` | "most HVAC estimators still use Bluebeam or manual PDF markups" |
| `avg_deal_size` | "$10k–$50k/year" |

These are injected as context in the prompt — Claude uses them to write copy that sounds like it knows the trade.

---

## JSON Parsing Safety

Every LLM call goes through `stripJson()`:
1. Try to extract from ` ```json ... ``` ` code block
2. If not found, try to match first `{...}` block
3. If JSON.parse fails, fall back gracefully — use the raw text as the body, use a safe subject line fallback

This prevents one bad LLM response from breaking a bulk sequence run.

---

## Cost Model

| Tier | LLM | Calls/lead | Est. tokens | Cost/lead |
|------|-----|-----------|-------------|-----------|
| 1 | Claude Sonnet 4.6 | 5 | ~3,000 input + 600 output | ~$0.003 |
| 2 | Gemini 2.5 Pro | 1 | ~800 input + 200 output | ~$0.0005 |
| 3 | None | 0 | 0 | $0 |

At 500 Tier 1, 3,000 Tier 2, 6,500 Tier 3 per day:
- Tier 1: 500 × $0.003 = **$1.50/day**
- Tier 2: 3,000 × $0.0005 = **$1.50/day**
- Tier 3: $0
- **Total AI cost: ~$3/day for 10,000 leads**
