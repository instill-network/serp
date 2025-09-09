**Google SERP via Playwright**

- Install: `npm install`
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
- `--proxy <url>` proxy server (e.g. `http://user:pass@host:port` or `socks5://user:pass@host:port`). Username may include provider modifiers like `+country=us`.
- `--safe` safe search: `off` | `active` (default `off`)
- `--headful` run non-headless
- `--json` print JSON only
- `--json` print JSON only

Notes
- This intentionally focuses on organic results (anchors inside `.yuRUbf`), with a reasonable fallback for pages where the structure differs. It avoids obvious non-organic modules.
- If you hit a consent dialog, the script attempts to accept it automatically.
- Google’s markup changes frequently; if results are sparse, use `--headful` to observe the DOM and please share a failing query so we can refine selectors.
- This uses plain Playwright without stealth plugins. If you experience blocking at high volume, consider adding your own proxy/throttling externally.

Disclaimer
- Scraping Google may violate its Terms of Service. Use responsibly and at your own risk.
