import 'dotenv/config';
import { getTradeContext } from '../corpus/loader.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_T1 = 'anthropic/claude-sonnet-4-6';
const MODEL_T2 = 'google/gemini-2.5-pro-preview-06-05';

async function callLLM(model, prompt, maxTokens = 800) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function stripJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const j = text.match(/\{[\s\S]*\}/);
  return j ? j[0] : text;
}

// Tier 1 — fully custom per lead, Claude writes every word
export async function writeTier1Email(lead, tradePatterns) {
  const ctx = tradePatterns.context;
  const pain = ctx.pain_points.slice(0, 2).join('; ');
  const hook = ctx.value_hooks[0];
  const social = `companies like ${lead.company_name} in ${lead.trade || 'construction'}`;

  const prompt = `You are an expert B2B cold email writer for Beam AI, an AI-powered construction takeoff software.

Write a hyper-personalized cold email to book a 15-minute discovery call. Output ONLY valid JSON.

PROSPECT:
- Name: ${lead.first_name || 'there'}
- Company: ${lead.company_name}
- Title: ${lead.title || 'Owner/Estimator'}
- Industry: ${lead.industry || lead.trade}
- Company size: ${lead.headcount ? `${lead.headcount} employees` : 'SMB'}
- Location: ${lead.city ? `${lead.city}, ` : ''}${lead.country || 'US'}

TRADE PAIN POINTS (use these to make it specific):
${pain}

VALUE HOOK:
${hook}

RULES:
- Under 150 words total (body)
- First sentence names a specific pain they feel — do NOT start with "I" or "My name is"
- Mention their company name once
- One clear CTA: "Worth a 15-minute call this week?"
- NO buzzwords: "cutting-edge", "revolutionary", "game-changing", "excited to"
- Sound like a human peer, not a sales robot
- PS line adds social proof (mention a similar company type)

OUTPUT JSON (no markdown, just raw JSON):
{
  "subject_a": "...",
  "subject_b": "...",
  "body": "...",
  "ps": "..."
}`;

  const raw = await callLLM(MODEL_T1, prompt, 600);
  try {
    return JSON.parse(stripJson(raw));
  } catch {
    return { subject_a: `Quick question, ${lead.first_name || lead.company_name}`, subject_b: `Re: your takeoff process`, body: raw, ps: '' };
  }
}

// Tier 1 follow-up email (D5 — adds case study angle)
export async function writeTier1Followup(lead, tradePatterns) {
  const ctx = tradePatterns.context;

  const prompt = `Write a short B2B follow-up cold email for Beam AI construction takeoff AI.

This is email #2 in the sequence (sent 5 days after the first cold email with no reply).

PROSPECT: ${lead.first_name || lead.company_name}, ${lead.title || 'Estimator'} at ${lead.company_name} (${lead.trade || 'construction'})

ANGLE: Add a concrete result angle — reference that similar ${lead.trade || 'construction'} companies have cut takeoff time by 60-70%.

RULES:
- Under 80 words
- Reference the first email briefly ("sent you a note last week")
- Lead with the result/outcome, not the product
- End with the same CTA: "15 minutes this week?"
- Output ONLY raw JSON: {"subject": "...", "body": "..."}`;

  const raw = await callLLM(MODEL_T1, prompt, 300);
  try {
    return JSON.parse(stripJson(raw));
  } catch {
    return { subject: `Re: your takeoff process`, body: raw };
  }
}

// Tier 1 breakup email (D14 — last touch)
export async function writeTier1Breakup(lead) {
  const prompt = `Write a B2B "breakup" cold email — the final email in a sequence.

PROSPECT: ${lead.first_name || lead.company_name} at ${lead.company_name}
PRODUCT: Beam AI — AI construction takeoff software

RULES:
- Under 60 words
- Acknowledge this is the last email, give them an easy out
- Leave the door open for the future
- No pressure, no guilt
- Output ONLY raw JSON: {"subject": "...", "body": "..."}`;

  const raw = await callLLM(MODEL_T1, prompt, 200);
  try {
    return JSON.parse(stripJson(raw));
  } catch {
    return { subject: `Closing the loop`, body: raw };
  }
}

// Tier 2 — trade-segmented, faster/cheaper (Gemini), reusable template with signal injection
export async function writeTier2Email(lead, tradePatterns) {
  const ctx = tradePatterns.context;
  const pain = ctx.pain_points[0];
  const hook = ctx.value_hooks[0];

  const prompt = `Write a B2B cold email for Beam AI construction takeoff AI.

PROSPECT:
- First name: ${lead.first_name || 'there'}
- Company: ${lead.company_name}
- Trade/Industry: ${lead.trade || lead.industry || 'construction'}

PAIN: ${pain}
VALUE: ${hook}

Output ONLY raw JSON:
{
  "subject": "...",
  "body": "..."
}

Rules: under 120 words, direct, one CTA ("15 min this week?"), no buzzwords.`;

  const raw = await callLLM(MODEL_T2, prompt, 400);
  try {
    return JSON.parse(stripJson(raw));
  } catch {
    const fallback = buildTier3Template(lead);
    return { subject: fallback.subject, body: fallback.body };
  }
}

// Tier 3 — pure template merge, no LLM
export function buildTier3Template(lead) {
  const name = lead.first_name || lead.company_name;
  const trade = lead.trade || 'construction';
  return {
    subject: `Cutting takeoff time for ${lead.company_name}`,
    body: `Hi ${name},

Quick question — how long does a typical ${trade} takeoff take your team right now?

Beam AI automates construction takeoffs end-to-end. Most ${trade} contractors using us have cut takeoff time by 60% and doubled their bid volume.

Worth 15 minutes to see if it fits ${lead.company_name}?

Best,
[Sender]`,
  };
}
