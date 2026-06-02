# Security Review: CMS Smartling Connector

## Scope

- Scan mode: repository-wide Codex Security scan of the CMS Smartling Connector repository at commit 853f353.
- In scope: backend HTTP API, Smartling adapter, SQLite store, XLSX import parser, browser extension scripts/manifests, static landing page, build/deploy scripts, package metadata, README, and environment example.
- Exclusions: live CMS, live Smartling account behavior, committed-ignored .env secrets, and runtime database contents were not printed or tested.
- Runtime/test status: npm run check passed. Live API exploitation was not attempted. Python report validator/renderer could not run because local Python execution is blocked.
- Generated context: the threat model was generated during phase 1 and saved at artifacts/01_context/threat_model.md.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 4 |
| Severity mix | 1 high, 3 medium |
| Confidence mix | 2 high, 2 medium |
| Coverage | 32 worklist rows covered |
| Validation mode | Static source trace, deployment/config review, subagent review, npm syntax check |
| Markdown report | security-scans/853f353_20260601201131/report.md |
| HTML report | security-scans/853f353_20260601201131/report.html |
| Validator status | Blocked by Python runtime failure; see report_validation.md |

## Threat Model

This repository contains a browser-extension-assisted workflow and a local/internal Node.js backend for submitting selected CMS product copy and custom strings to Smartling, tracking translation jobs, importing published translations, and helping content authors insert translated strings into localized CMS fields. Primary runtime components are the backend HTTP API in backend/server.mjs, the Smartling client in backend/smartlingAdapter.mjs, SQLite persistence in backend/store.mjs, the CMS content script in extension/content.js, extension popup/full-page UIs in extension/popup.js, extension/bulk-import.js, and extension/recent-jobs.js, and the internal static download page in docs/index.html.

Important assets include Smartling API user identifiers/secrets and project IDs, submitted source strings, downloaded translations, local job/request history in SQLite, CMS page content read by the extension, and the integrity of translation values inserted into CMS fields. The repository does not contain a full CMS authentication layer; it relies on the CMS and internal network/server deployment for user authentication and authorization.

Trust boundaries include browser extension to backend API, backend to Smartling API, backend to local SQLite, extension content script to CMS DOM, internal landing page to users, and build/deploy scripts to the host filesystem. Attacker-controlled inputs include backend request bodies, uploaded XLSX bytes, job names, custom labels/source strings, SKU/culture query parameters, release-info JSON if the static download host is compromised, Smartling translated file contents, and CMS DOM text if a page contains untrusted product values.

## Findings

| # | Finding | Severity | Confidence |
| --- | --- | --- | --- |
| 1 | [Unauthenticated backend API is published with wildcard CORS](#1-unauthenticated-backend-api-is-published-with-wildcard-cors) | high | high |
| 2 | [XLSX import can synchronously inflate oversized XML before row limits apply](#2-xlsx-import-can-synchronously-inflate-oversized-xml-before-row-limits-apply) | medium | high |
| 3 | [Extension content script runs on all URLs and trusts spoofable CMS DOM](#3-extension-content-script-runs-on-all-urls-and-trusts-spoofable-cms-dom) | medium | medium |
| 4 | [Release metadata can replace extension download links with unvalidated URLs](#4-release-metadata-can-replace-extension-download-links-with-unvalidated-urls) | medium | medium |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; included only for follow-up candidates. |

### [1] Unauthenticated backend API is published with wildcard CORS

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Static route/config tracing shows the backend accepts unauthenticated requests, sends wildcard CORS, and is published by nginx; no auth control was found. |
| Category | Missing authentication / permissive CORS on privileged API |
| CWE | CWE-306 Missing Authentication for Critical Function; CWE-862 Missing Authorization; CWE-942 Permissive Cross-domain Policy |
| Affected lines | backend/server.mjs:179-185; backend/server.mjs:1300-1308; backend/server.mjs:1342-1418; scripts/newrequestform.conf:135-143 |

#### Summary

The backend API exposes translation workflow actions without an application-layer authentication or authorization check. Responses and OPTIONS preflight use Access-Control-Allow-Origin: *, and nginx publishes /cms-smartling/api/ to the backend without auth_basic, allow/deny, SSO handoff, or equivalent access control. This lets any caller that can reach the service create Smartling requests, sync/import jobs, mock/stage translations, and read workflow data using the backend's configured privileges.

#### Validation

Validation used static source tracing plus npm run check. The backend sendJson helper sets wildcard CORS, handleRequest handles OPTIONS with wildcard CORS, and route dispatch reaches protected actions before any auth gate. The strongest counterevidence is the default HOST=127.0.0.1 setting, but the reviewed nginx config deliberately proxies /cms-smartling/api/ to that loopback backend, so loopback binding is not sufficient for the deployed internal workflow.

#### Dataflow

attacker HTTP request -> nginx /cms-smartling/api/ rewrite -> backend handleRequest -> create/sync/import/mock/stage/list handlers -> Smartling adapter or local SQLite store -> JSON response with wildcard CORS.

#### Reachability

The realistic attacker is an internal user or arbitrary webpage visited by an employee whose browser can reach the internal host. Wildcard CORS means a malicious origin can both drive requests and read JSON responses when the backend is reachable.

#### Severity

Severity is high because the path crosses from an unauthenticated caller into backend-held Smartling credentials and local translation-state mutation. It does not directly save values into CMS, which keeps this below critical, but it can create vendor workflow activity, disclose job/source history, and stage attacker-controlled translations for content authors. Evidence that nginx is protected by separate SSO or network policy would lower severity; evidence of broad Internet reachability would raise urgency.

#### Remediation

Require authentication for every /api route, preferably with an API token or SSO-backed session enforced by the backend and nginx. Restrict CORS to exact CMS/extension origins, reject unexpected Origin headers, disable mock-publish/stage test endpoints in production, and add tests that unauthenticated requests to representative read/write routes fail.

### [2] XLSX import can synchronously inflate oversized XML before row limits apply

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Source tracing shows the upload cap is compressed-size only and inflateRawSync has no uncompressed output cap; the row cap runs after parse. |
| Category | Uncontrolled resource consumption in archive parser |
| CWE | CWE-409 Improper Handling of Highly Compressed Data; CWE-400 Uncontrolled Resource Consumption |
| Affected lines | backend/server.mjs:219; backend/server.mjs:651-652; backend/xlsxImport.mjs:42-76; backend/xlsxImport.mjs:109-116 |

#### Summary

The XLSX bulk import endpoint limits the request body to 5 MB, but XLSX is a ZIP container. The parser reads central directory compressed sizes, slices compressed bytes, and calls inflateRawSync without maxOutputLength, per-entry uncompressed limits, aggregate uncompressed limits, or entry-count limits. The MAX_IMPORTED_ROWS guard applies only after XML entries are inflated and parsed.

#### Validation

Validation used static tracing and npm run check. No live DoS payload was sent. The vulnerable path is clear from code: readBinaryBody enforces only compressed upload size, handleImportCustomWorkbook passes the bytes to parseCustomJobWorkbook, and getEntry synchronously inflates ZIP entries before later XML/row processing.

#### Dataflow

attacker XLSX upload -> readBinaryBody compressed-byte cap -> parseCustomJobWorkbook -> readZipEntries -> getEntry -> inflateRawSync(compressed) -> whole XML text parsing -> row cap.

#### Reachability

The route is reachable at POST /api/custom-translation-requests/import-xlsx. The missing backend auth finding makes this easier to trigger, but the parser should still defend itself even after API auth is added.

#### Severity

Severity is medium because the impact is service availability rather than code execution or data compromise, but a small compressed workbook can consume disproportionate CPU/memory and block the single-threaded Node event loop. A reproduced crash or evidence that the service is broadly reachable would raise confidence/urgency; strict uncompressed caps would lower it.

#### Remediation

Add per-entry and aggregate uncompressed byte limits before converting XML to strings. Use zlib maxOutputLength where available or streaming inflation with hard aborts, cap entry count and accepted entry names, reject suspicious central directory sizes, keep auth in front of upload endpoints, and add parser tests for oversized compressed entries.

### [3] Extension content script runs on all URLs and trusts spoofable CMS DOM

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Manifest and content-script tracing support the issue, while exact browser permission behavior was not dynamically reproduced. |
| Category | Excessive browser extension scope / origin trust failure |
| CWE | CWE-668 Exposure of Resource to Wrong Sphere; CWE-346 Origin Validation Error |
| Affected lines | extension/manifest.json:20; extension/manifest.firefox.json:20; extension/content.js:148; extension/content.js:472-478; extension/content.js:1482-1488 |

#### Summary

The extension injects its content script into all URLs, then decides whether to activate by inspecting page DOM for CMS-like SKU, locale, and field structures. A non-CMS webpage can spoof those DOM markers. Once accepted, target-mode pages can trigger backend staged-translation lookups and render translated text into the page DOM; source-mode pages can present page-controlled source strings for Smartling submission if the user clicks.

#### Validation

Validation traced both manifests and the content-script activation path. Dynamic CMS/Smartling strings are escaped before innerHTML use, status writes use textContent, and inserting translations writes to input/textarea values, so no DOM XSS finding survived. The issue is origin trust, not script injection.

#### Dataflow

attacker webpage DOM -> all-URL content script -> isCmsProductPage DOM heuristic -> route/field extraction -> apiFetch to backend or UI render -> staged translations rendered into page DOM or source submission after user action.

#### Reachability

The realistic attacker is a webpage visited by a user with the extension installed. The attacker controls the DOM on that page but not the extension settings. Backend missing auth and wildcard CORS amplify this by making backend lookups useful to non-CMS origins.

#### Severity

Severity is medium because exploitation requires a user visit and some actions require a click, but the extension should not expose translation workflow behavior to arbitrary websites. If the content script is narrowed to CMS origins or runtime host checks are added, this drops to a non-issue.

#### Remediation

Restrict content_scripts.matches and web_accessible_resources.matches to the real CMS origins. Add a runtime hostname allowlist before rendering UI or making backend requests, and keep future backend auth tokens unavailable to content scripts running on unapproved origins.

### [4] Release metadata can replace extension download links with unvalidated URLs

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Source tracing proves the href assignment trusts metadata, but exploitation requires deployed release-info.json tamper. |
| Category | Unsafe update/download channel |
| CWE | CWE-494 Download of Code Without Integrity Check; CWE-829 Inclusion of Functionality from Untrusted Control Sphere |
| Affected lines | docs/index.html:100-111; docs/index.html:134-157; scripts/newrequestform.conf:113-123 |

#### Summary

The internal landing page fetches release-info.json and assigns releaseInfo.downloads.chromium/firefox directly to the extension download anchors. The normal generator emits relative downloads/*.zip paths, but the runtime page does not enforce same-origin, relative path, downloads/ prefix, .zip extension, or expected filename. If release-info.json is tampered independently, users can be sent to a malicious extension ZIP.

#### Validation

Validation traced docs/index.html and the release-info generator. Text rendering is escaped. The issue is href trust: renderDownloadLinks selects metadata-provided download paths before fallback paths and assigns them directly. Nginx serves release-info.json and downloads as static files under /cms-smartling.

#### Dataflow

tampered release-info.json -> fetch("release-info.json") -> renderDownloadLinks -> downloadChromium.href/downloadFirefox.href -> user downloads and manually loads extension ZIP.

#### Reachability

The precondition is write access to deployed release metadata or equivalent static-host compromise. That is narrower than normal web attacker reachability, but the impact is meaningful because this page distributes executable browser extension packages.

#### Severity

Severity is medium because the affected surface is a software distribution workflow, but the attacker must first tamper with internal static metadata. Evidence of signed packages or locked-down metadata deployment would lower severity; evidence that release-info can be modified by a broader role would raise it.

#### Remediation

Validate metadata download paths before assigning hrefs. Accept only same-origin relative downloads/cms-smartling-connector-*-v<version>.zip paths, reject absolute URLs and non-HTTP schemes, publish hashes in release-info, and consider requiring checksum verification or extension package signing for manual installs.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Backend HTTP API | Authentication, CORS, protected actions | Reported | CAND-DEPLOY-001. |
| Smartling adapter | SSRF and secret exposure | No issue found | Fixed Smartling API host; status redacts token values. |
| SQLite store | SQL injection | No issue found | Prepared statements and fixed table names. |
| XLSX import parser | Resource exhaustion | Reported | CAND-XLSX-DOS-004. |
| Extension rendering | DOM XSS | Rejected | Dynamic values are escaped; translations are inserted as form values. |
| Extension scope | Origin trust | Reported | EXT-FR-001. |
| Extension backend URL | Configuration hardening | Needs follow-up | Allowlist expected hosts for production. |
| Landing page | Download/update integrity | Reported | CAND-RELEASE-001. |
| Build/deploy scripts | Command/path injection | No issue found | Targets and paths are fixed or allowlisted. |
| Secrets/config | Committed secrets | No issue found | .env ignored; examples are placeholders. |

## Open Questions And Follow Up

- Confirm whether /cms-smartling/api/ is protected by any upstream SSO, VPN, WAF, or network allowlist not represented in scripts/newrequestform.conf.
- Decide whether mock-publish and /api/translations/stage should exist outside local development.
- Add a production CMS origin allowlist for Chromium and Firefox manifests before the next extension release.
- Add package integrity controls for extension ZIP distribution, especially if users manually load unpacked folders.
- Re-run the Codex Security Python report validator once Python312.dll is unblocked.
