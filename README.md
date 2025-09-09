**Google SERP via Playwright (TypeScript)**

- Install: `npm install && npm run build`
- Run: `npx serp "your query"`

Examples
- `npx serp "best coffee makers"`
- `npx serp -n 5 --hl en --gl US --json "web scraping with playwright"`
- `npx serp --tbs qdr:w "latest node.js release"` (past week)

Flags
- `-n, --num` number of results (default 10)
- `--hl` UI language (default `en`)
- `--gl` country code (e.g., `US`, `GB`)
- `--domain` Google domain (default `google.com`)
- `--tbs` time filter like `qdr:d` (day), `qdr:w` (week), `qdr:m` (month)
- `--tbm` vertical, e.g. `nws` (news), `vid` (videos)
- `--udm` UI mode override (e.g., `14`)
- `--safe` safe search: `off` | `active` (default `off`)
- `--headful` run non-headless
- `--ncr` set No Country Redirect cookie
- `--proxy <url>` proxy server (e.g. `http://host:port` or `socks5://host:port`). Credentials supported (e.g., `http://user:pass@host:port`). Username may include provider modifiers like `+country=us`.
- `--debug-html [file]` write HTML to a file on failure (default `last_serp.html`)
- `--debug-screenshot [file]` save a screenshot on failure (default `last_serp.png`)
- `--no-stealth` disable stealth plugin (fallback to plain Playwright)
- `--retries <N>` retry attempts on failure (default 2)
- `--delay-min <ms>` min jitter delay between steps (default 120)
- `--delay-max <ms>` max jitter delay between steps (default 300)
- `--json` print JSON only

Docker
- Build: `docker build -t serp .`
- Run: `docker run --rm -it serp --json --no-stealth "your query"`
- With proxy: `docker run --rm -it serp --proxy http://user+country=us:pass@proxy:port "your query"`

Notes
- This intentionally focuses on organic results (anchors inside `.yuRUbf`), with a reasonable fallback for pages where the structure differs. It avoids obvious non-organic modules.
- If you hit a consent dialog, the script attempts to accept it automatically.
- Google’s markup changes frequently; if results are sparse, use `--headful` to observe the DOM and please share a failing query so we can refine selectors.
- Stealth: Uses `playwright-extra` + stealth plugin to reduce detection signals. Adds small random delays and viewport jitter; also includes simple backoff retries. If you encounter aggressive blocks, you can temporarily disable stealth via `SERP_DISABLE_STEALTH=true npx serp "query"`.

Disclaimer
- Scraping Google may violate its Terms of Service. Use responsibly and at your own risk.
