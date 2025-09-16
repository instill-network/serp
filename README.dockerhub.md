# Google SERP via Playwright — Docker Image

Minimal Google SERP scraper and benchmarking CLI built on Playwright. Ships headless by default with optional headful viewing over VNC. Includes Chromium/Firefox/WebKit browsers.

Made to benchmark https://instill.network/ 's residential proxies.

## Tags
- `latest` — Playwright v1.55 on Ubuntu 22.04 (Jammy). See `Dockerfile`.

## Quick Start
- JSON output: `docker run --rm -it <image> --json "best coffee makers"`
- Locale & count: `docker run --rm -it <image> -n 5 --hl en --gl US "web scraping with playwright"`
- Use a proxy: `docker run --rm -it <image> --proxy http://user+country=us:pass@host:port "your query"`

Replace `<image>` with your published image (e.g., `yourorg/serp`).

## Headful via VNC
- Enable headful UI + VNC:
  - `docker run --rm -it -p 5900:5900 -e HEADFUL=1 <image> --headful --keep-open "best coffee makers"`
  - Optional password: `-e VNC_PASSWORD=secret`
- Connect a VNC client to `localhost:5900` (use password if set).
- Tunables (env): `HEADFUL=0|1`, `DISPLAY=:99`, `SCREEN_WIDTH=1920`, `SCREEN_HEIGHT=1080`, `SCREEN_DEPTH=24`, `VNC_PORT=5900`, `VNC_PASSWORD=<string>`, `TZ` (default `America/New_York`).
- Fonts preinstalled: Noto (incl. emoji), Liberation, DejaVu.

## Benchmarks (`serp-bench`)
- Persist outputs and mount inputs:
  ```bash
  docker run --rm -it \
    -p 5900:5900 -e HEADFUL=1 \
    -v "$(pwd)/bench_out:/app/bench_out" \
    -v "$(pwd)/examples/proxies.example.json:/app/proxies.json:ro" \
    -v "$(pwd)/examples/queries.example.txt:/app/queries.txt:ro" \
    <image> serp-bench --proxies /app/proxies.json --queries /app/queries.txt -c 1,5,10 --plateau-sec 60 --hl en --gl US
  ```
- Outputs: JSON and `report.html` under `bench_out/<timestamp>/`.
- Optional headful view: add `--headful` (no `--keep-open` for bench).

## CLI: `serp`
- Results: `-n, --num <N>` (default 10)
- Locale: `--hl <lang>` (default `en`), `--gl <cc>`, `--domain <host>` (default `google.com`)
- Time filter: `--tbs qdr:d|qdr:w|qdr:m`
- Browser: `--browser chromium|firefox|webkit` (default `chromium`)
- Headful: `--headful` and optionally `--keep-open`
- Proxy: `--proxy <http://...>`; username may include modifiers like `+country=us`
- Timeouts: `--result-timeout-sec <N>` (default 5), `--nav-timeout-ms <N>` (default 3000)
- System proxy: `--use-system-proxy` (disabled by default)
- Output: `--json`

## CLI: `serp-bench`
- Inputs: `--proxies <file>` (JSON array of `{ name, proxy }`), `--queries <file>` (one per line)
- Load shape: `-c, --concurrency <list>` (e.g., `1,5,10`), `--plateau-sec <N>` per stage
- Timeouts: `--result-timeout-sec <N>`, `--nav-timeout-ms <N>`
- Browser/headless: `--browser <name>`, `--headful`
- Output dir: `-o, --out <dir>` (default `bench_out/<timestamp>`)  
- Correctness baseline: `--baseline <vendorName>`

## Proxies
- HTTP proxies only (Playwright limitation for authenticated SOCKS).
- UUID placeholder: use `__UUID__` in username/password to auto-generate a fresh UUID.
  - Example: `--proxy http://user+session_id=__UUID__:pass@host:port`
  - `serp`: one UUID per invocation; `serp-bench`: new UUID per request.
- For Docker-to-host proxies on Docker Desktop use `host.docker.internal`:
  ```json
  [{ "name": "instill", "proxy": "http://user+session_id=__UUID__:pass@host.docker.internal:8080" }]
  ```

## Entrypoint & Commands
- Entrypoint: `/usr/local/bin/docker-entrypoint.sh`
- Default command: `serp`  
  To run the benchmark: `docker run … <image> serp-bench …`
- Exposed port: `5900/tcp` (VNC when `HEADFUL=1`)

## Volumes
- Persist benchmark artifacts: `-v "$(pwd)/bench_out:/app/bench_out"`
- Mount input files read-only under `/app` and reference by that path (e.g., `/app/proxies.json`, `/app/queries.txt`).

## Notes
- Focuses on organic results; obvious non-organic modules are avoided.
- Attempts to accept Google consent dialogs automatically.
- If results are sparse due to markup changes, use `--headful` to inspect.

## Security & Compliance
- Scraping Google may violate Google’s Terms of Service. Use responsibly.
- Base image: `mcr.microsoft.com/playwright:v1.55.0-jammy`. Browsers run as non-root `pwuser`.

## License
MIT

