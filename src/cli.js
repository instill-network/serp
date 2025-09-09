#!/usr/bin/env node

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--num' || a === '-n') args.num = Number(argv[++i]);
    else if (a === '--hl') args.hl = argv[++i];
    else if (a === '--gl') args.gl = argv[++i];
    else if (a === '--domain') args.domain = argv[++i];
    else if (a === '--tbs') args.tbs = argv[++i];
    else if (a === '--tbm') args.tbm = argv[++i];
    else if (a === '--udm') args.udm = Number(argv[++i]);
    else if (a === '--safe') args.safe = argv[++i];
    else if (a === '--headful') args.headless = false;
    else if (a === '--ncr') args.ncr = true;
    else if (a === '--proxy') args.proxy = argv[++i];
    else if (a === '--debug-html') args.debugHtmlPath = argv[++i] || 'last_serp.html';
    else if (a === '--debug-screenshot') args.debugScreenshotPath = argv[++i] || 'last_serp.png';
    else if (a === '--retries') args.retries = Number(argv[++i]);
    else if (a === '--delay-min') args.delayMinMs = Number(argv[++i]);
    else if (a === '--delay-max') args.delayMaxMs = Number(argv[++i]);
    else if (a === '--no-stealth') args.noStealth = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('-')) {
      console.error(`Unknown flag: ${a}`);
      args.help = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: serp [options] <query>

Options:
  -n, --num <N>        Number of results (default 10)
      --hl <lang>      UI language (default en)
      --gl <cc>        Country code (e.g., US, GB)
      --domain <host>  Google domain (default google.com)
      --tbs <val>      Time filter (e.g., qdr:d | qdr:w | qdr:m)
      --tbm <mode>     Vertical: e.g., nws (news), vid (videos)
      --udm <val>      UI mode (e.g., 14)
      --safe <mode>    Safe search: off | active (default off)
      --headful        Run browser in headful mode
      --ncr            Use No Country Redirect cookie
      --proxy <url>    Proxy server (e.g., http://host:port or socks5://...)
      --debug-html [f] Save HTML to file on failure (default last_serp.html)
      --debug-screenshot [f] Save screenshot on failure (default last_serp.png)
      --retries <N>    Retry attempts on failure (default 2)
      --delay-min <ms> Min jitter delay between steps (default 120)
      --delay-max <ms> Max jitter delay between steps (default 300)
      --json           Output results as JSON only
  -h, --help           Show help
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args._.length === 0) {
    printHelp();
    if (args._.length === 0) process.exit(1);
    return;
  }
  const query = args._.join(' ');

  // Allow disabling stealth plugin via CLI flag (must set before requiring module)
  if (args.noStealth) {
    process.env.SERP_DISABLE_STEALTH = 'true';
  }

  const { searchGoogle } = require('./googleSerp');

  const opts = {
    num: args.num ?? 10,
    hl: args.hl ?? 'en',
    gl: args.gl,
    domain: args.domain ?? 'google.com',
    headless: args.headless !== false,
    tbs: args.tbs,
    tbm: args.tbm,
    udm: Number.isFinite(args.udm) ? args.udm : undefined,
    safe: args.safe ?? 'off',
    ncr: !!args.ncr,
    proxy: args.proxy,
    debugHtmlPath: args.debugHtmlPath,
    debugScreenshotPath: args.debugScreenshotPath,
    retries: Number.isFinite(args.retries) ? args.retries : 2,
    delayMinMs: Number.isFinite(args.delayMinMs) ? args.delayMinMs : 120,
    delayMaxMs: Number.isFinite(args.delayMaxMs) ? args.delayMaxMs : 300,
  };

  try {
    const result = await searchGoogle(query, opts);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Query: ${result.query}`);
    console.log(`URL:   ${result.url}`);
    console.log('Results:');
    for (const [i, r] of result.results.entries()) {
      console.log(`  ${i + 1}. ${r.title}`);
      console.log(`     ${r.url}`);
      if (r.snippet) console.log(`     ${r.snippet}`);
    }
  } catch (err) {
    console.error('Error:', err?.message || err);
    process.exit(2);
  }
}

main();
