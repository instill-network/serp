**Google SERP via Playwright**

- Install: `npm install`
- Run: `npx serp "your query"`

Examples
- `npx serp "best coffee makers"`
- `npx serp -n 5 --hl en --gl US --json "web scraping with playwright"`
- `npx serp --tbs qdr:w "latest node.js release"` (past week)

Docker
- Build: `docker build -t serp .`
- Run: `docker run --rm -it serp --json "your query"`
- With proxy: `docker run --rm -it serp --proxy http://user+country=us:pass@proxy:port "your query"`

Flags
- `-n, --num` number of results (default 10)
- `--hl` UI language (default `en`)
- `--gl` country code (e.g., `US`, `GB`)
- `--domain` Google domain (default `google.com`)
- `--tbs` time filter like `qdr:d` (day), `qdr:w` (week), `qdr:m` (month)
- `--proxy <url>` HTTP proxy server (e.g. `http://user:pass@host:port`). Username may include provider modifiers like `+country=us`.
  - For HTTP proxies, credentials are preserved as-is. If your username contains `=` (e.g., `nino+country=us`), the tool embeds raw credentials into the proxy URL to avoid percent-encoding.
- `--use-system-proxy` use OS proxy if set when `--proxy` is not provided (by default the tool disables system proxy to avoid accidental failures).
- `--safe` safe search: `off` | `active` (default `off`)
- `--headful` run non-headless
- `--keep-open` keep the browser open (press Enter to close)
- `--browser <name>` choose engine: `chromium` | `firefox` | `webkit` (default `chromium`)
- `--json` print JSON only
 

Notes
- This intentionally focuses on organic results (anchors inside `.yuRUbf`), with a reasonable fallback for pages where the structure differs. It avoids obvious non-organic modules.
- If you hit a consent dialog, the script attempts to accept it automatically.
- Google’s markup changes frequently; if results are sparse, use `--headful` to observe the DOM and please share a failing query so we can refine selectors.
- This uses plain Playwright without stealth plugins. If you experience blocking at high volume, consider adding your own proxy/throttling externally.

Disclaimer
- Scraping Google may violate its Terms of Service. Use responsibly and at your own risk.

**Benchmarking (beta)**
- Build: `npm run build`
- Create a proxies file (optional). Example `proxies.json`:
  `[{"name":"direct","proxy":null},{"name":"vendorA","proxy":"http://user:pass@host:port"}]`
- Prepare queries file (optional): one query per line.
- Run: `npx serp-bench --proxies ./proxies.json --queries ./queries.txt -c 1,5,10 --plateau-sec 60 --hl en --gl US`
- Output: JSON and HTML report in `bench_out/<timestamp>/`. Open `report.html` for graphs.

What it measures
- Success/block rates via page markers and organic result presence (non-empty).
- Latency percentiles (p50/p95/p99) from Navigation Timing: TTFB and total load.
- Correctness: Top-10 URL Jaccard overlap vs a baseline vendor.

Notes
- Each request launches a new browser for fairness (no cookies/personalization). This is heavier but comparable across vendors.
- Only HTTP proxies are supported (no authenticated SOCKS via Playwright).
- For advanced scenarios (rotation TTL, spikes, longer soaks), adjust concurrency plateaus and duration or extend `src/bench.ts`.
 - A run is counted OK only if at least one organic result is extracted; empty result sets are treated as failures even if the page loads.
