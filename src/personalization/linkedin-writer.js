import 'dotenv/config';
import { getTradeContext } from '../corpus/loader.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4-6';

async function callLLM(prompt, maxTokens = 300) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM LinkedIn call failed: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function stripJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const j = text.match(/\{[\s\S]*\}/);
  return j ? j[0] : text;
}

// LinkedIn connection request note (300 char max)
export async function writeConnectionNote(lead, tradePatterns) {
  const ctx = tradePatterns?.context || getTradeContext(lead.trade);
  const pain = ctx.pain_points[0];

  const prompt = `Write a LinkedIn connection request note for a B2B cold outreach.

Prospect: ${lead.first_name || lead.company_name}, ${lead.title || 'Estimator'} at ${lead.company_name} (${lead.trade || 'construction'} company)
My product: Beam AI — AI construction takeoff software
Pain I'm solving: ${pain}

Rules:
- MAX 280 characters (LinkedIn limit)
- Sound human, not salesy
- Reference their trade specifically
- No "I noticed your profile" opener
- Output ONLY the note text, no JSON, no quotes`;

  return callLLM(prompt, 150);
}

// LinkedIn follow-up DM after connection accepted (D3 in sequence)
export async function writeLinkedInDM(lead, tradePatterns) {
  const ctx = tradePatterns?.context || getTradeContext(lead.trade);
  const hook = ctx.value_hooks[0];

  const prompt = `Write a LinkedIn DM to send after a connection request was accepted.

Prospect: ${lead.first_name || lead.company_name} at ${lead.company_name} (${lead.trade || 'construction'})
Product: Beam AI — AI construction takeoff software
Value: ${hook}

Rules:
- Under 100 words
- Appreciate the connection briefly (1 line max)
- Lead with the outcome/result, not the product name
- One soft CTA: "Happy to share how it works if useful"
- Output ONLY raw JSON: {"dm": "..."}`;

  const raw = await callLLM(prompt, 250);
  try {
    const stripped = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    return JSON.parse(stripped);
  } catch {
    return { dm: raw };
  }
}
