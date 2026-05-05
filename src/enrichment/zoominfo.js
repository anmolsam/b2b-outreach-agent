import 'dotenv/config';

const OKTA_TOKEN_URL = 'https://okta-login.zoominfo.com/oauth2/default/v1/token';
const API_BASE = 'https://api.zoominfo.com/gtm/data/v1';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const creds = Buffer.from(
    `${process.env.ZOOMINFO_CLIENT_ID}:${process.env.ZOOMINFO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(OKTA_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=api%3Adata%3Acompany',
  });

  if (!res.ok) throw new Error(`ZoomInfo auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + 55 * 60 * 1000;
  return _token;
}

const OUTPUT_FIELDS = [
  'name', 'website', 'primaryIndustry', 'industries',
  'employeeCount', 'revenueRange', 'country', 'state', 'city', 'type',
  'description', 'founded', 'ticker', 'techStack',
];

export async function enrichCompanyByDomain(domain) {
  if (!process.env.ZOOMINFO_CLIENT_ID || !process.env.ZOOMINFO_CLIENT_SECRET) {
    return null;
  }
  const token = await getToken();

  const res = await fetch(`${API_BASE}/companies/enrich`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'CompanyEnrich',
        attributes: {
          outputFields: OUTPUT_FIELDS,
          matchCompanyInput: [{ companyWebsite: domain }],
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ZoomInfo enrich failed for ${domain}: ${res.status} ${text}`);

  const json = JSON.parse(text);
  const result = json?.data?.[0]?.attributes;
  if (!result || result.matchStatus === 'No match') return null;

  const industryArr = Array.isArray(result.primaryIndustry)
    ? result.primaryIndustry
    : [result.primaryIndustry].filter(Boolean);

  return {
    companyName: result.name || domain,
    domain,
    industry: industryArr[0] || '',
    industries: industryArr,
    headcount: result.employeeCount || 0,
    revenue: result.revenueRange || '',
    country: result.country || '',
    state: result.state || '',
    city: result.city || '',
    ownershipType: result.type || '',
    description: result.description || '',
    techStack: result.techStack || [],
  };
}

export async function enrichBatch(domains) {
  if (!process.env.ZOOMINFO_CLIENT_ID) return domains.map(d => ({ domain: d, enriched: null }));
  const token = await getToken();

  const res = await fetch(`${API_BASE}/companies/enrich`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'CompanyEnrich',
        attributes: {
          outputFields: OUTPUT_FIELDS,
          matchCompanyInput: domains.map(d => ({ companyWebsite: d })),
        },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ZoomInfo batch enrich failed: ${res.status} ${text}`);

  const json = JSON.parse(text);
  return (json?.data || []).map((item, i) => {
    const r = item?.attributes;
    if (!r || r.matchStatus === 'No match') return { domain: domains[i], enriched: null };
    const industryArr = Array.isArray(r.primaryIndustry) ? r.primaryIndustry : [r.primaryIndustry].filter(Boolean);
    return {
      domain: domains[i],
      enriched: {
        companyName: r.name || domains[i],
        domain: domains[i],
        industry: industryArr[0] || '',
        headcount: r.employeeCount || 0,
        revenue: r.revenueRange || '',
        country: r.country || '',
        state: r.state || '',
        city: r.city || '',
        ownershipType: r.type || '',
        description: r.description || '',
      },
    };
  });
}
