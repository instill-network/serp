import { chromium, firefox, webkit, devices, type BrowserContext, type Page, type BrowserType } from 'playwright';

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
  proxy?: ProxyInput;
  keepOpen?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  useSystemProxy?: boolean; // if true and no proxy provided, do not disable system proxy
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

export type NavigationTimings = {
  startTime: number;
  fetchStart: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  domContentLoadedEventEnd: number;
  loadEventEnd: number;
};

export type DurationSummary = {
  connect: number | null;
  tls: number | null;
  ttfb: number | null;
  contentDownload: number | null;
  dcl: number | null;
  load: number | null;
  total: number | null;
};

export interface DetailedSerpResult extends SerpResult {
  ok: boolean;
  blocked: boolean;
  blockType?: string;
  timings?: DurationSummary & { raw: NavigationTimings };
  close?: () => Promise<void>; // Provided only when keepOpen is true
}

export function parseProxy(input?: ProxyInput): ( { server: string; username?: string; password?: string } & { authRaw?: string; scheme?: string } ) | undefined {
  if (!input) return undefined;
  if (typeof input !== 'string') return input as any;
  let raw = input.trim();
  if (!/^\w+:\/\//i.test(raw)) raw = `http://${raw}`;

  // Manual parse to preserve special characters in credentials
  // Format: scheme://[username[:password]@]host[:port]
  const m = raw.match(/^(?<scheme>[^:]+):\/\/(?:(?<auth>[^@]*)@)?(?<hostport>.+)$/);
  if (!m || !m.groups) return { server: raw } as any;
  const scheme = m.groups.scheme;
  const authRaw = m.groups.auth || undefined;
  const hostport = m.groups.hostport;
  let username: string | undefined;
  let password: string | undefined;
  if (authRaw) {
    const idx = authRaw.indexOf(':');
    if (idx >= 0) {
      username = authRaw.slice(0, idx);
      password = authRaw.slice(idx + 1);
    } else {
      username = authRaw;
      password = undefined;
    }
  }
  const server = `${scheme}://${hostport}`;
  return { server, username, password, authRaw, scheme } as any;
}

export async function acceptGoogleConsent(page: Page) {
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
      } catch {}
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
        } catch {}
      }
    } catch {}
  }
}

export function buildSearchUrl(query: string, opts: {
  domain?: string; hl?: string; gl?: string; num?: number; safe?: string; tbs?: string;
} = {}): string {
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

function sanitizeUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.hash.includes(':~:')) u.hash = '';
    return u.toString();
  } catch {
    return href;
  }
}

export async function extractResults(page: Page, limit = 10, timeout: number = 1500000): Promise<SerpItem[]> {
	// Note: default timeout is intentionally high for CLI dev. Callers can override.
  await page.waitForSelector('div#search', { timeout });
  await page.waitForFunction(() => !!document.querySelector('div#search a h3'), null, { timeout });

  const organic = await page.evaluate(() => {
    const items: { title: string; url: string; snippet: string }[] = [];
    const anchors = Array.from(document.querySelectorAll('div#search .yuRUbf > a')) as HTMLAnchorElement[];
    for (const a of anchors) {
      const h3 = a.querySelector('h3');
      if (!h3) continue;
      const g = a.closest('div.g') as HTMLElement | null;
      const snippetEl = g?.querySelector('div.VwiC3b, div.IsZvec, div[data-sncf="1"], span.aCOpRe') as HTMLElement | null;
      items.push({
        title: h3.textContent?.trim() || '',
        url: a.href,
        snippet: snippetEl?.textContent?.trim() || ''
      });
    }
    return items;
  });

  let results = organic as SerpItem[];

  if (results.length < limit) {
    const fallback = await page.evaluate(() => {
      const seen = new Set<string>();
      const current = new Set<string>(((globalThis as any).__existingResults || []).map((r: any) => r.url));
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
        items.push({
          title: (h3 as HTMLElement).textContent?.trim() || '',
          url: href,
          snippet: snippetEl?.textContent?.trim() || ''
        });
        seen.add(href);
      }
      return items;
    });
    const byUrl = new Map<string, SerpItem>();
    for (const r of [...results, ...fallback]) {
      if (!r?.url) continue;
      if (!byUrl.has(r.url)) byUrl.set(r.url, r as SerpItem);
    }
    results = Array.from(byUrl.values());
  }

  results = results.map(r => ({ ...r, url: sanitizeUrl(r.url) }));
  return results.slice(0, limit);
}

export function computeDurations(t: NavigationTimings): DurationSummary {
  const connect = (t.connectEnd && t.connectStart) ? Math.max(0, t.connectEnd - t.connectStart) : null;
  const tls = (t.secureConnectionStart && t.connectEnd && t.secureConnectionStart > 0) ? Math.max(0, t.connectEnd - t.secureConnectionStart) : null;
  const ttfb = (t.responseStart && t.requestStart) ? Math.max(0, t.responseStart - t.requestStart) : null;
  const contentDownload = (t.responseEnd && t.responseStart) ? Math.max(0, t.responseEnd - t.responseStart) : null;
  const dcl = (t.domContentLoadedEventEnd && t.startTime !== undefined && t.domContentLoadedEventEnd > 0) ? Math.max(0, t.domContentLoadedEventEnd - t.startTime) : null;
  const load = (t.loadEventEnd && t.startTime !== undefined && t.loadEventEnd > 0) ? Math.max(0, t.loadEventEnd - t.startTime) : null;
  let total: number | null = null;
  if (t.loadEventEnd && t.loadEventEnd > 0 && t.fetchStart !== undefined) {
    total = Math.max(0, t.loadEventEnd - t.fetchStart);
  } else if (t.domContentLoadedEventEnd && t.domContentLoadedEventEnd > 0 && t.fetchStart !== undefined) {
    total = Math.max(0, t.domContentLoadedEventEnd - t.fetchStart);
  } else if (t.responseEnd && t.fetchStart !== undefined) {
    total = Math.max(0, t.responseEnd - t.fetchStart);
  }
  return { connect, tls, ttfb, contentDownload, dcl, load, total };
}

export async function searchGoogleDetailed(query: string, options: SearchOptions & { resultWaitTimeoutMs?: number } = {}): Promise<DetailedSerpResult> {
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
    keepOpen = false,
    browser: browserName = 'chromium',
    useSystemProxy = false,
    resultWaitTimeoutMs,
  } = options;

  const url = buildSearchUrl(query, { hl, gl, domain, num, safe, tbs });
  const launchOpts: Parameters<BrowserType['launch']>[0] = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run'
    ],
  };
  const parsedProxy = parseProxy(proxy);
  if (parsedProxy) {
    if (/^socks/i.test(parsedProxy.server)) {
      throw new Error('Authenticated SOCKS proxies are not supported by Playwright. Use an HTTP proxy.');
    }
    (launchOpts as any).proxy = {
      server: parsedProxy.server,
      username: parsedProxy.username,
      password: parsedProxy.password,
    };
  } else {
    if (!useSystemProxy) {
      (launchOpts.args as string[]).push('--no-proxy-server');
    }
  }

  let browserType: BrowserType;
  if (browserName === 'firefox') browserType = firefox;
  else if (browserName === 'webkit') browserType = webkit;
  else browserType = chromium;
  const browser = await browserType.launch(launchOpts);

  const deviceName = browserType === chromium ? 'Desktop Chrome' : browserType === firefox ? 'Desktop Firefox' : 'Desktop Safari';
  const baseDevice = devices[deviceName];
  const context: BrowserContext = await browser.newContext({
    ...baseDevice,
    locale: hl,
    userAgent: baseDevice.userAgent?.replace('Headless', '') || undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  const close = async () => {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  };

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await acceptGoogleConsent(page);
    if (!/\/search\?/.test(page.url())) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    // Block detection
    const status = resp?.status?.() ?? 200;
    const bodyText = (await page.locator('body').first().textContent({ timeout: 5000 })) || '';
    const html = await page.content();
    const lower = (bodyText + ' ' + html).toLowerCase();
    const blockPhrases = [
      'unusual traffic', 'sorry', 'are you a robot', 'verify you are human',
      'our systems have detected', 'to continue, please type the characters', 'recaptcha'
    ];
    const hitPhrase = blockPhrases.find(p => lower.includes(p));

    // Extract results
    const results = await extractResults(page, num, resultWaitTimeoutMs ?? 15000);

    // Navigation timings
    const t: NavigationTimings = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as any;
      if (!e) return {
        startTime: 0, fetchStart: 0, domainLookupStart: 0, domainLookupEnd: 0,
        connectStart: 0, secureConnectionStart: 0, connectEnd: 0, requestStart: 0,
        responseStart: 0, responseEnd: 0, domContentLoadedEventEnd: 0, loadEventEnd: 0,
      };
      return {
        startTime: e.startTime,
        fetchStart: e.fetchStart,
        domainLookupStart: e.domainLookupStart,
        domainLookupEnd: e.domainLookupEnd,
        connectStart: e.connectStart,
        secureConnectionStart: e.secureConnectionStart,
        connectEnd: e.connectEnd,
        requestStart: e.requestStart,
        responseStart: e.responseStart,
        responseEnd: e.responseEnd,
        domContentLoadedEventEnd: e.domContentLoadedEventEnd,
        loadEventEnd: e.loadEventEnd,
      } as any;
    });
    const durs = computeDurations(t);

    const ok = !(status >= 400 || !!hitPhrase) && results.length > 0;
    const out: DetailedSerpResult = {
      query,
      url: page.url(),
      results,
      ok,
      blocked: (status >= 400) || !!hitPhrase,
      blockType: (status >= 400) ? `http-${status}` : (!!hitPhrase ? 'captcha/block-page' : (!ok ? 'no-results' : undefined)),
      timings: { ...durs, raw: t },
    };
    if (keepOpen) (out as any).close = close;
    return out;
  } finally {
    if (!keepOpen) {
      await close();
    }
  }
}

export async function searchGoogle(query: string, options: SearchOptions = {}): Promise<SerpResult> {
  const detailed = await searchGoogleDetailed(query, options);
  const out: any = { query: detailed.query, url: detailed.url, results: detailed.results };
  if (options.keepOpen && typeof (detailed as any).close === 'function') {
    out.close = (detailed as any).close;
  }
  return out as SerpResult;
}
