#!/usr/bin/env node
import { searchGoogle, type SearchOptions } from './googleSerp';

function parseArgs(argv: string[]) {
  const args: any = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--num' || a === '-n') args.num = Number(argv[++i]);
    else if (a === '--hl') args.hl = argv[++i];
    else if (a === '--gl') args.gl = argv[++i];
    else if (a === '--domain') args.domain = argv[++i];
    else if (a === '--tbs') args.tbs = argv[++i];
    else if (a === '--safe') args.safe = argv[++i];
    else if (a === '--headful') args.headless = false;
    else if (a === '--proxy') args.proxy = argv[++i];
    else if (a === '--keep-open') args.keepOpen = true;
    else if (a === '--browser') args.browser = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('-')) { console.error(`Unknown flag: ${a}`); args.help = true; }
    else { args._.push(a); }
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
      --proxy <url>    Proxy (http:// or socks5://). Username may include modifiers like +country=us
      --safe <mode>    Safe search: off | active (default off)
      --headful        Run browser in headful mode
      --keep-open      Keep the browser open (press Enter to close)
      --browser <name> Browser engine: chromium | firefox | webkit (default chromium)
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

  const opts: SearchOptions = {
    num: Number.isFinite(args.num) ? args.num : 10,
    hl: args.hl ?? 'en',
    gl: args.gl,
    domain: args.domain ?? 'google.com',
    headless: args.headless !== false,
    tbs: args.tbs,
    safe: args.safe ?? 'off',
    proxy: args.proxy,
    keepOpen: !!args.keepOpen,
    browser: (['chromium','firefox','webkit'] as const).includes(args.browser) ? args.browser : undefined,
  };

  try {
    const result = await searchGoogle(query, opts);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Query: ${result.query}`);
      console.log(`URL:   ${result.url}`);
      console.log('Results:');
      for (const [i, r] of result.results.entries()) {
        console.log(`  ${i + 1}. ${r.title}`);
        console.log(`     ${r.url}`);
        if (r.snippet) console.log(`     ${r.snippet}`);
      }
    }

    if (args.keepOpen) {
      if (opts.headless !== false) {
        console.log('Tip: use --headful with --keep-open to see the page.');
      }
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await new Promise<void>(res => rl.question('Press Enter to close the browser...', () => { rl.close(); res(); }));
      const closer = (result as any).close;
      if (typeof closer === 'function') {
        await closer();
      }
    }
  } catch (err: any) {
    console.error('Error:', err?.message || err);
    process.exit(2);
  }
}

main();
