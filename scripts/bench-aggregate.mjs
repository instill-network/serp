#!/usr/bin/env node
/**
 * NDJSON/JSON aggregator for SERP bench outputs.
 *
 * - Supports two input formats:
 *   1) bench_out\/* *\/results.json from src/bench.ts (array under results[])
 *   2) NDJSON lines like bench_out\/* *\/samples.ndjson
 *
 * - Computes key metrics outlined in the benchmarking rubric:
 *   Speed, reliability, root-cause stages, tail stability, concurrency curve,
 *   correctness (TopK Jaccard), and pass/fail hints.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function parseArgs(argv) {
  const out = { files: [], baseline: 'direct', topk: 10, pricePerGB: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.files.push(argv[++i]);
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--topk') out.topk = Number(argv[++i]);
    else if (a === '--price-per-gb') out.pricePerGB = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.files.push(a);
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/bench-aggregate.mjs [--file <path>]... [--baseline <vendor>] [--topk <N>] [--price-per-gb <USD>]

Inputs:
  - bench_out/**/results.json  (from serp-bench)
  - bench_out/**/samples.ndjson (one JSON object per line)

Examples:
  node scripts/bench-aggregate.mjs -f bench_out/2025-09-11T20-19-38-729Z/results.json
  node scripts/bench-aggregate.mjs -f bench_out/**/samples.ndjson
`);
}

function percentile(nums, p) {
  const xs = nums.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if (!xs.length) return null;
  const idx = Math.ceil((p/100) * xs.length) - 1;
  return xs[Math.min(Math.max(idx, 0), xs.length - 1)];
}

function jaccard(a, b, k = 10) {
  const A = new Set((a || []).slice(0, k));
  const B = new Set((b || []).slice(0, k));
  const inter = [...A].filter(x => B.has(x));
  const union = new Set([...A, ...B]);
  return union.size ? inter.length / union.size : null;
}

function safeNum(n) { return (typeof n === 'number' && Number.isFinite(n)) ? n : null; }

function unifyFromResultsJson(doc) {
  const events = [];
  const arr = Array.isArray(doc?.results) ? doc.results : [];
  for (const r of arr) {
    const vendor = String(r.vendor || 'unknown');
    const ok = !!r.ok;
    const blocked = !!r.blocked;
    const blockType = r.blockType || null;
    const ts = typeof r.ts === 'number' ? r.ts : (r.ts ? Date.parse(r.ts) : Date.now());
    const conc = Number.isFinite(r.conc) ? Number(r.conc) : null;
    const timings = r.timings || {};
    // Derive DNS from raw NavigationTimings when available
    let dns = null;
    if (timings?.raw && Number.isFinite(timings.raw.domainLookupEnd) && Number.isFinite(timings.raw.domainLookupStart)) {
      const d = Math.max(0, timings.raw.domainLookupEnd - timings.raw.domainLookupStart);
      dns = Number.isFinite(d) ? d : null;
    }
    const connect = safeNum(timings.connect);
    const tls = safeNum(timings.tls);
    const ttfb = safeNum(timings.ttfb);
    const total = safeNum(timings.total);
    const query = r.query || null;
    const top = Array.isArray(r.results) ? r.results.map(x => x?.url).filter(Boolean) : [];
    events.push({
      vendor, ok, blocked, blockType, ts, conc,
      dns, connect, tls, ttfb, total,
      query, topk: top,
      // placeholders for schema compatibility
      failure_reason: blockType || (r.error ? 'error' : null),
      captcha: (blockType && /captcha/i.test(blockType)) || false,
      session_id: null, ip: null, hint_geo: null, observed_geo: null, bytes_up: null, bytes_down: null,
    });
  }
  return events;
}

async function unifyFromNdjsonFile(file) {
  const events = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      const vendor = String(o.vendor || o.path || 'unknown');
      const ok = !!o.ok;
      const blocked = !!o.blocked;
      const captcha = !!o.captcha;
      const ts = o.ts ? (typeof o.ts === 'number' ? o.ts : Date.parse(o.ts)) : Date.now();
      const conc = Number.isFinite(o.conc) ? o.conc : (Number.isFinite(o.concurrency) ? o.concurrency : null);
      // stage timings may be absent in NDJSON samples
      const dns = safeNum(o.dns_ms);
      const connect = safeNum(o.connect_ms) ?? safeNum(o.tcp_ms);
      const tls = safeNum(o.tls_ms);
      const ttfb = safeNum(o.ttfb_ms);
      const total = safeNum(o.total_ms);
      const topk = Array.isArray(o.top10) ? o.top10 : (Array.isArray(o.topk) ? o.topk : []);
      events.push({
        vendor, ok, blocked, blockType: o.blockType || o.failure_reason || null,
        failure_reason: o.failure_reason || o.blockType || (o.err ? 'error' : null),
        captcha, ts, conc,
        dns, connect, tls, ttfb, total,
        query: o.q || o.query || null, topk,
        session_id: o.session_id || o.session || null,
        ip: o.ip || null,
        hint_geo: o.hint_geo || null,
        observed_geo: o.observed_geo || null,
        bytes_up: Number.isFinite(o.bytes_up) ? o.bytes_up : null,
        bytes_down: Number.isFinite(o.bytes_down) ? o.bytes_down : null,
      });
    } catch {}
  }
  return events;
}

async function loadAll(files) {
  const events = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f).toLowerCase();
    if (ext === '.json' && base === 'results.json') {
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        events.push(...unifyFromResultsJson(doc));
      } catch (e) {
        console.error(`Failed to read ${f}:`, e?.message || e);
      }
    } else if (ext === '.ndjson' || ext === '.log' || base.includes('samples')) {
      events.push(...await unifyFromNdjsonFile(f));
    } else {
      // Try detect JSON with results[]
      try {
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(doc?.results)) {
          events.push(...unifyFromResultsJson(doc));
          continue;
        }
      } catch {}
      // Fallback NDJSON line reader
      try {
        events.push(...await unifyFromNdjsonFile(f));
      } catch (e) {
        console.error(`Unrecognized file format: ${f}`);
      }
    }
  }
  // Sort by time for survival calculations
  events.sort((a,b) => (a.ts||0) - (b.ts||0));
  return events;
}

function groupByVendor(events) {
  const by = {};
  for (const e of events) (by[e.vendor] ||= []).push(e);
  return by;
}

function pickSuccesses(arr) { return arr.filter(e => e.ok); }

function pstats(xs, field) {
  const v = xs.map(e => e[field]).filter(Number.isFinite);
  return {
    p50: percentile(v, 50),
    p90: percentile(v, 90),
    p95: percentile(v, 95),
    p99: percentile(v, 99),
  };
}

function tailAmp(xs, field = 'total') {
  const v = xs.map(e => e[field]).filter(Number.isFinite);
  const p50 = percentile(v, 50);
  const p99 = percentile(v, 99);
  return (p50 && p99) ? (p99 / p50) : null;
}

function reliability(arr) {
  const total = arr.length;
  const ok = arr.filter(e => e.ok).length;
  const blocked = arr.filter(e => e.blocked).length;
  const captcha = arr.filter(e => e.captcha).length;
  const timeouts = arr.filter(e => /timeout/i.test(e.failure_reason || '')).length;
  const reasonCounts = {};
  for (const e of arr) {
    const r = (e.failure_reason || e.blockType || (e.blocked ? 'blocked' : (e.ok ? 'success' : 'error')));
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  }
  return {
    total, ok, blocked, captcha, timeouts,
    successRate: total ? ok/total : null,
    blockedRate: total ? blocked/total : null,
    captchaRate: total ? captcha/total : null,
    timeoutRate: total ? timeouts/total : null,
    reasons: reasonCounts,
  };
}

function stageOverheads(vDirect, vProxy) {
  // p95s on success only
  const sD = pickSuccesses(vDirect);
  const sP = pickSuccesses(vProxy);
  const haveD = sD.length > 0;
  const haveP = sP.length > 0;
  if (!haveD || !haveP) {
    return {
      dns_p95: { direct: haveD ? pstats(sD, 'dns').p95 : null, proxy: null },
      tcp_p95: { direct: haveD ? pstats(sD, 'connect').p95 : null, proxy: null },
      tls_p95: { direct: haveD ? pstats(sD, 'tls').p95 : null, proxy: null },
      ttfb_p95: { direct: haveD ? pstats(sD, 'ttfb').p95 : null, proxy: null },
      pre_origin_overhead_ms: null,
      ttfb_overhead_ms: null,
    };
  }
  const p95DnsD = pstats(sD, 'dns').p95;
  const p95ConD = pstats(sD, 'connect').p95;
  const p95TlsD = pstats(sD, 'tls').p95;
  const p95DnsP = pstats(sP, 'dns').p95;
  const p95ConP = pstats(sP, 'connect').p95;
  const p95TlsP = pstats(sP, 'tls').p95;
  const preOriginDirect = (Number.isFinite(p95DnsD) ? p95DnsD : 0) + (Number.isFinite(p95ConD) ? p95ConD : 0) + (Number.isFinite(p95TlsD) ? p95TlsD : 0);
  const preOriginProxy = (Number.isFinite(p95DnsP) ? p95DnsP : 0) + (Number.isFinite(p95ConP) ? p95ConP : 0) + (Number.isFinite(p95TlsP) ? p95TlsP : 0);
  const preOriginOverhead = (Number.isFinite(preOriginProxy) && Number.isFinite(preOriginDirect)) ? (preOriginProxy - preOriginDirect) : null;
  const ttfbD = pstats(sD, 'ttfb').p95;
  const ttfbP = pstats(sP, 'ttfb').p95;
  const ttfbOverhead = (Number.isFinite(ttfbP) && Number.isFinite(ttfbD)) ? (ttfbP - ttfbD) : null;
  return {
    dns_p95: { direct: Number.isFinite(p95DnsD) ? p95DnsD : null, proxy: Number.isFinite(p95DnsP) ? p95DnsP : null },
    tcp_p95: { direct: Number.isFinite(p95ConD) ? p95ConD : null, proxy: Number.isFinite(p95ConP) ? p95ConP : null },
    tls_p95: { direct: Number.isFinite(p95TlsD) ? p95TlsD : null, proxy: Number.isFinite(p95TlsP) ? p95TlsP : null },
    ttfb_p95: { direct: Number.isFinite(ttfbD) ? ttfbD : null, proxy: Number.isFinite(ttfbP) ? ttfbP : null },
    pre_origin_overhead_ms: Number.isFinite(preOriginOverhead) ? preOriginOverhead : null,
    ttfb_overhead_ms: Number.isFinite(ttfbOverhead) ? ttfbOverhead : null,
  };
}

function speedDeltas(vDirect, vProxy) {
  const sD = pickSuccesses(vDirect);
  const sP = pickSuccesses(vProxy);
  const p50D = pstats(sD, 'total').p50;
  const p95D = pstats(sD, 'total').p95;
  const p50P = pstats(sP, 'total').p50;
  const p95P = pstats(sP, 'total').p95;
  const ratio95 = (Number.isFinite(p95P) && Number.isFinite(p95D) && p95D > 0) ? (p95P / p95D) : null;
  const delta50 = (Number.isFinite(p50P) && Number.isFinite(p50D)) ? (p50P - p50D) : null;
  const ttfb95D = pstats(sD, 'ttfb').p95;
  const ttfb95P = pstats(sP, 'ttfb').p95;
  const ttfbOver = (Number.isFinite(ttfb95P) && Number.isFinite(ttfb95D)) ? (ttfb95P - ttfb95D) : null;
  return {
    SRT_total: {
      direct: {
        p50: p50D || null, p90: pstats(sD, 'total').p90 || null, p95: p95D || null, p99: pstats(sD, 'total').p99 || null,
      },
      proxy: {
        p50: p50P || null, p90: pstats(sP, 'total').p90 || null, p95: p95P || null, p99: pstats(sP, 'total').p99 || null,
      }
    },
    TTFB_p95: { direct: ttfb95D || null, proxy: ttfb95P || null },
    Overhead_p50_ms: Number.isFinite(delta50) ? delta50 : null,
    Overhead_p95_ratio: Number.isFinite(ratio95) ? ratio95 : null,
    TTFB_p95_overhead_ms: Number.isFinite(ttfbOver) ? ttfbOver : null,
    TailAmp: {
      direct: tailAmp(sD, 'total'),
      proxy: tailAmp(sP, 'total'),
    }
  };
}

function concurrencyCurve(arr) {
  const byC = {};
  for (const e of arr) {
    const c = Number.isFinite(e.conc) ? e.conc : null;
    if (c == null) continue;
    (byC[c] ||= []).push(e);
  }
  const out = [];
  for (const [cStr, events] of Object.entries(byC)) {
    const c = Number(cStr);
    const ok = events.filter(e => e.ok);
    const succ = events.filter(e => e.ok).length / events.length;
    const p95 = percentile(ok.map(e => e.total).filter(Number.isFinite), 95);
    out.push({ concurrency: c, successRate: succ, SRT_p95: Number.isFinite(p95) ? p95 : null, samples: events.length });
  }
  out.sort((a,b) => a.concurrency - b.concurrency);
  return out;
}

function correctnessJaccard(arr, baselineVendor = 'direct', k = 10) {
  const byVQ = {};
  for (const e of arr) {
    const q = e.query;
    if (!q) continue;
    (byVQ[e.vendor] ||= {})[q] = e;
  }
  const vendors = Object.keys(byVQ);
  if (!vendors.includes(baselineVendor) && vendors.length) baselineVendor = vendors[0];
  const out = { baseline: baselineVendor, vendors: {} };
  for (const v of vendors) {
    if (v === baselineVendor) continue;
    const commonQs = Object.keys(byVQ[v]).filter(q => byVQ[baselineVendor][q]);
    const scores = [];
    for (const q of commonQs) {
      const a = (byVQ[baselineVendor][q]?.topk) || [];
      const b = (byVQ[v][q]?.topk) || [];
      const s = jaccard(a, b, k);
      if (s != null) scores.push(s);
    }
    out.vendors[v] = {
      avg: scores.length ? (scores.reduce((s,x)=>s+x,0) / scores.length) : null,
      count: scores.length,
    };
  }
  out.vendors[baselineVendor] = { avg: 1, count: Object.keys(byVQ[baselineVendor] || {}).length };
  return out;
}

function stickySurvival(arr) {
  // Requires session_id or ip; compute successes until first failure per session
  const byS = {};
  for (const e of arr) {
    const k = e.session_id || e.ip;
    if (!k) continue;
    (byS[k] ||= []).push(e);
  }
  const lengths = [];
  let censored = 0;
  for (const events of Object.values(byS)) {
    events.sort((a,b) => (a.ts||0) - (b.ts||0));
    let count = 0; let failed = false;
    for (const e of events) {
      if (e.ok) count++;
      else { failed = true; break; }
    }
    if (failed) lengths.push(count);
    else censored++;
  }
  return {
    p50: lengths.length ? percentile(lengths, 50) : null,
    p90: lengths.length ? percentile(lengths, 90) : null,
    samples: lengths.length,
    censored,
  };
}

function geoPoolQuality(arr) {
  const total = arr.length;
  const geoKnown = arr.filter(e => e.hint_geo || e.observed_geo);
  const accurate = geoKnown.filter(e => e.hint_geo && e.observed_geo && String(e.hint_geo).toLowerCase() === String(e.observed_geo).toLowerCase()).length;
  const ips = new Set(arr.map(e => e.ip).filter(Boolean));
  const asns = new Set(arr.map(e => e.asn || e.observed_asn).filter(Boolean));
  return {
    Geo_accuracy_pct: geoKnown.length ? (accurate / geoKnown.length) : null,
    Distinct_IPs: ips.size || null,
    Distinct_ASNs: asns.size || null,
  };
}

function costPerK(arr, pricePerGB) {
  if (!pricePerGB || !(pricePerGB > 0)) return null;
  const ok = arr.filter(e => e.ok);
  const bytes = ok.reduce((s,e) => s + (e.bytes_up || 0) + (e.bytes_down || 0), 0);
  if (!ok.length || !bytes) return null;
  const gb = bytes / (1024*1024*1024);
  const cost = pricePerGB * gb;
  const per1k = (ok.length > 0) ? (cost / ok.length * 1000) : null;
  return Number.isFinite(per1k) ? per1k : null;
}

function decidePassFail(metrics, correctness, sticky) {
  const out = {};
  const ratio = metrics.Overhead_p95_ratio;
  const succ = metrics.reliability?.successRate;
  const captcha = metrics.reliability?.captchaRate;
  const sticky50 = sticky?.p50;
  const tailDirect = metrics.TailAmp?.direct;
  const tailProxy = metrics.TailAmp?.proxy;
  const tailOk = (tailDirect && tailProxy) ? (tailProxy / tailDirect) : null; // close to 1 is good
  const jacc = correctness?.avg;
  const pass = (
    (ratio != null ? ratio <= 1.3 : true) &&
    (succ != null ? succ >= 0.98 : true) &&
    (captcha != null ? captcha <= 0.01 : true) &&
    (sticky50 != null ? sticky50 >= 10 : true) &&
    (tailOk != null ? tailOk <= 1.2 : true) &&
    (jacc != null ? jacc >= 0.9 : true)
  );
  out.pass = !!pass;
  out.thresholds = {
    Overhead_p95_ratio_max: 1.3,
    SuccessRate_min: 0.98,
    CaptchaRate_max: 0.01,
    Sticky_survival_p50_min: 10,
    TailAmp_ratio_to_direct_max: 1.2,
    TopK_Jaccard_min: 0.9,
  };
  out.observed = {
    Overhead_p95_ratio: ratio,
    SuccessRate: succ,
    CaptchaRate: captcha,
    Sticky_survival_p50: sticky50,
    TailAmp_ratio_to_direct: tailOk,
    TopK_Jaccard: jacc,
  };
  return out;
}

function quickDiagnosis(relProxy, stages) {
  const blockedHigh = (relProxy.blockedRate || 0) > 0.15; // heuristic
  const havePre = [stages.dns_p95.proxy, stages.dns_p95.direct, stages.tcp_p95.proxy, stages.tcp_p95.direct, stages.tls_p95.proxy, stages.tls_p95.direct]
    .every(v => typeof v === 'number' && isFinite(v));
  const haveTTFB = (typeof stages.ttfb_p95.proxy === 'number' && isFinite(stages.ttfb_p95.proxy)) &&
                   (typeof stages.ttfb_p95.direct === 'number' && isFinite(stages.ttfb_p95.direct));
  if (!havePre && blockedHigh) return 'Likely target ban/blocks; insufficient proxy successes to assess stages';
  if (!havePre) return 'Insufficient successful samples to assess stage timings';
  const preOk = (stages.dns_p95.proxy) <= (stages.dns_p95.direct) * 1.5 &&
                (stages.tcp_p95.proxy) <= (stages.tcp_p95.direct) * 1.5 &&
                (stages.tls_p95.proxy) <= (stages.tls_p95.direct) * 1.5;
  if (!preOk) return 'Likely network/egress issues (pre-origin p95s spiking on proxy)';
  if (haveTTFB && stages.ttfb_p95.proxy > stages.ttfb_p95.direct * 1.7) return 'Likely target throttling (proxy TTFB p95 balloons)';
  return 'No obvious single root-cause; inspect vendor/session-level logs';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.files.length) {
    printHelp();
    if (!args.files.length) process.exit(1);
  }

  const events = await loadAll(args.files);
  if (!events.length) {
    console.error('No events loaded.');
    process.exit(2);
  }
  const byVendor = groupByVendor(events);
  const vendors = Object.keys(byVendor);
  const directName = vendors.includes(args.baseline) ? args.baseline : 'direct';

  // Compute per-proxy metrics vs direct
  for (const vendor of vendors) {
    if (vendor === directName) continue;
    const vD = byVendor[directName] || [];
    const vP = byVendor[vendor] || [];
    const relD = reliability(vD);
    const relP = reliability(vP);
    const speeds = speedDeltas(vD, vP);
    const stages = stageOverheads(vD, vP);
    const conc = concurrencyCurve(vP);
    const corrAll = correctnessJaccard([...vD, ...vP], directName, args.topk);
    const corr = corrAll.vendors[vendor];
    const sticky = stickySurvival(vP);
    const geo = geoPoolQuality(vP);
    const cost = costPerK(vP, args.pricePerGB);

    const decision = decidePassFail({ ...speeds, reliability: relP }, corr, sticky);
    const diag = quickDiagnosis(relP, stages);

    // Output concise summary
    const fmtMs = v => (v == null ? 'N/A' : Math.round(v));
    const fmtPct = v => (v == null ? 'N/A' : (v*100).toFixed(1)+'%');
    const fmtRatio = v => (v == null ? 'N/A' : v.toFixed(2));

    console.log(`\n== Vendor ${vendor} vs ${directName} ==`);
    console.log(`- Success_%: ${fmtPct(relP.successRate)}  (blocked ${fmtPct(relP.blockedRate)}, captcha ${relP.captchaRate == null ? 'N/A' : (relP.captchaRate*100).toFixed(2)+'%'})`);
    console.log(`- SRT_total p50/p95 (success): ${fmtMs(speeds.SRT_total.proxy.p50)} / ${fmtMs(speeds.SRT_total.proxy.p95)} ms  (direct ${fmtMs(speeds.SRT_total.direct.p50)} / ${fmtMs(speeds.SRT_total.direct.p95)})`);
    console.log(`- Overhead_p50_ms: ${fmtMs(speeds.Overhead_p50_ms)}  Overhead_p95_ratio: ${fmtRatio(speeds.Overhead_p95_ratio)}`);
    console.log(`- TTFB_p95_overhead: ${speeds.TTFB_p95_overhead_ms == null ? 'N/A' : Math.round(speeds.TTFB_p95_overhead_ms) + ' ms'}`);
    console.log(`- TailAmp (p99/p50 total): proxy ${speeds.TailAmp.proxy?.toFixed(2) ?? 'N/A'} vs direct ${speeds.TailAmp.direct?.toFixed(2) ?? 'N/A'}`);

    console.log(`- Stage p95 (ms) success:`);
    console.log(`  DNS: proxy ${fmtMs(stages.dns_p95.proxy)}  direct ${fmtMs(stages.dns_p95.direct)}  | Pre-origin overhead: ${stages.pre_origin_overhead_ms == null ? 'N/A' : Math.round(stages.pre_origin_overhead_ms)+' ms'}`);
    console.log(`  TCP: proxy ${fmtMs(stages.tcp_p95.proxy)}  direct ${fmtMs(stages.tcp_p95.direct)}`);
    console.log(`  TLS: proxy ${fmtMs(stages.tls_p95.proxy)}  direct ${fmtMs(stages.tls_p95.direct)}`);
    console.log(`  TTFB: proxy ${fmtMs(stages.ttfb_p95.proxy)}  direct ${fmtMs(stages.ttfb_p95.direct)}  | Overhead ${stages.ttfb_overhead_ms == null ? 'N/A' : Math.round(stages.ttfb_overhead_ms)+' ms'}`);

    if (conc.length) {
      console.log(`- Concurrency curve (proxy):`);
      for (const row of conc) {
        console.log(`  c=${row.concurrency}: Success_${(row.successRate*100).toFixed(1)}%  SRT_p95=${row.SRT_p95 != null ? Math.round(row.SRT_p95)+'ms' : 'N/A'}  n=${row.samples}`);
      }
    } else {
      console.log(`- Concurrency curve: N/A (no 'conc' field in logs)`);
    }

    console.log(`- Correctness Top-${args.topk} Jaccard vs ${directName}: ${corr?.avg != null ? corr.avg.toFixed(3) : 'N/A'} (pairs=${corr?.count ?? 0})`);
    console.log(`- Sticky survival (successes before first fail): p50 ${sticky.p50 ?? 'N/A'}  p90 ${sticky.p90 ?? 'N/A'}  samples=${sticky.samples} censored=${sticky.censored}`);
    console.log(`- Geo/pool quality: Geo_accuracy_${geo.Geo_accuracy_pct != null ? (geo.Geo_accuracy_pct*100).toFixed(1)+'%' : 'N/A'}, Distinct_IPs=${geo.Distinct_IPs ?? 'N/A'}, Distinct_ASNs=${geo.Distinct_ASNs ?? 'N/A'}`);
    console.log(`- Cost per 1k successes${args.pricePerGB ? ` @$${args.pricePerGB}/GB` : ''}: ${cost != null ? ('$' + cost.toFixed(2)) : 'N/A (missing bytes or price)'}`);

    console.log(`- Decision: ${decision.pass ? 'PASS' : 'FAIL'}  (thresholds: Overhead_p95_ratio≤1.3, Success≥98%, Captcha≤1%, Sticky≥10, TailAmp≈direct, TopK_Jaccard≥0.9)`);
    console.log(`- Fail-fast hint: ${diag}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
