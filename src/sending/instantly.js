import 'dotenv/config';

const BASE = 'https://api.instantly.ai/api/v1';

function key() {
  if (!process.env.INSTANTLY_API_KEY) throw new Error('INSTANTLY_API_KEY not set');
  return process.env.INSTANTLY_API_KEY;
}

async function api(path, method = 'GET', body = null) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${key()}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Instantly ${method} ${path} failed: ${res.status} — ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

export async function listCampaigns() {
  return api('/campaign/list?skip=0&limit=100');
}

export async function getCampaignAnalytics(campaignId) {
  return api(`/analytics/campaign/overview?campaign_id=${campaignId}`);
}

export async function pushLeadToCampaign(campaignId, lead, sequence) {
  const payload = {
    campaign_id: campaignId,
    skip_if_in_workspace: true,
    leads: [{
      email: lead.email,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      company_name: lead.company_name || '',
      website: lead.domain || '',
      personalization: sequence?.email_1_body || '',
      custom_variables: {
        trade: lead.trade || '',
        icp_score: String(lead.icp_score || 0),
        tier: String(lead.tier || 3),
        linkedin_url: lead.linkedin_url || '',
        li_connection_note: sequence?.linkedin_note || '',
      },
    }],
  };
  return api('/lead/add', 'POST', payload);
}

export async function pushBulkLeads(campaignId, leads, sequencesMap) {
  // Instantly accepts up to 1000 leads per call — batch in groups of 100
  const results = { success: 0, failed: 0, errors: [] };
  const BATCH = 100;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const payload = {
      campaign_id: campaignId,
      skip_if_in_workspace: true,
      leads: batch.map(lead => {
        const seq = sequencesMap?.[lead.id];
        return {
          email: lead.email,
          first_name: lead.first_name || '',
          last_name: lead.last_name || '',
          company_name: lead.company_name || '',
          website: lead.domain || '',
          personalization: seq?.email_1_body || '',
          custom_variables: {
            trade: lead.trade || '',
            tier: String(lead.tier || 3),
          },
        };
      }),
    };
    try {
      await api('/lead/add', 'POST', payload);
      results.success += batch.length;
    } catch (e) {
      results.failed += batch.length;
      results.errors.push(e.message);
    }
    // Rate limit respect
    if (i + BATCH < leads.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export async function getLeadStatus(email) {
  return api(`/lead/get?email=${encodeURIComponent(email)}`);
}

export async function validateApiKey() {
  try {
    const res = await api('/authenticate');
    return { valid: true, org: res?.organization_name || 'unknown' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
