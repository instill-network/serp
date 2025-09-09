const { chromium, devices } = require('playwright');

function parseProxy(input) {
  if (!input) return undefined;
  if (typeof input !== 'string') return input;
  let raw = input.trim();
  if (!/^\w+:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const u = new URL(raw);
    const server = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    const username = u.username || undefined; // keep modifiers like +country=us
    const password = u.password || undefined;
    return { server, username, password };
  } catch (_) {
    return { server: raw };
  }
}

async function acceptGoogleConsent(page) {
  const tryClickTopLevel = async () => {
    const selectors = [
      'button#L2AGLb',
      'button#introAgreeButton',
      'button[aria-label*="Accept all" i]',
      'button:has-text("I agree")',
      'button:has-text("Accept all")',
      'form[action*="consent"] button[type="submit"]',
    ];
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      try {
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(300);
          return true;
        }
      } catch (_) {}
    }
    return false;
  };
  if (await tryClickTopLevel()) return;
  for (const frame of page.frames()) {
    try {
      const url = frame.url();
      if (!/consent\.google\./.test(url) && !/consent/.test(url)) continue;
      const selectors = [
        'button#L2AGLb', 'button#introAgreeButton', 'button[aria-label*="Accept all" i]', 'button:has-text("I agree")', 'button:has-text("Accept all")', 'form[action*="consent"] button[type="submit"]',
      ];
      for (const sel of selectors) {
        const btn = frame.locator(sel).first();
        try {
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(300);
            return;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
}

function buildSearchUrl(query, opts = {}) {
  const {
    domain = 'google.com',
    hl = 'en',
    gl,
    num = 10,
    safe = 'off',
    tbs,
  } = opts;
  const u = new URL(`https://www.${domain}/search`);
  u.searchParams.set('q', query);
  u.searchParams.set('hl', hl);
  if (gl) u.searchParams.set('gl', gl);
  if (num) u.searchParams.set('num', String(num));
  if (safe) u.searchParams.set('safe', safe);
  u.searchParams.set('pws', '0');
  u.searchParams.set('source', 'hp');
  if (tbs) u.searchParams.set('tbs', tbs);
  return u.toString();
}

function sanitizeUrl(href) {
  try {
    const u = new URL(href);
    if (u.hash.includes(':~:')) u.hash = '';
    return u.toString();
  } catch (_) {
    return href;
  }
}

async function extractResults(page, limit = 10) {
  await page.waitForSelector('div#search', { timeout: 15000 });
  await page.waitForFunction(() => !!document.querySelector('div#search a h3'), null, { timeout: 15000 });

  const organic = await page.evaluate(() => {
    const items = [];
    const anchors = Array.from(document.querySelectorAll('div#search .yuRUbf > a'));
    for (const a of anchors) {
      const h3 = a.querySelector('h3');
      if (!h3) continue;
      const g = a.closest('div.g');
      const snippetEl = g?.querySelector('div.VwiC3b, div.IsZvec, div[data-sncf="1"], span.aCOpRe');
      items.push({
        title: h3.textContent?.trim() || '',
        url: a.href,
        snippet: snippetEl?.textContent?.trim() || ''
      });
    }
    return items;
  });

  let results = organic;
  if (results.length < limit) {
    const fallback = await page.evaluate(() => {
      const seen = new Set();
      const current = new Set((window.__existingResults || []).map(r => r.url));
      const items = [];
      const anchors = Array.from(document.querySelectorAll('div#search a'));
      for (const a of anchors) {
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const href = a.href;
        if (!href) continue;
        if (current.has(href) || seen.has(href)) continue;
        const container = a.closest('div.g, div.MjjYud, div.Gx5Zad');
        if (!container) continue;
        if (container.querySelector('[data-hveid] [role="list"]') || container.closest('[data-hveid] [role="list"]')) continue;
        const snippetEl = container.querySelector('div.VwiC3b, div.IsZvec, div[data-sncf="1"], span.aCOpRe');
        items.push({
          title: h3.textContent?.trim() || '',
          url: href,
          snippet: snippetEl?.textContent?.trim() || ''
        });
        seen.add(href);
      }
      return items;
    });
    const byUrl = new Map();
    for (const r of [...results, ...fallback]) {
      if (!r?.url) continue;
      if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
    results = Array.from(byUrl.values());
  }

  results = results.map(r => ({ ...r, url: sanitizeUrl(r.url) }));
  return results.slice(0, limit);
}

async function searchGoogle(query, options = {}) {
  const {
    num = 10,
    hl = 'en',
    gl,
    domain = 'google.com',
    headless = true,
    timeoutMs = 30000,
    safe = 'off',
    tbs,
    proxy,
  } = options;

  const url = buildSearchUrl(query, { hl, gl, domain, num, safe, tbs });
  const launchOpts = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run'
    ]
  };
  const parsedProxy = parseProxy(proxy);
  if (parsedProxy) launchOpts.proxy = parsedProxy;
  const browser = await chromium.launch(launchOpts);

  const baseDevice = devices['Desktop Chrome'];
  const context = await browser.newContext({
    ...baseDevice,
    locale: hl,
    userAgent: baseDevice.userAgent?.replace('Headless', '') || undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await acceptGoogleConsent(page);
    if (!/\/search\?/.test(page.url())) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    const results = await extractResults(page, num);
    return { query, url: page.url(), results };
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = {
  searchGoogle,
  buildSearchUrl,
};
