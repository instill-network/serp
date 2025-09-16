# Google SERP via Playwright

A minimal, pragmatic Google SERP scraper and benchmarking tool powered by Playwright. Ships as a CLI and a Docker image, with optional headful viewing via VNC.

Quick start (local)
- Prereqs: Node 18+
- Install: `npm install`
- Build: `npm run build`
- Run: `node dist/cli.js "your query"`

Examples (local)
- `node dist/cli.js "best coffee makers"`
- `node dist/cli.js -n 5 --hl en --gl US --json "web scraping with playwright"`
- `node dist/cli.js --tbs qdr:w "latest node.js release"` (past week)

Tip: you can also run the local package directly with `npx --yes . --help` after building.

Docker
- Image: https://hub.docker.com/r/skopac/serp
- Build: `docker build -t serp .`
- Run serp: `docker run --rm -it serp --json "your query"`
- Run serp with proxy: `docker run --rm -it serp --proxy http://user+country=us:pass@proxy:port "your query"`
- Run serp-bench:
  `docker run --rm -it -p 5900:5900 -e HEADFUL=1 -v "$(pwd)/bench_out:/app/bench_out" -v "$(pwd)/examples/proxies.example.json:/app/proxies.json:ro" -v "$(pwd)/examples/queries.example.txt:/app/queries.txt:ro" serp serp-bench --proxies /app/proxies.json --queries /app/queries.txt -c 1,5,10 --plateau-sec 60 --hl en --gl US --headful`
  - Notes:
    - Use `-v "$(pwd)/bench_out:/app/bench_out"` to persist results and the HTML report.
    - Mount your input files read-only under `/app` and reference them by those paths.
    - The container installs common desktop fonts (Noto, Liberation, DejaVu, Emoji). Default timezone is `America/New_York`; override with `-e TZ=Europe/London` (or any IANA TZ) to match your target locale.

Headful via VNC
- What controls what:
  - `--headful` makes Playwright launch a visible browser.
  - `HEADFUL=1` starts an Xvfb display and a VNC server inside the container.
  - Use both together (plus `--keep-open`) to view and keep the UI.
  - Browser timezone is set from `TZ` environment variable (default `America/New_York`).
- Quick start (serp):
  - `docker run --rm -it -p 5900:5900 -e HEADFUL=1 -e VNC_PASSWORD=secret serp --headful --keep-open "best coffee makers"`
  
- Bench headful (optional, no keep-open flag in bench):
  - `docker run --rm -it -p 5900:5900 -e HEADFUL=1 -v "$(pwd)/bench_out:/app/bench_out" -v "$(pwd)/examples/proxies.example.json:/app/proxies.json:ro" -v "$(pwd)/examples/queries.example.txt:/app/queries.txt:ro" serp serp-bench --headful --proxies /app/proxies.json --queries /app/queries.txt -c 1 --plateau-sec 30`
  - Connect a VNC client to `localhost:5900` (password `secret`).
- Client examples:
  - macOS: `open 'vnc://:secret@localhost:5900'`
  - Linux: `vncviewer localhost:5900`
  - Windows: Use RealVNC/UltraVNC → connect to `localhost:5900` (password `secret`).
- Tunables (env): `SCREEN_WIDTH` (1920), `SCREEN_HEIGHT` (1080), `SCREEN_DEPTH` (24), `VNC_PORT` (5900), `DISPLAY` (:99)

Control the container
- Foreground (interactive):
  - serp: `docker run --rm -it -p 5900:5900 -e HEADFUL=1 serp --headful --keep-open "<query>"`
  - serp-bench: `docker run --rm -it -p 5900:5900 -e HEADFUL=1 serp serp-bench --headful --proxies /app/proxies.json --queries /app/queries.txt`
  - Press Enter in the terminal to close the browser and exit.
- Detached (background):
  - Start: `docker run -d --name serp_vnc -p 5900:5900 -e HEADFUL=1 -e VNC_PASSWORD=secret serp --headful --keep-open "<query>"`
  - Logs: `docker logs -f serp_vnc`
  - Shell: `docker exec -it serp_vnc bash`
  - Stop: `docker stop serp_vnc`
  - Remove: `docker rm serp_vnc`
  - Restart: `docker restart serp_vnc`
  - In detached mode, stopping the container closes the browser.

Flags
- `-n, --num` number of results (default 10)
- `--hl` UI language (default `en`)
- `--gl` country code (e.g., `US`, `GB`)
- `--domain` Google domain (default `google.com`)
- `--tbs` time filter like `qdr:d` (day), `qdr:w` (week), `qdr:m` (month)
- `--proxy <url>` HTTP proxy server (e.g. `http://user:pass@host:port`). Username may include provider modifiers like `+country=us`.
  - You can use `__UUID__` in proxy credentials to auto-insert a fresh UUID v4 each run. Example: `http://user+session_id=__UUID__:pass@127.0.0.1:8080`.
    - In `serp`, one UUID is generated per invocation.
    - In `serp-bench`, a new UUID is generated for each individual request (test).
  - For HTTP proxies, credentials are preserved as-is. If your username contains `=` (e.g., `nino+country=us`), the tool embeds raw credentials into the proxy URL to avoid percent-encoding.
- `--result-timeout-sec <N>` fail fast if no organic results appear within N seconds (default 5s; e.g., `--result-timeout-sec 3`).
- `--nav-timeout-ms <N>` navigation/action timeout in milliseconds for Playwright operations (default 3000ms).
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
- Tip: add `--result-timeout-sec 3` to make each attempt fail within 3s if no results are detected (default is 5s). Use `--nav-timeout-ms 3000` to control navigation/action timeouts (e.g., page.goto), default 3000ms.
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

Decision-ready aggregates
- Use the aggregator to compute the full rubric across one or more runs (supports both `results.json` and NDJSON):
  - `node scripts/bench-aggregate.mjs -f bench_out/<stamp>/results.json`
  - `node scripts/bench-aggregate.mjs -f bench_out/**/samples.ndjson`
- Key outputs per vendor vs `direct`:
  - Speed (success-only): `SRT_total p50/p95`, `TTFB_p95`, `Overhead_p50_ms`, `Overhead_p95_ratio`, `TTFB_p95_overhead`, `TailAmp`.
  - Reliability: `Success_%`, `Blocked_%`, `Captcha_%`, `Timeout_%` with reason breakdown.
  - Root cause: stage p95s (`DNS/TCP/TLS/TTFB`) and pre-origin/TTFB overheads.
  - Capacity: concurrency→`Success_%` and `SRT_p95` (requires `conc` field in logs).
  - Correctness: Top-K Jaccard vs baseline.
  - Geo/pool: `Geo_accuracy_%`, `Distinct_IPs`, `Distinct_ASNs` (if present in logs).
  - Cost: `$ per 1k successes` when `--price-per-gb` and byte counts are logged.

Pass/fail quick read
- PASS when: `Overhead_p95_ratio ≤ 1.3`, `Success_% ≥ 98%`, `Captcha_% ≤ 1%`, `Sticky_survival_p50 ≥ 10`, tail stability ~direct, `Top10_Jaccard ≥ 0.9`.
- FAIL-FAST hints printed when: blocked% high with normal pre-origin (ban), pre-origin spikes (egress), or only proxy TTFB balloons (target throttling).

Development
- Build: `npm run build`
- Run CLI locally: `node dist/cli.js --help`
- Run bench locally: `node dist/bench.js --help`
- Aggregator: `node scripts/bench-aggregate.mjs -f bench_out/<stamp>/results.json`

Trademarks
- Google is a trademark of Google LLC. This project is not affiliated with or endorsed by Google.

<p>made at <a href="https://instill.network" target="_blank" rel="noopener noreferrer">instill.network</a></p>
