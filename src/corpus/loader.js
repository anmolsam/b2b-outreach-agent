import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const CORPUS_PATH = process.env.CORPUS_PATH ||
  '/Users/anmol/beam-predictive-sales-agent/data/corpus';

// Hardcoded pain points per trade — extracted from HVAC transcripts + domain knowledge
// These are the fallback when corpus vectors have no winning_lines yet
const TRADE_CONTEXT = {
  hvac: {
    pain_points: [
      'takeoffs take 2–3 days per project, slowing down bid volume',
      'estimators are constantly behind — missing bid deadlines',
      'manual PDF takeoffs are error-prone, especially on complex mechanical drawings',
      'can\'t scale bid count without hiring more estimators',
      'losing jobs to competitors who turn around bids faster',
    ],
    urgency_triggers: ['bid deadline', 'estimator backlog', 'losing bids', 'swamped', 'behind on quotes'],
    value_hooks: [
      'Beam AI turns HVAC takeoffs around in hours, not days',
      'contractors using Beam AI have doubled their bid volume without adding headcount',
    ],
    competitor_context: 'most HVAC estimators still use Bluebeam or manual PDF markups',
    avg_deal_size: '$10k–$50k/year',
  },
  plumbing: {
    pain_points: [
      'plumbing takeoffs from large commercial PDFs take full days per bid',
      'can\'t bid more than 3–4 jobs per week with current estimating bandwidth',
      'fixture counts are always a manual slog — page by page',
      'change orders eat into margins because estimates weren\'t detailed enough',
    ],
    urgency_triggers: ['too many bids', 'can\'t keep up', 'estimator overwhelmed', 'behind on takeoffs'],
    value_hooks: [
      'Beam AI handles plumbing fixture counts and pipe runs automatically',
      'clients report 60–70% reduction in takeoff time on commercial plumbing projects',
    ],
    competitor_context: 'most plumbing estimators use Planswift or on-screen takeoff',
    avg_deal_size: '$10k–$40k/year',
  },
  electrical: {
    pain_points: [
      'electrical takeoffs on large commercial projects can take 5–8 hours per set',
      'device counts across 200-page sets are brutally manual',
      'estimators burn out on repetitive counting work',
      'bid margins suffer when takeoffs are rushed',
    ],
    urgency_triggers: ['page count', 'device count', 'bid volume', 'estimator time'],
    value_hooks: [
      'Beam AI counts devices and runs across large electrical sets in minutes',
      'electrical contractors have increased bid capacity by 3x with Beam AI',
    ],
    competitor_context: 'most electrical estimators use McCormick or On-Screen Takeoff',
    avg_deal_size: '$10k–$60k/year',
  },
  roofing: {
    pain_points: [
      'manual roof measurement from drawings is slow and error-prone',
      'takeoff accuracy directly impacts material waste and margin',
      'estimators spend hours on slope calculations and hip/valley lengths',
      'can\'t scale bid count during busy season without more staff',
    ],
    urgency_triggers: ['busy season', 'material waste', 'measurement errors', 'bid turnaround'],
    value_hooks: [
      'Beam AI automates roof area, pitch, and linear measurements from drawings',
      'roofing contractors report 50% faster takeoffs with fewer material overruns',
    ],
    competitor_context: 'most roofing estimators use EagleView or manual digitizing',
    avg_deal_size: '$8k–$30k/year',
  },
  steel: {
    pain_points: [
      'structural steel takeoffs require reading complex connection details — very time-intensive',
      'multiple revision rounds because drawings change, estimates need full rework',
      'can\'t easily separate assemblies for accurate pricing',
      'estimators spend 6–10 hours on a single structural bid',
    ],
    urgency_triggers: ['connection details', 'revision rounds', 'drawing changes', 'steel tonnage'],
    value_hooks: [
      'Beam AI handles structural steel member counts and linear footage from IFC/PDF',
      'steel fabricators use Beam AI to price revision sets 10x faster',
    ],
    competitor_context: 'most steel estimators use SDS2 or manual quantity takeoff',
    avg_deal_size: '$15k–$70k/year',
  },
  concrete: {
    pain_points: [
      'concrete volume calculations from structural drawings are complex and error-prone',
      'form work quantities are constantly underestimated, killing margins',
      're-doing takeoffs for every addendum eats estimator time',
    ],
    urgency_triggers: ['volume calculations', 'form work', 'addendum', 'margin'],
    value_hooks: [
      'Beam AI computes concrete volumes, rebar counts, and form work quantities automatically',
      'concrete subs report significantly fewer change orders after switching to Beam AI',
    ],
    competitor_context: 'most concrete subs estimate manually or use Excel',
    avg_deal_size: '$10k–$45k/year',
  },
  flooring: {
    pain_points: [
      'floor area calculations from complex architectural plans take hours',
      'material waste factors are always guesswork — ordering too much or too little',
      'transition strips and specialty area calculations are manually tedious',
    ],
    urgency_triggers: ['material order', 'waste factor', 'square footage', 'complex floor plan'],
    value_hooks: [
      'Beam AI calculates net floor areas, waste factors, and material quantities from drawings',
      'flooring contractors eliminate material over-orders with AI-accurate takeoffs',
    ],
    competitor_context: 'most flooring estimators use paper plans or basic CAD measuring tools',
    avg_deal_size: '$8k–$25k/year',
  },
  painting: {
    pain_points: [
      'wall area calculations from elevation drawings are tedious to do manually',
      'counting door and window deductions takes forever on large commercial projects',
      'estimators spend more time measuring than pricing',
    ],
    urgency_triggers: ['wall area', 'surface area', 'deductions', 'commercial project'],
    value_hooks: [
      'Beam AI measures wall surfaces, deducts openings, and calculates paint quantities automatically',
      'painting contractors use Beam AI to bid 4x more commercial projects per month',
    ],
    competitor_context: 'most painting estimators use PlanSwift or estimate by eye',
    avg_deal_size: '$6k–$20k/year',
  },
  insulation: {
    pain_points: [
      'calculating insulation quantities from mechanical and architectural drawings is slow',
      'pipe insulation linear footage across large MEP sets takes hours',
      'batt vs. blown-in calculations have to be done separately and manually',
    ],
    urgency_triggers: ['pipe insulation', 'linear footage', 'mechanical drawings', 'bid turnaround'],
    value_hooks: [
      'Beam AI extracts insulation quantities from MEP and architectural sets in minutes',
    ],
    competitor_context: 'most insulation estimators use Excel or manual counting',
    avg_deal_size: '$8k–$25k/year',
  },
  construction: {
    pain_points: [
      'takeoffs across multiple trades slow down the whole bid process',
      'coordinating quantity takeoffs from different subs creates bottlenecks',
      'estimating bandwidth limits how many projects you can bid',
    ],
    urgency_triggers: ['bid volume', 'takeoff bottleneck', 'estimating capacity', 'deadline'],
    value_hooks: [
      'Beam AI handles multi-trade takeoffs so your estimators focus on pricing, not counting',
      'GCs using Beam AI have increased bid capacity without adding headcount',
    ],
    competitor_context: 'most GCs coordinate manual takeoffs across subs using email and PDFs',
    avg_deal_size: '$15k–$75k/year',
  },
};

const DEFAULT_CONTEXT = {
  pain_points: [
    'manual takeoff processes slow down bid volume and hurt competitiveness',
    'estimating bandwidth is the bottleneck to winning more work',
  ],
  urgency_triggers: ['bid deadline', 'estimator time', 'manual process'],
  value_hooks: ['Beam AI automates construction takeoffs so estimators can bid more, win more'],
  competitor_context: 'most construction estimators use manual or legacy tools',
  avg_deal_size: '$10k–$40k/year',
};

// Extract best prospect lines from corpus vectors for a given trade
export async function loadTradePatterns(trade) {
  const clustersPath = join(CORPUS_PATH, 'clusters', `${trade}.json`);
  const patterns = { winning_lines: [], objections: [], buying_signals: [], deal_count: 0, won: 0 };

  if (existsSync(clustersPath)) {
    try {
      const data = JSON.parse(await readFile(clustersPath, 'utf8'));
      patterns.deal_count = data.deal_count || 0;
      patterns.won = data.won || 0;

      for (const cluster of (data.clusters || [])) {
        const p = cluster.patterns || {};
        if (p.winning_lines?.length) patterns.winning_lines.push(...p.winning_lines);
        if (p.objections?.length) patterns.objections.push(...p.objections);
        if (p.buying_signals?.length) patterns.buying_signals.push(...p.buying_signals);
      }
    } catch {}
  }

  // Mine best_prospect_line from vector chunks as fallback
  if (patterns.objections.length === 0 || patterns.buying_signals.length === 0) {
    const vectorsPath = join(CORPUS_PATH, 'vectors');
    if (existsSync(vectorsPath)) {
      try {
        const files = await readdir(vectorsPath);
        const sampled = files.slice(0, 30);
        for (const f of sampled) {
          try {
            const vec = JSON.parse(await readFile(join(vectorsPath, f), 'utf8'));
            if (vec.trade !== trade) continue;
            for (const chunk of (vec.chunks || []).slice(0, 20)) {
              if (chunk.has_objection && chunk.best_prospect_line && patterns.objections.length < 10) {
                patterns.objections.push(chunk.best_prospect_line);
              }
              if (chunk.has_close && chunk.best_ae_line && patterns.winning_lines.length < 10) {
                patterns.winning_lines.push(chunk.best_ae_line);
              }
              if (chunk.best_prospect_line?.length > 40 && patterns.buying_signals.length < 10) {
                patterns.buying_signals.push(chunk.best_prospect_line);
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  return { ...patterns, context: TRADE_CONTEXT[trade] || DEFAULT_CONTEXT };
}

export function getTradeContext(trade) {
  return TRADE_CONTEXT[trade] || DEFAULT_CONTEXT;
}

export const ALL_TRADES = Object.keys(TRADE_CONTEXT);
