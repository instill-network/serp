// Use playwright-extra + stealth to reduce detection
const { devices } = require('playwright');
const fs = require('fs/promises');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
if (process.env.SERP_DISABLE_STEALTH !== 'true') {
  chromium.use(stealth);
}

/**
 * Accept Google consent dialogs in various regions/locales.
 * Tries common selectors both on page and inside consent iframes.
 * @param {import('playwright').Page} page
 */
async function acceptGoogleConsent(page) {
  // Try top-level buttons first
  const tryClickTopLevel = async () => {
    const selectors = [
      'button#L2AGLb', // Desktop "Accept all"
      'button#introAgreeButton', // Older desktop consent
      'button[aria-label*="Accept all" i]',
      'button:has-text("I agree")',
      'button:has-text("Accept all")',
      'form[action*="consent"] button[type="submit"]'
    ];
    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      try {
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(300);
          return true;
        }
      } catch (_) { /* ignore */ }
    }
    return false;
  };

  const clickedTop = await tryClickTopLevel();
  if (clickedTop) return;

  // Try consent iframe(s)
  for (const frame of page.frames()) {
    try {
      const url = frame.url();
      if (!/consent\.google\./.test(url) && !/consent/.test(url)) continue;
      const selectors = [
        'button#L2AGLb',
        'button#introAgreeButton',
        'button[aria-label*="Accept all" i]',
        'button:has-text("I agree")',
        'button:has-text("Accept all")',
        'form[action*="consent"] button[type="submit"]'
      ];
      for (const sel of selectors) {
        const btn = frame.locator(sel).first();
        try {
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(300);
            return;
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  }
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function jitter(minMs = 120, maxMs = 300) {
  const ms = randInt(minMs, maxMs);
  await sleep(ms);
}

async function isBlocked(page) {
  try {
    const blocked = await page.evaluate(() => {
      const url = location.href;
      const title = document.title.toLowerCase();
      if (/\/sorry\//.test(url)) return true;
      if (title.includes('unusual traffic')) return true;
      if (document.querySelector('form[action*="/sorry/"]')) return true;
      if (document.querySelector('#captcha')) return true;
      return false;
    });
    return !!blocked;
  } catch (_) {
    return false;
  }
}

/**
 * Build a Google search URL with robust defaults.
 * @param {string} query
 * @param {object} opts
 */
function buildSearchUrl(query, opts = {}) {
  const {
    domain = 'google.com',
    hl = 'en',
    gl,
    num = 10,
    safe = 'off',
    tbs, // time filters like qdr:d (past day), qdr:w (week), etc
    tbm, // vertical (e.g., 'nws' for news, 'vid' for videos)
    udm, // UI mode (e.g., 14)
    start = 0,
  } = opts;
  const u = new URL(`https://www.${domain}/search`);
  u.searchParams.set('q', query);
  u.searchParams.set('hl', hl);
  if (gl) u.searchParams.set('gl', gl);
  if (num) u.searchParams.set('num', String(num));
  if (safe) u.searchParams.set('safe', safe);
  u.searchParams.set('pws', '0'); // disable personalized search where possible
  u.searchParams.set('source', 'hp');
  if (tbs) u.searchParams.set('tbs', tbs);
  if (tbm) u.searchParams.set('tbm', tbm);
  if (typeof udm !== 'undefined') u.searchParams.set('udm', String(udm));
  if (start) u.searchParams.set('start', String(start));
  return u.toString();
}

function sanitizeUrl(href) {
  try {
    const u = new URL(href);
    // Strip text fragments (e.g., #:%7E:text=...)
    if (u.hash.includes(':~:')) u.hash = '';
    return u.toString();
  } catch (_) {
    return href;
  }
}

/**
 * Extract organic results from the current SERP.
 * Prioritizes anchors inside .yuRUbf (stable organic container), with fallbacks.
 * @param {import('playwright').Page} page
 * @param {number} limit
 */
async function extractResults(page, limit = 10, mode = { tbm: undefined }) {
  // Wait for first result element to appear
  await page.waitForFunction(() => !!document.querySelector('a h3') || !!document.querySelector('div.dbsr > a'), null, { timeout: 20000 });
  await jitter(120, 260);

  // First, collect organic anchors in yuRUbf blocks (most reliable)
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

  // Special handling for news vertical (tbm=nws)
  if ((mode?.tbm || '').toLowerCase() === 'nws') {
    const newsResults = await page.evaluate(() => {
      const out = [];
      const cards = Array.from(document.querySelectorAll('div#search div.dbsr > a'));
      for (const a of cards) {
        const titleEl = a.querySelector('div[role="heading"], div.JheGif, h3');
        const title = titleEl?.textContent?.trim() || '';
        const container = a.closest('div.dbsr');
        const snippetEl = container?.querySelector('div.Y3v8qd, div.GI74Re, div.st, div.gG0TJc');
        out.push({ title, url: a.href, snippet: snippetEl?.textContent?.trim() || '' });
      }
      return out;
    });
    const map = new Map();
    for (const r of newsResults) if (r?.url && !map.has(r.url)) map.set(r.url, r);
    for (const r of results) if (r?.url && !map.has(r.url)) map.set(r.url, r);
    results = Array.from(map.values());
  }

  // If we didn't get enough, fall back to any a:has(h3) inside #search (last resort)
  if (results.length < limit) {
    const fallback = await page.evaluate(() => {
      const seen = new Set();
      const current = new Set((window.__existingResults || []).map(r => r.url));
      const items = [];
      const anchors = Array.from(document.querySelectorAll('div#search a')); // will filter below
      for (const a of anchors) {
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const href = a.href;
        if (!href) continue;
        if (current.has(href) || seen.has(href)) continue;
        // filter out non-organic obvious modules by class patterns
        const container = a.closest('div.g, div.MjjYud, div.Gx5Zad');
        if (!container) continue;
        // Skip knowledge panels, top stories, etc by looking for known module roles
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
    // merge unique by URL
    const byUrl = new Map();
    for (const r of [...results, ...fallback]) {
      if (!r?.url) continue;
      if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
    results = Array.from(byUrl.values());
  }

  // Sanitize URLs (strip text fragments)
  results = results.map(r => ({ ...r, url: sanitizeUrl(r.url) }));

  return results.slice(0, limit);
}

/**
 * Perform a Google search and return organic results.
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.num=10]
 * @param {string} [options.hl='en']
 * @param {string} [options.gl]
 * @param {string} [options.domain='google.com']
 * @param {boolean} [options.headless=true]
 * @param {number} [options.timeoutMs=30000]
 * @param {string} [options.safe='off'] - safe search: off, active
 * @param {string} [options.tbs] - time filters (e.g., 'qdr:d', 'qdr:w', 'qdr:m')
 */
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
    tbm,
    udm,
    ncr = false,
    retries = 2,
    delayMinMs = 120,
    delayMaxMs = 300,
    proxy,
    debugHtmlPath,
    debugScreenshotPath,
  } = options;

  const perPage = Math.min(10, num);
  const maxPages = Math.ceil(num / perPage);

  // Launch Chromium with mild stealth tweaks
  const launchOpts = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run'
    ]
  };
  if (proxy) {
    launchOpts.proxy = { server: proxy };
  }
  const browser = await chromium.launch(launchOpts);

  // Use a desktop profile with en-US locale by default
  const baseDevice = devices['Desktop Chrome'];
  const viewport = {
    width: (baseDevice.viewport?.width || 1280) + randInt(-60, 60),
    height: (baseDevice.viewport?.height || 720) + randInt(-40, 40),
  };
  const context = await browser.newContext({
    ...baseDevice,
    viewport,
    locale: hl,
    userAgent: baseDevice.userAgent?.replace('Headless', '') || undefined,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  let lastErr;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (ncr) {
          await page.goto(`https://www.${domain}/ncr`, { waitUntil: 'domcontentloaded' });
          await jitter(delayMinMs, delayMaxMs);
        }
        const collected = [];
        const seen = new Map();
        let start = 0;
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
          const url = buildSearchUrl(query, { hl, gl, domain, num: perPage, safe, tbs, tbm, udm, start });
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await jitter(delayMinMs, delayMaxMs);
          if (pageIndex === 0) {
            await acceptGoogleConsent(page);
            await jitter(delayMinMs, delayMaxMs);
            if (!/\/search\?/.test(page.url())) {
              await page.goto(url, { waitUntil: 'domcontentloaded' });
              await jitter(delayMinMs, delayMaxMs);
            }
          }
          if (await isBlocked(page)) {
            throw new Error('Blocked by Google (captcha/sorry page)');
          }
          const pageResults = await extractResults(page, perPage, { tbm });
          for (const r of pageResults) {
            if (r?.url && !seen.has(r.url)) {
              seen.set(r.url, true);
              collected.push(r);
              if (collected.length >= num) break;
            }
          }
          if (collected.length >= num) break;
          // If page produced very few results, stop paging and retry
          if (pageResults.length < Math.max(3, Math.floor(perPage / 2))) break;
          start += perPage;
        }
        if (collected.length > 0) {
          return { query, url: page.url(), results: collected.slice(0, num) };
        }
        lastErr = new Error('No results extracted');
      } catch (err) {
        lastErr = err;
        if (debugHtmlPath) {
          try { await fs.writeFile(debugHtmlPath, await page.content(), 'utf8'); } catch (_) {}
        }
        if (debugScreenshotPath) {
          try { await page.screenshot({ path: debugScreenshotPath, fullPage: true }); } catch (_) {}
        }
      }
      if (attempt < retries) {
        const base = 1000 * Math.pow(1.8, attempt);
        const backoff = base + randInt(0, 400);
        await sleep(backoff);
      }
    }
    throw lastErr || new Error('Unknown error while searching');
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = {
  searchGoogle,
  buildSearchUrl,
};
