import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const PROFILE_PATH = new URL('../../data/icp-profile.json', import.meta.url).pathname;

const ICP_GEOS = new Set([
  'australia', 'canada', 'united states', 'usa', 'us',
  'united kingdom', 'uk', 'ireland', 'south africa',
]);

const CONSTRUCTION_TRADES = [
  'construction', 'hvac', 'plumbing', 'electrical', 'roofing', 'flooring',
  'mechanical', 'contractor', 'contracting', 'insulation', 'concrete',
  'masonry', 'drywall', 'framing', 'excavat', 'welding', 'steel',
  'building materials', 'building services', 'sheet metal', 'painting',
  'landscap', 'paving', 'waterproof', 'glazing', 'carpentry', 'earthwork',
  'civil', 'demolition', 'rigging', 'crane',
];

const TRADE_KEYWORDS = {
  hvac: ['hvac', 'heating', 'cooling', 'mechanical', 'air conditioning', 'ventilation', 'refrigeration'],
  plumbing: ['plumbing', 'plumber', 'pipe', 'drain', 'waterworks'],
  electrical: ['electrical', 'electrician', 'electric', 'wiring', 'lighting'],
  roofing: ['roofing', 'roofer', 'roof', 'shingle', 'waterproof'],
  flooring: ['flooring', 'floor', 'tile', 'carpet', 'hardwood'],
  steel: ['steel', 'metal', 'fabricat', 'welding', 'ironwork', 'structural', 'rigging', 'crane'],
  concrete: ['concrete', 'masonry', 'cement', 'foundation', 'flatwork'],
  painting: ['paint', 'coating', 'finish'],
  insulation: ['insulation', 'insulate'],
  earthworks: ['earthwork', 'excavat', 'grading', 'civil', 'demolition', 'paving'],
  gc: ['general contractor', 'general contracting'],
};

let _profile = null;

async function loadProfile() {
  if (_profile) return _profile;
  if (!existsSync(PROFILE_PATH)) {
    return {
      totalPilotCompanies: 1065, icpGeoCompanies: 753,
      minHeadcount: 6, maxHeadcount: 271,
      topIndustries: ['Construction', 'Manufacturing'],
      geos: ['United States', 'Canada', 'Australia', 'United Kingdom', 'Ireland', 'South Africa'],
    };
  }
  _profile = JSON.parse(await readFile(PROFILE_PATH, 'utf8'));
  return _profile;
}

export function detectTrade(industry = '', companyName = '') {
  const text = `${industry} ${companyName}`.toLowerCase();
  for (const [trade, keywords] of Object.entries(TRADE_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return trade;
  }
  if (CONSTRUCTION_TRADES.some(t => text.includes(t))) return 'construction';
  return null;
}

export async function scoreCompany(enriched) {
  const profile = await loadProfile();
  const signals = { matched: [], failed: [] };
  let score = 0;

  // GEO — 30 pts
  const country = (enriched.country || '').toLowerCase();
  if (ICP_GEOS.has(country)) {
    score += 30;
    signals.matched.push(`Geo: ${enriched.country}`);
  } else {
    signals.failed.push(`Geo: ${enriched.country || 'unknown'} (not in ICP geos)`);
  }

  // INDUSTRY — 40 pts
  const industry = (enriched.industry || '').toLowerCase();
  const icpIndustries = (profile.topIndustries || []).map(i => i.toLowerCase());
  const profileMatch = icpIndustries.find(i => industry.includes(i) || i.includes(industry));
  const tradeMatch = CONSTRUCTION_TRADES.find(t => industry.includes(t));

  if (profileMatch || tradeMatch) {
    score += 40;
    signals.matched.push(`Industry: ${enriched.industry}`);
  } else if (!enriched.industry) {
    signals.failed.push('Industry: unknown');
  } else {
    signals.failed.push(`Industry: ${enriched.industry} (not in ICP)`);
  }

  // HEADCOUNT — 30 pts
  const hc = enriched.headcount || 0;
  const { minHeadcount = 6, maxHeadcount = 271 } = profile;
  if (hc >= minHeadcount && hc <= maxHeadcount) {
    score += 30;
    signals.matched.push(`Headcount: ${hc} (ICP range ${minHeadcount}–${maxHeadcount})`);
  } else if (hc > 0 && hc < minHeadcount * 2) {
    score += 15;
    signals.matched.push(`Headcount: ${hc} (slightly below ICP, partial)`);
  } else {
    signals.failed.push(`Headcount: ${hc} (ICP: ${minHeadcount}–${maxHeadcount})`);
  }

  const geoOk = ICP_GEOS.has(country);
  const indOk = !!(profileMatch || tradeMatch);
  let status;
  if (!enriched.country && !enriched.industry) status = 'Needs Review';
  else if (!geoOk && !indOk) status = 'Not ICP';
  else status = score >= 70 ? 'ICP' : 'Not ICP';

  const tier = score >= 70 ? 1 : score >= 40 ? 2 : 3;
  const trade = detectTrade(enriched.industry, enriched.companyName || '');

  return { icpScore: score, icpStatus: status, tier, trade, matchedSignals: signals.matched.join('\n'), failedSignals: signals.failed.join('\n') };
}
