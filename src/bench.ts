#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { type SearchOptions, searchGoogleDetailed, type NavigationTimings } from './googleSerp';

type Vendor = { name: string; proxy?: string | null };
type BenchArgs = {
  proxies?: string;
  queries?: string;
  concurrency: number[];
  plateauSec: number;
  hl?: string;
  gl?: string;
  domain?: string;
  num?: number;
  tbs?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  outDir: string;
  baseline?: string;
};

type TimingEntry = NavigationTimings;

type OneRun = {
  vendor: string;
  query: string;
  url?: string;
  ok: boolean;
  blocked: boolean;
  blockType?: string;
  error?: string;
  ts: number;
  timings?: {
    connect: number | null;
    tls: number | null;
    ttfb: number | null;
    contentDownload: number | null;
    dcl: number | null;
    load: number | null;
    total: number | null;
    raw: TimingEntry;
  };
  results?: { url: string; title?: string }[];
};

function parseArgs(argv: string[]): BenchArgs {
  const args: any = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--proxies') args.proxies = argv[++i];
    else if (a === '--queries') args.queries = argv[++i];
    else if (a === '--concurrency' || a === '-c') args.concurrency = argv[++i];
    else if (a === '--plateau-sec') args.plateauSec = Number(argv[++i]);
    else if (a === '--hl') args.hl = argv[++i];
    else if (a === '--gl') args.gl = argv[++i];
    else if (a === '--domain') args.domain = argv[++i];
    else if (a === '--num' || a === '-n') args.num = Number(argv[++i]);
    else if (a === '--tbs') args.tbs = argv[++i];
    else if (a === '--browser') args.browser = argv[++i];
    else if (a === '--headful') args.headless = false;
    else if (a === '--out' || a === '-o') args.outDir = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const out: BenchArgs = {
    proxies: args.proxies,
    queries: args.queries,
    concurrency: typeof args.concurrency === 'string' ? args.concurrency.split(',').map((x: string) => Number(x.trim())).filter(Boolean) : [1, 5, 10],
    plateauSec: Number.isFinite(args.plateauSec) ? args.plateauSec : 60,
    hl: args.hl ?? 'en',
    gl: args.gl,
    domain: args.domain ?? 'google.com',
    num: Number.isFinite(args.num) ? args.num : 10,
    tbs: args.tbs,
    browser: (['chromium','firefox','webkit'] as const).includes(args.browser) ? args.browser : 'chromium',
    headless: args.headless !== false,
    outDir: args.outDir || path.join(process.cwd(), 'bench_out', new Date().toISOString().replace(/[:.]/g, '-')),
    baseline: args.baseline,
  };
  return out;
}

function printHelp() {
  console.log(`Usage: serp-bench [options]\n\nOptions:\n  --proxies <file>     JSON file with vendors [{ name, proxy }]\n  --queries <file>     Text file with one query per line\n  -c, --concurrency    Comma list (default 1,5,10)\n  --plateau-sec <N>    Seconds per concurrency plateau (default 60)\n  --hl <lang>          UI language (default en)\n  --gl <cc>            Country code (e.g., US)\n  --domain <host>      Google domain (default google.com)\n  -n, --num <N>        Results per query (default 10)\n  --tbs <val>          Time filter (e.g., qdr:w)\n  --browser <name>     chromium | firefox | webkit (default chromium)\n  --headful            Run non-headless\n  -o, --out <dir>      Output directory (default bench_out/<timestamp>)\n  --baseline <name>    Vendor name to use as correctness baseline\n  -h, --help           Show help\n`);
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function loadVendors(file?: string): Vendor[] {
  if (!file) return [ { name: 'direct', proxy: null } ];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.vendors)) return raw.vendors;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([name, proxy]) => ({ name, proxy: String(proxy) }))
  }
  throw new Error('Invalid proxies file format');
}

function loadQueries(file?: string): string[] {
  if (!file) {
    return [
      'best coffee makers',
      'javascript array sort',
      'weather in san francisco',
      'buy iphone 15',
      'node.js playwright guide',
      'pizza near me',
      'latest tech news',
      'python dataclass',
      'nba standings',
      'typescript enums'
    ];
  }
  const txt = fs.readFileSync(file, 'utf8');
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function randPick<T>(arr: T[]): T { return arr[Math.floor(Math.random()*arr.length)] }

// Durations are provided by searchGoogleDetailed

async function runOne(vendor: Vendor, query: string, opts: Omit<SearchOptions,'proxy'> & { browser: 'chromium'|'firefox'|'webkit' }): Promise<OneRun> {
  const outBase: OneRun = { vendor: vendor.name, query, ok: false, blocked: false, ts: Date.now() };
  try {
    const r = await searchGoogleDetailed(query, {
      hl: opts.hl, gl: opts.gl, num: opts.num, domain: opts.domain, tbs: opts.tbs, safe: 'off',
      browser: opts.browser, headless: opts.headless, proxy: vendor.proxy || undefined, useSystemProxy: false,
      resultWaitTimeoutMs: 8000,
    });
    const out: OneRun = {
      ...outBase,
      url: r.url,
      ok: r.ok,
      blocked: r.blocked,
      blockType: r.blockType,
      timings: r.timings as any,
      results: r.results.map(i => ({ url: i.url, title: i.title })),
    };
    return out;
  } catch (err: any) {
    const msg = err?.message || String(err);
    let blocked = false;
    let blockType: string | undefined = undefined;
    if (/ERR_PROXY_CONNECTION_FAILED/i.test(msg)) {
      blocked = true;
      blockType = 'proxy-conn-failed';
    } else if (/^page\.goto: net::ERR_/i.test(msg)) {
      blocked = true;
      blockType = 'network-error';
    }
    return { ...outBase, ok: false, blocked, blockType, error: msg };
  }
}

function percentile(nums: number[], p: number): number | null {
  const xs = nums.filter(n => Number.isFinite(n)).slice().sort((a,b) => a-b);
  if (xs.length === 0) return null;
  const idx = Math.ceil((p/100) * xs.length) - 1;
  return xs[Math.min(Math.max(idx, 0), xs.length - 1)];
}

function summarize(results: OneRun[]) {
  const byVendor: Record<string, OneRun[]> = {};
  for (const r of results) {
    (byVendor[r.vendor] ||= []).push(r);
  }
  const summary: any = {};
  for (const [vendor, arr] of Object.entries(byVendor)) {
    const ok = arr.filter(r => r.ok).length;
    const blocked = arr.filter(r => r.blocked).length;
    const total = arr.length;
    const ttfb = arr.map(r => r.timings?.ttfb || NaN).filter(n => Number.isFinite(n)) as number[];
    const totalLoad = arr.map(r => r.timings?.total || NaN).filter(n => Number.isFinite(n)) as number[];
    summary[vendor] = {
      total,
      ok,
      blocked,
      successRate: total ? ok/total : 0,
      blockRate: total ? blocked/total : 0,
      p50: { ttfb: percentile(ttfb, 50), total: percentile(totalLoad, 50) },
      p95: { ttfb: percentile(ttfb, 95), total: percentile(totalLoad, 95) },
      p99: { ttfb: percentile(ttfb, 99), total: percentile(totalLoad, 99) },
    };
  }
  return { byVendor, summary };
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter(x => B.has(x));
  const union = new Set([...A, ...B]);
  return union.size ? inter.length / union.size : 0;
}

function computeCorrectness(results: OneRun[], baselineName?: string) {
  const byVendor: Record<string, Record<string, OneRun>> = {};
  for (const r of results) {
    (byVendor[r.vendor] ||= {})[r.query] = r;
  }
  const vendors = Object.keys(byVendor);
  if (vendors.length === 0) return {};
  const baseVendor = baselineName && vendors.includes(baselineName) ? baselineName : vendors[0];
  const out: any = { baseline: baseVendor, jaccard: {} };
  for (const v of vendors) {
    if (v === baseVendor) continue;
    const queries = Object.keys(byVendor[v]);
    const scores: number[] = [];
    for (const q of queries) {
      const a = (byVendor[baseVendor][q]?.results || []).map(r => r.url);
      const b = (byVendor[v][q]?.results || []).map(r => r.url);
      if (a.length && b.length) scores.push(jaccard(a.slice(0,10), b.slice(0,10)));
    }
    out.jaccard[v] = { avg: scores.length ? (scores.reduce((s,x)=>s+x,0)/scores.length) : null, count: scores.length };
  }
  // Also include baseline vendor with self-overlap = 1.0 for chart alignment
  const baseQueries = Object.keys(byVendor[baseVendor] || {});
  const baseCount = baseQueries.filter(q => ((byVendor[baseVendor][q]?.results || []).length > 0)).length;
  out.jaccard[baseVendor] = { avg: 1, count: baseCount };
  return out;
}

function renderReportHTML(data: { args: BenchArgs; results: OneRun[]; summary: any; correctness: any }) {
  const vendors = Object.keys(data.summary);
  const succRates = vendors.map(v => (data.summary[v].successRate * 100).toFixed(1));
  const p95Total = vendors.map(v => Math.round(data.summary[v].p95.total || 0));
  const correctness = data.correctness?.jaccard || {};
  const corrBaseline = data.correctness?.baseline || vendors[0] || '';
  const corrVendors = vendors.slice();
  const corrScores = corrVendors.map(v => {
    if (v === corrBaseline) return 1;
    const avg = correctness[v]?.avg;
    return (typeof avg === 'number' && Number.isFinite(avg)) ? Number(avg.toFixed(3)) : null;
  });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>serp-bench report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; margin: 24px; }
    h1 { margin-bottom: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 14px; }
    .small { color: #555; font-size: 12px; }
    canvas { width: 100%; height: 240px; }
  </style>
</head>
<body>
  <h1>serp-bench</h1>
  <div class="small">Generated: ${new Date().toISOString()}</div>
  <p class="small">Args: ${escapeHtml(JSON.stringify({ ...data.args, queries: undefined, proxies: undefined }, null, 2))}</p>

  <div class="grid">
    <div class="card">
      <h3>Success Rate (%)</h3>
      <canvas id="succ"></canvas>
    </div>
    <div class="card">
      <h3>p95 Total Load (ms)</h3>
      <canvas id="p95"></canvas>
    </div>
    <div class="card">
      <h3>Correctness (Top-10 Jaccard vs ${escapeHtml(data.correctness?.baseline || vendors[0] || '')})</h3>
      <canvas id="corr"></canvas>
    </div>
  </div>

  <h3>Summary</h3>
  <table>
    <thead><tr><th>Vendor</th><th>Total</th><th>OK</th><th>Blocked</th><th>Success %</th><th>p95 TTFB</th><th>p95 Total</th></tr></thead>
    <tbody>
      ${vendors.map(v => `<tr><td>${escapeHtml(v)}</td><td>${data.summary[v].total}</td><td>${data.summary[v].ok}</td><td>${data.summary[v].blocked}</td><td>${(data.summary[v].successRate*100).toFixed(1)}</td><td>${Math.round(data.summary[v].p95.ttfb || 0)}</td><td>${Math.round(data.summary[v].p95.total || 0)}</td></tr>`).join('')}
    </tbody>
  </table>

  <script>
  const vendors = ${JSON.stringify(vendors)};
  const succRates = ${JSON.stringify(succRates.map(Number))};
  const p95Total = ${JSON.stringify(p95Total)};
  const corrVendors = ${JSON.stringify(corrVendors)};
  const corrScores = ${JSON.stringify(corrScores)};

  function bar(canvasId, labels, values, color) {
    const c = document.getElementById(canvasId);
    const ctx = c.getContext('2d');
    const w = c.width = c.clientWidth * devicePixelRatio;
    const h = c.height = c.clientHeight * devicePixelRatio;
    const pad = 20 * devicePixelRatio;
    const barW = (w - pad*2) / labels.length * 0.7;
    const numeric = values.map(v => (typeof v === 'number' && isFinite(v)) ? v : NaN);
    const finite = numeric.filter(v => isFinite(v));
    const max = Math.max(...(finite.length ? finite : [1]));
    ctx.clearRect(0,0,w,h);
    ctx.font = (12*devicePixelRatio) + 'px system-ui, sans-serif';
    ctx.fillStyle = '#333';
    labels.forEach((lab, i) => {
      const x = pad + i * ((w - pad*2) / labels.length) + (((w - pad*2) / labels.length) - barW)/2;
      const val = values[i];
      ctx.fillStyle = '#333';
      ctx.fillText(String(lab), x, h - pad + 14*devicePixelRatio);
      if (typeof val === 'number' && isFinite(val)) {
        const bh = (h - pad*2) * (val / max);
        ctx.fillStyle = color;
        ctx.fillRect(x, h - pad - bh, barW, bh);
        ctx.fillStyle = '#333';
        ctx.fillText(String(val), x, h - pad - bh - 4*devicePixelRatio);
      } else {
        ctx.fillStyle = '#777';
        ctx.fillText('N/A', x, h - pad - 4*devicePixelRatio);
      }
    });
  }
  bar('succ', vendors, succRates, '#3b82f6');
  bar('p95', vendors, p95Total, '#10b981');
  bar('corr', corrVendors, corrScores, '#f59e0b');
  </script>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'} as any)[c]);
}

async function main() {
  const args = parseArgs(process.argv);
  const vendorsIn = loadVendors(args.proxies);
  const vendors = vendorsIn.slice().sort((a, b) => (a.name === 'direct' ? -1 : (b.name === 'direct' ? 1 : 0)));
  const queries = loadQueries(args.queries);
  ensureDir(args.outDir);

  const allResults: OneRun[] = [];
  console.log(`Vendors: ${vendors.map(v => v.name).join(', ')}`);
  console.log(`Queries: ${queries.length}`);
  console.log(`Concurrency: ${args.concurrency.join(', ')} (plateau ${args.plateauSec}s)`);

  for (const conc of args.concurrency) {
    for (const vendor of vendors) {
      console.log(`\n== Vendor ${vendor.name} at concurrency ${conc} for ${args.plateauSec}s ==`);
      const deadline = Date.now() + args.plateauSec * 1000;
      const workers: Promise<void>[] = [];
      for (let i = 0; i < conc; i++) {
        workers.push((async () => {
          while (Date.now() < deadline) {
            const q = randPick(queries);
            try {
              const r = await runOne(vendor, q, {
                hl: args.hl, gl: args.gl, num: args.num, domain: args.domain, tbs: args.tbs, safe: 'off',
                browser: args.browser!, headless: args.headless,
              });
              allResults.push(r);
              if (!r.ok) {
                console.log(`[${vendor.name}] blocked/error for "${q}": ${r.blockType || r.error}`);
              }
            } catch (err: any) {
              allResults.push({ vendor: vendor.name, query: q, ok: false, blocked: false, error: err?.message || String(err), ts: Date.now() });
            }
          }
        })());
      }
      await Promise.allSettled(workers);
    }
  }

  const summary = summarize(allResults);
  const correctness = computeCorrectness(allResults, args.baseline);
  const outData = { args, results: allResults, summary: summary.summary, correctness };
  fs.writeFileSync(path.join(args.outDir, 'results.json'), JSON.stringify(outData, null, 2));
  fs.writeFileSync(path.join(args.outDir, 'report.html'), renderReportHTML(outData), 'utf8');
  console.log(`\nSaved results to ${path.join(args.outDir, 'results.json')}`);
  console.log(`Open report: ${path.join(args.outDir, 'report.html')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
