# Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Backend HTTP API | Authentication, CORS, protected actions | Reported | `CAND-DEPLOY-001`; state-changing and sensitive read routes lack auth and allow wildcard CORS. |
| Nginx deployment config | Internal API publication | Reported | `/cms-smartling/api/` is proxied to the backend without an auth or network allowlist. |
| Smartling adapter | SSRF and secret exposure | No issue found | Fixed API host; status redacts token values; no user-controlled destination host. |
| SQLite store | SQL injection, path control | No issue found | Values are parameterized; SQLite path is operator/env-controlled. |
| XLSX import parser | ZIP/XML resource exhaustion | Reported | `CAND-XLSX-DOS-004`; compressed upload cap exists, uncompressed output cap does not. |
| Extension content script | Origin trust and DOM spoofing | Reported | `EXT-FR-001`; content script runs on `<all_urls>` and trusts DOM shape. |
| Extension rendering | DOM XSS | Rejected | Dynamic strings are escaped and translation insertion writes form-control values, not HTML. |
| Extension backend URL setting | Configuration hardening | Needs follow-up | `EXT-FR-002`; code should allowlist expected hosts but exploitability depends on user/operator setting control. |
| Landing page release links | Update/download supply chain | Reported | `CAND-RELEASE-001`; release metadata can set download hrefs without URL validation. |
| Build/package scripts | Command injection, path traversal | No issue found | Targets are allowlisted; paths are fixed under repo/dist/docs; no third-party dependencies. |
| Secret handling | Committed credentials | No issue found | `.env` ignored; `.env.example` has blank placeholders; no secrets printed or committed. |
| Report tooling | Deterministic validator | Needs follow-up | Python execution failed due blocked local Python runtime, so report validator/renderer could not be run. |
