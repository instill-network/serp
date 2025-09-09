import { devices, type Page, type BrowserContext } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { writeFile as fsWriteFile } from 'node:fs/promises';

if (process.env.SERP_DISABLE_STEALTH !== 'true') {
  try { chromium.use(stealth()); } catch { /* noop */ }
}

export type ProxyInput = string | { server: string; username?: string; password?: string };

export interface SearchOptions {
  num?: number;
  hl?: string;
  gl?: string;
  domain?: string;
  headless?: boolean;
  timeoutMs?: number;
  safe?: 'off' | 'active';
  tbs?: string;
  tbm?: string; // e.g., 'nws'
  udm?: number; // UI mode
  ncr?: boolean; // no country redirect
  retries?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  proxy?: ProxyInput; // http:// or socks5://, supports username modifiers like +country=us
  debugHtmlPath?: string;
  debugScreenshotPath?: string;
}

export interface SerpItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SerpResult {
  query: string;
  url: string;
  results: SerpItem[];
}

export function buildSearchUrl(query: string, opts: {
  domain?: string; hl?: string; gl?: string; num?: number; safe?: string; tbs?: string; tbm?: string; udm?: number; start?: number;
} = {}): string {
  const {
    domain = 'google.com',
    hl = 'en',
    gl,
    num = 10,
    safe = 'off',
    tbs,
    tbm,
    udm,
    start = 0,
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
  if (tbm) u.searchParams.set('tbm', tbm);
  if (typeof udm !== 'undefined') u.searchParams.set('udm', String(udm));
  if (start) u.searchParams.set('start', String(start));
  return u.toString();
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
async function jitter(minMs = 120, maxMs = 300) { await sleep(randInt(minMs, maxMs)); }

function sanitizeUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.hash.includes(':~:')) u.hash = '';
    return u.toString();
  } catch { return href; }
}

export function parseProxy(input?: ProxyInput): { server: string; username?: string; password?: string } | undefined {
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
  } catch {
    // Fallback: pass as server string
    return { server: raw } as any;
  }
}

async function acceptGoogleConsent(page: Page) {
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
      } catch { /* ignore */ }
    }
    return false;
  };
  const clickedTop = await tryClickTopLevel();
  if (clickedTop) return;
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
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
}

async function isBlocked(page: Page): Promise<boolean> {
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
  } catch { return false; }
}

async function extractResults(page: Page, limit = 10, mode: { tbm?: string } = {}): Promise<SerpItem[]> {
  await page.waitForFunction(() => !!document.querySelector('a h3') || !!document.querySelector('div.dbsr > a'), null, { timeout: 20000 });
  await jitter(120, 260);

  const organic = await page.evaluate(() => {
    const items: { title: string; url: string; snippet: string }[] = [];
    const anchors = Array.from(document.querySelectorAll('div#search .yuRUbf > a')) as HTMLAnchorElement[];
    for (const a of anchors) {
      const h3 = a.querySelector('h3');
      if (!h3) continue;
      const g = a.closest('div.g') as HTMLElement | null;
      const snippetEl = g?.querySelector('div.VwiC3b, div.IsZvec, div[data-sncf="1"], span.aCOpRe') as HTMLElement | null;
      items.push({ title: h3.textContent?.trim() || '', url: a.href, snippet: snippetEl?.textContent?.trim() || '' });
    }
    return items;
  });

  let results: SerpItem[] = organic;

  if ((mode?.tbm || '').toLowerCase() === 'nws') {
    const newsResults = await page.evaluate(() => {
      const out: { title: string; url: string; snippet: string }[] = [];
      const cards = Array.from(document.querySelectorAll('div#search div.dbsr > a')) as HTMLAnchorElement[];
      for (const a of cards) {
        const titleEl = a.querySelector('div[role="heading"], div.JheGif, h3') as HTMLElement | null;
        const title = titleEl?.textContent?.trim() || '';
        const container = a.closest('div.dbsr') as HTMLElement | null;
        const snippetEl = container?.querySelector('div.Y3v8qd, div.GI74Re, div.st, div.gG0TJc') as HTMLElement | null;
        out.push({ title, url: a.href, snippet: snippetEl?.textContent?.trim() || '' });
      }
      return out;
    });
    const map = new Map<string, SerpItem>();
    for (const r of newsResults) if (r?.url && !map.has(r.url)) map.set(r.url, r);
    for (const r of results) if (r?.url && !map.has(r.url)) map.set(r.url, r);
    results = Array.from(map.values());
  }

  if (results.length < limit) {
    const fallback = await page.evaluate(() => {
      const seen = new Set<string>();
      const current: Set<string> = new Set((globalThis as any).__existingResults?.map((r: any) => r.url) ?? []);
      const items: { title: string; url: string; snippet: string }[] = [];
      const anchors = Array.from(document.querySelectorAll('div#search a')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const href = a.href;
        if (!href) continue;
        if (current.has(href) || seen.has(href)) continue;
        const container = a.closest('div.g, div.MjjYud, div.Gx5Zad') as HTMLElement | null;
        if (!container) continue;
        if (container.querySelector('[data-hveid] [role="list"]') || container.closest('[data-hveid] [role="list"]')) continue;
        const snippetEl = container.querySelector('div.VwiC3b, div.IsZvec, div[data-sncf="1"], span.aCOpRe') as HTMLElement | null;
        items.push({ title: (h3 as HTMLElement).textContent?.trim() || '', url: href, snippet: snippetEl?.textContent?.trim() || '' });
        seen.add(href);
      }
      return items;
    });
    const byUrl = new Map<string, SerpItem>();
    for (const r of [...results, ...fallback]) {
      if (!r?.url) continue;
      if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
    results = Array.from(byUrl.values());
  }
  results = results.map(r => ({ ...r, url: sanitizeUrl(r.url) }));
  return results.slice(0, limit);
}

export async function searchGoogle(query: string, options: SearchOptions = {}): Promise<SerpResult> {
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

  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  };
  const parsedProxy = parseProxy(proxy);
  if (parsedProxy) launchOpts.proxy = parsedProxy as any;

  const browser = await chromium.launch(launchOpts);
  const baseDevice = devices['Desktop Chrome'];
  const viewport = {
    width: (baseDevice.viewport?.width || 1280) + randInt(-60, 60),
    height: (baseDevice.viewport?.height || 720) + randInt(-40, 40),
  };
  const context: BrowserContext = await browser.newContext({
    ...baseDevice,
    viewport,
    locale: hl,
    userAgent: baseDevice.userAgent?.replace('Headless', '') || undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  let lastErr: any;
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (ncr) {
          await page.goto(`https://www.${domain}/ncr`, { waitUntil: 'domcontentloaded' });
          await jitter(delayMinMs, delayMaxMs);
        }

        const collected: SerpItem[] = [];
        const seen = new Set<string>();
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
          if (await isBlocked(page)) throw new Error('Blocked by Google (captcha/sorry page)');

          const pageResults = await extractResults(page, perPage, { tbm });
          for (const r of pageResults) {
            if (r?.url && !seen.has(r.url)) {
              seen.add(r.url);
              collected.push(r);
              if (collected.length >= num) break;
            }
          }
          if (collected.length >= num) break;
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
          try { await fsWriteFile(debugHtmlPath, await page.content(), 'utf8'); } catch {}
        }
        if (debugScreenshotPath) {
          try { await page.screenshot({ path: debugScreenshotPath, fullPage: true }); } catch {}
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

