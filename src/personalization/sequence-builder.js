import { v4 as uuidv4 } from 'uuid';
import { loadTradePatterns } from '../corpus/loader.js';
import {
  writeTier1Email,
  writeTier1Followup,
  writeTier1Breakup,
  writeTier2Email,
  buildTier3Template,
} from './email-writer.js';
import { writeConnectionNote, writeLinkedInDM } from './linkedin-writer.js';

// Build full 5-touch sequence for a lead
// Touch points: D1 Email, D3 LI connection, D5 Email followup, D8 (call note), D14 Breakup email
export async function buildSequence(lead) {
  const trade = lead.trade || 'construction';
  const tier = lead.tier || 3;

  const patterns = await loadTradePatterns(trade);

  let email1, email2, email3, liNote, liDm;

  if (tier === 1) {
    [email1, email2, email3, liNote, liDm] = await Promise.all([
      writeTier1Email(lead, patterns),
      writeTier1Followup(lead, patterns),
      writeTier1Breakup(lead),
      writeConnectionNote(lead, patterns),
      writeLinkedInDM(lead, patterns),
    ]);
  } else if (tier === 2) {
    const t2 = await writeTier2Email(lead, patterns);
    email1 = t2;
    email2 = { subject: `Re: ${t2.subject}`, body: buildFollowupTemplate(lead) };
    email3 = { subject: `Closing the loop — ${lead.company_name}`, body: buildBreakupTemplate(lead) };
    liNote = buildLiNoteTemplate(lead);
    liDm = { dm: buildLiDmTemplate(lead) };
  } else {
    email1 = buildTier3Template(lead);
    email2 = { subject: `Re: ${email1.subject}`, body: buildFollowupTemplate(lead) };
    email3 = { subject: `Closing the loop`, body: buildBreakupTemplate(lead) };
    liNote = buildLiNoteTemplate(lead);
    liDm = { dm: buildLiDmTemplate(lead) };
  }

  const sequence = {
    id: uuidv4(),
    lead_id: lead.id,
    trade,
    tier,
    email_1_subject: email1.subject_a || email1.subject || '',
    email_1_body: email1.body || '',
    email_2_subject: email2.subject || '',
    email_2_body: email2.body || '',
    email_3_subject: email3.subject || '',
    email_3_body: email3.body || '',
    linkedin_note: typeof liNote === 'string' ? liNote : (liNote?.note || ''),
    linkedin_followup: liDm?.dm || '',
    // Extra: A/B subject and PS for Tier 1
    email_1_subject_b: email1.subject_b || '',
    email_1_ps: email1.ps || '',
  };

  return sequence;
}

function buildFollowupTemplate(lead) {
  const name = lead.first_name || lead.company_name;
  return `Hi ${name},

Sent you a note last week about Beam AI — just wanted to bump this up in case it got buried.

${lead.trade || 'Construction'} contractors using Beam AI have cut takeoff time by 60-70% and doubled their bid volume without adding headcount.

Happy to show you how it works for ${lead.company_name} specifically — 15 minutes?

Best,
[Sender]`;
}

function buildBreakupTemplate(lead) {
  const name = lead.first_name || lead.company_name;
  return `Hi ${name},

Last email from me — I don't want to clog your inbox.

If Beam AI ever becomes relevant to ${lead.company_name}'s estimating process, happy to reconnect.

Wishing you a strong quarter.

[Sender]`;
}

function buildLiNoteTemplate(lead) {
  const trade = lead.trade || 'construction';
  return `Hi ${lead.first_name || ''} — saw you're at ${lead.company_name}. I work with ${trade} estimating teams on takeoff automation. Would love to connect.`;
}

function buildLiDmTemplate(lead) {
  return `Thanks for connecting! Quick question — how long do ${lead.trade || 'construction'} takeoffs typically take your team? Happy to share how Beam AI handles it if useful.`;
}
