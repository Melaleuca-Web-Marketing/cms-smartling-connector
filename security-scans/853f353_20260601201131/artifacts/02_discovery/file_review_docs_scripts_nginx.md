# File Review: docs, scripts, deployment, package metadata

Scan id: 853f353_20260601201131
Scope: docs/index.html, docs/styles.css, scripts/build-extension.mjs, scripts/package-extension.mjs, scripts/generate-release-info.mjs, scripts/generate-custom-job-template.mjs, scripts/deploy-nginx-cms-smartling.sh, scripts/newrequestform.conf, ecosystem.config.cjs, package.json, package-lock.json, .env.example, .gitignore, README.md

## File receipts

| File | Lines | SHA-256 | Receipt |
| --- | ---: | --- | --- |
| docs/index.html | 215 | 1306AF26A2152D197A46720F77EF4CA0F23910EC157A6ED0B5543067EFE101DE | Reviewed in full. Escaped text rendering at lines 114-117, 121-131, 166-178, 205-211. Download hrefs are assigned from release metadata without URL/path validation at lines 134-157. |
| docs/styles.css | 262 | 93A77B0B1C9AE8B50A3259608812C91469ED0AF8FACD0B6F039BA9E911EE098F | Reviewed in full. Static CSS only; no script, URL import, or security-sensitive behavior found. |
| scripts/build-extension.mjs | 91 | 86D856A243F83D128F9241CA5C31225731426DD794211AD71B66F3A2AD12FF5D | Reviewed in full. Target argument is allowlisted at lines 18-25; rm/copy destinations are fixed under dist at lines 32-43 and 48-74; no attacker-controlled path source found. |
| scripts/package-extension.mjs | 119 | 09A495BFA780202436B22946A845740CA86F76A70B791A03B8B3AB68615C9012 | Reviewed in full. Target argument is allowlisted at lines 15-23; package/delete/copy roots are fixed at lines 25-54 and 102-115; zip invocation uses argv on Unix and single-quote escaping for PowerShell at lines 56-76 and 117-119. Version is developer-controlled package metadata. |
| scripts/generate-release-info.mjs | 61 | 278487EDBF0DE983B8E6EE26A733F0E720D3E433C19E6FEA255F12BBE0F90114 | Reviewed in full. Git command uses spawnSync argv at lines 28-42; commit subjects are serialized as JSON at lines 48-60 and later escaped by the landing page. Download paths are generated from package version at lines 18-20. |
| scripts/generate-custom-job-template.mjs | 316 | C3E6186A8350729A495210B2ED00CCA6DD881E68C2E0B04623F0C021B32B7E77 | Reviewed in full. Static XLSX ZIP generation only; cell text is XML-escaped at lines 215-217 and 309-315; ZIP entry names are constant at lines 10-20, so no archive traversal source was found. |
| scripts/deploy-nginx-cms-smartling.sh | 73 | 9546AA02720C3A1AAF197F0822D999B99A253926738A92405241D16B29531F07 | Reviewed in full. Deployment copies fixed docs/download paths at lines 40-53 and installs nginx config at lines 55-60. No remote input to delete/copy paths found; deployment publishes the nginx config that exposes /cms-smartling/api/. |
| scripts/newrequestform.conf | 145 | 28ED24C6A83F511FD0BE714EE0E03A40C154FB82C832A9429AB09DA4B8488D0A | Reviewed in full. HTTPS is configured at lines 9-16. Static docs/download aliases are lines 105-123. Backend health and API proxy are lines 125-143. No auth_basic, allow/deny, satisfy, internal, or equivalent access control found. |
| ecosystem.config.cjs | 21 | 5C87904C48CA5997385E9C7933110CCD5E179D6B7A2C31485ED338C352286BB0 | Reviewed in full. PM2 launches backend/server.mjs with --env-file=.env at line 8 and production NODE_ENV at lines 16-18. No secrets are embedded. |
| package.json | 18 | E3BF898A9BC621BBE5B0AF505E7916EE6A234B7610751B0C2EF4F0D9DDF0ED69 | Reviewed in full. No dependencies or devDependencies. Scripts run local Node scripts, pm2, and backend at lines 6-16. |
| package-lock.json | 12 | 200AAC2B374C7FE5577CA886A23D438FCE3783106495CF445CD386C9B05B0E03 | Reviewed in full. Lockfile contains only the root package and no third-party packages. |
| .env.example | 48 | 85AC2FF4952F604D9C832604A4C592A8AFE977729513E35113D1428855572DFE | Reviewed in full. Placeholder-only Smartling secrets at lines 26-44; HOST defaults to 127.0.0.1 at line 4. |
| .gitignore | 13 | CBBE463F6C63F791F3F89C4708B6C672795ABFBDC53E88537432626AC9C641BC | Reviewed in full. Ignores /.env, dist, generated downloads/release-info, and backend runtime data at lines 1-12. |
| README.md | 313 | DE43CCB767E84D98E7CEE619D6D1F3685E987FAEF6A6D3BFB7E7EFAB923E4653 | Reviewed in full. Documents backend, extension packaging, landing page, update check, and API endpoints. Endpoint documentation at lines 201-223 and 293-309 supports deployed API reachability. |

## Candidates

### CAND-DEPLOY-001: Nginx publishes unauthenticated CMS Smartling API

- Affected locations:
  - root_control: scripts/newrequestform.conf:135-143
  - supporting_exposure: scripts/newrequestform.conf:125-132
  - supporting_runtime: backend/server.mjs:179-185, backend/server.mjs:1300-1308, backend/server.mjs:1342-1415
  - supporting_docs: README.md:201-223, README.md:293-309
- Instance key: deployment-exposure:scripts/newrequestform.conf:135
- Attacker-controlled source: Any client that can reach https://usifhqtsagrqt01.melaleuca.net/cms-smartling/api/ can send GET/POST requests; any browser origin can read/write backend JSON responses because backend CORS is Access-Control-Allow-Origin: *.
- Sink/broken control: The nginx location rewrites /cms-smartling/api/* to the backend on 127.0.0.1:17817 without auth or network allowlist; the backend dispatcher has state-changing routes and no authentication gate.
- Impact: Internal or externally reachable clients, depending on host exposure, can create Smartling translation jobs, submit custom jobs, import/sync Smartling translations, stage/mock translations, and read request/translation data. With valid Smartling configuration this can consume Smartling quota, stage attacker-controlled translations, or disclose local workflow history.
- Controls/counterevidence: TLS redirect and HTTPS are present. Backend binds to 127.0.0.1 by default and PM2 uses .env, but nginx deliberately publishes the backend under /cms-smartling/api/. No auth_basic, allow/deny, internal, mTLS, bearer-token check, or app-layer auth was found in the reviewed nginx config or supporting dispatcher lines.
- Validation facts: newrequestform.conf has exact /cms-smartling/api/ proxy at lines 135-143; backend responses allow all origins at lines 179-185 and OPTIONS at lines 1300-1308; route dispatch exposes POST /api/translation-requests, POST /api/custom-translation-requests, import-xlsx, sync, import-translations, mock-publish, and /api/translations/stage at lines 1342-1415.
- Attack-path facts: Attacker sends POST https://usifhqtsagrqt01.melaleuca.net/cms-smartling/api/custom-translation-requests with arbitrary job fields; nginx rewrites to /api/custom-translation-requests; backend creates and optionally submits a Smartling job. Or attacker sends POST /cms-smartling/api/translations/stage or /translation-requests/{id}/mock-publish to stage local translations consumed by extension users.
- Taxonomy: CWE-306, CWE-862, CWE-942.

### CAND-RELEASE-001: Release metadata can replace download hrefs with unvalidated URLs

- Affected locations:
  - root_control: docs/index.html:134-157
  - source: docs/index.html:100-111
  - generator_counterevidence: scripts/generate-release-info.mjs:18-25
  - supporting_deploy: scripts/newrequestform.conf:113-123
- Instance key: unsafe-download-rendering:docs/index.html:134
- Attacker-controlled source: release-info.json if the deployed static release metadata is modified independently of index.html or generated by a compromised deployment path. The threat model names release-info JSON as attacker-controlled if the static download host is compromised.
- Sink/broken control: renderDownloadLinks trusts releaseInfo.downloads.chromium and releaseInfo.downloads.firefox directly and assigns them to anchor hrefs, with no same-origin, relative-path, downloads-prefix, .zip extension, or scheme validation.
- Impact: A poisoned release-info.json can make the landing page send users to an attacker-controlled ZIP or potentially a script URL when users click the download button. Because users manually load the extension ZIP, this can become extension distribution compromise.
- Controls/counterevidence: Text fields from release-info are HTML-escaped before innerHTML. The normal generator writes relative downloads/cms-smartling-connector-*-v{version}.zip paths from package.json, and nginx serves release-info.json plus downloads from fixed aliases. This lowers likelihood when deployment artifacts are generated and deployed atomically; it does not protect the page from a release-info-only tamper or compromised metadata source.
- Validation facts: docs/index.html fetches release-info.json at lines 100-107; renderDownloadLinks selects releaseInfo.downloads?.chromium/firefox before fallback paths at lines 134-141; the selected strings are assigned to href at lines 143-156; no validation helper exists in the reviewed file. nginx serves release-info.json and downloads under /cms-smartling at lines 113-123.
- Attack-path facts: Attacker modifies /usr/share/nginx/cms-smartling-docs/release-info.json to include {"downloads":{"chromium":"https://attacker.example/cms-smartling.zip"}}; a user opens /cms-smartling/index.html; the page updates the Chrome/Edge link; the user downloads and manually loads the malicious extension package.
- Taxonomy: CWE-494, CWE-829.

## Negative checks

- Command execution in packaging: No shell interpolation from untrusted input found. Targets are allowlisted. zip is spawned with argv on Unix; PowerShell path arguments are quoted with single-quote escaping.
- Path traversal/copy/delete in scripts: Build/package/deploy roots are fixed under repository dist/docs or nginx docroot. ZIP entry names in the generated XLSX are constants. Deletions are constrained by fixed directories and filename prefixes.
- Secret handling: .env is ignored; .env.example has blank placeholders; package/PM2 configs do not embed Smartling secrets.
- Supply chain/dependencies: package.json has no dependencies or devDependencies, and package-lock.json has no third-party packages to audit.
