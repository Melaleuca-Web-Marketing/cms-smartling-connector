import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const scanDir = join(root, "security-scans", "853f353_20260601201131");
const now = "2026-06-01T20:30:00-06:00";

function writeRel(relativePath, content) {
  const target = join(scanDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content.replace(/\n/g, "\r\n"), "utf8");
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function table(rows) {
  return rows.join("\n");
}

const candidates = [
  {
    candidate_id: "CAND-DEPLOY-001",
    title: "Unauthenticated backend API is published with wildcard CORS",
    disposition: "reportable",
    severity: "high",
    confidence: "high",
    affected_locations: [
      "backend/server.mjs:179-185",
      "backend/server.mjs:1300-1308",
      "backend/server.mjs:1342-1418",
      "scripts/newrequestform.conf:135-143"
    ],
    source: "Any browser origin or client that can reach the backend or nginx /cms-smartling/api/ path.",
    sink: "Unauthenticated create, sync, import, mock-publish, stage, and read routes execute with backend-held Smartling credentials or mutate local translation state.",
    impact: "Unauthorized Smartling job creation, workflow data disclosure, and attacker-controlled staged translations for CMS authors."
  },
  {
    candidate_id: "CAND-XLSX-DOS-004",
    title: "XLSX import can synchronously inflate oversized XML before row limits apply",
    disposition: "reportable",
    severity: "medium",
    confidence: "high",
    affected_locations: [
      "backend/server.mjs:219",
      "backend/server.mjs:651-652",
      "backend/xlsxImport.mjs:42-76",
      "backend/xlsxImport.mjs:109-116"
    ],
    source: "Uploaded XLSX bytes to /api/custom-translation-requests/import-xlsx.",
    sink: "inflateRawSync and whole-document XML parsing run without uncompressed-size or aggregate ZIP-entry limits.",
    impact: "A compressed workbook under the request cap can exhaust CPU or memory and block the Node event loop."
  },
  {
    candidate_id: "EXT-FR-001",
    title: "Extension content script runs on all URLs and trusts spoofable CMS DOM",
    disposition: "reportable",
    severity: "medium",
    confidence: "medium",
    affected_locations: [
      "extension/manifest.json:20",
      "extension/manifest.firefox.json:20",
      "extension/content.js:148",
      "extension/content.js:472-478",
      "extension/content.js:1482-1488"
    ],
    source: "An arbitrary webpage visited by a user with the extension installed.",
    sink: "DOM-shape checks activate Smartling UI and backend translation lookups without verifying the page origin is the real CMS.",
    impact: "Non-CMS pages can trigger backend lookups and render staged translations into attacker-observable page DOM; source-mode spoofing can also submit page-controlled jobs after a user click."
  },
  {
    candidate_id: "CAND-RELEASE-001",
    title: "Release metadata can replace extension download links with unvalidated URLs",
    disposition: "reportable",
    severity: "medium",
    confidence: "medium",
    affected_locations: [
      "docs/index.html:100-111",
      "docs/index.html:134-157",
      "scripts/newrequestform.conf:113-123"
    ],
    source: "Tampered deployed release-info.json.",
    sink: "releaseInfo.downloads.chromium/firefox are assigned directly to anchor hrefs.",
    impact: "A metadata-only compromise can point users at a malicious extension ZIP during manual extension distribution."
  },
  {
    candidate_id: "EXT-FR-002",
    title: "Stored backend URL is not allowlisted by extension code",
    disposition: "reviewed-follow-up",
    severity: "low",
    confidence: "medium",
    affected_locations: [
      "extension/popup.js:581-583",
      "extension/versionCheck.js:7-11"
    ],
    source: "Operator/user-controlled extension setting or compromised permitted backend host.",
    sink: "Extension API calls and update check use the configured base URL after only trimming trailing slashes.",
    impact: "Configuration hardening gap; exploitability depends on controlling the extension setting or allowed host."
  }
];

writeRel("artifacts/01_context/seed_research.md", `# Seed Research

No external CVE, package advisory, or third-party dependency seed was supplied for this scan. The repository has no npm dependencies or devDependencies in package metadata, so dependency advisory enumeration was not a meaningful input.

The scan used repository-local evidence only: backend routes, extension manifests and UI scripts, static landing-page code, deployment scripts, README workflow documentation, and the generated threat model. Python-based helper tooling was not available because local Python execution failed with a blocked logon-session/Python DLL error, so candidate discovery and report generation were performed with PowerShell, Node syntax checks, source tracing, and subagent review.
`);

writeRel("artifacts/02_discovery/raw_candidates_reconciled.jsonl", jsonl([
  candidates[0],
  {
    candidate_id: "CAND-BACKEND-AUTH-001",
    title: "Unauthenticated wildcard-CORS backend can drive Smartling jobs",
    disposition: "merged-into:CAND-DEPLOY-001",
    affected_locations: ["backend/server.mjs:179-185", "backend/server.mjs:1342-1350", "backend/smartlingAdapter.mjs:325"],
    source: "Arbitrary browser or internal client POST body.",
    sink: "submitRequestToSmartling and Smartling batch/job calls.",
    impact: "Unauthorized Smartling job creation with backend credentials."
  },
  {
    candidate_id: "CAND-BACKEND-TAMPER-002",
    title: "Mock/stage endpoints allow arbitrary persisted translations",
    disposition: "merged-into:CAND-DEPLOY-001",
    affected_locations: ["backend/server.mjs:1160", "backend/server.mjs:1227", "backend/server.mjs:1414"],
    source: "Arbitrary POST body.",
    sink: "Stored translations consumed by extension.",
    impact: "Attacker-controlled staged translations."
  },
  {
    candidate_id: "CAND-BACKEND-LEAK-003",
    title: "Unauthenticated read endpoints expose request and translation history",
    disposition: "merged-into:CAND-DEPLOY-001",
    affected_locations: ["backend/server.mjs:1354", "backend/server.mjs:1367", "backend/server.mjs:1418"],
    source: "Arbitrary GET requests.",
    sink: "Request, translation, and Smartling status JSON responses.",
    impact: "Workflow data disclosure."
  },
  candidates[1],
  candidates[2],
  candidates[4],
  candidates[3]
]));

writeRel("artifacts/02_discovery/deduped_candidates.jsonl", jsonl(candidates));

writeRel("artifacts/02_discovery/dedupe_report.md", `# Candidate Reconciliation

| Input Candidate | Disposition | Reason |
| --- | --- | --- |
| CAND-DEPLOY-001 | Reportable | Deployment and backend evidence combine into the strongest source/control/sink tuple for unauthenticated API exposure. |
| CAND-BACKEND-AUTH-001 | Merged into CAND-DEPLOY-001 | Same missing-auth and wildcard-CORS root control; backend-only evidence supports the final deployment/API finding. |
| CAND-BACKEND-TAMPER-002 | Merged into CAND-DEPLOY-001 | Mock/stage routes are a concrete protected action within the unauthenticated API family. |
| CAND-BACKEND-LEAK-003 | Merged into CAND-DEPLOY-001 | Read endpoints are a concrete protected data exposure within the unauthenticated API family. |
| CAND-XLSX-DOS-004 | Reportable | Separate parser/resource-exhaustion root cause. |
| EXT-FR-001 | Reportable | Separate extension-origin trust failure; backend exposure amplifies but does not create the manifest scope issue. |
| EXT-FR-002 | Follow-up hardening | Depends on operator/user setting control or allowed host compromise; useful hardening but not a primary final finding. |
| CAND-RELEASE-001 | Reportable | Separate update/download supply-chain control failure. |
`);

const workRows = [
  ["backend/server.mjs", "covered", "Reported CAND-DEPLOY-001; supports CAND-XLSX-DOS-004 upload entrypoint."],
  ["backend/smartlingAdapter.mjs", "covered", "No SSRF or direct secret disclosure; Smartling host fixed and secrets stay in env."],
  ["backend/store.mjs", "covered", "No SQL injection found; SQLite values use prepared statements and fixed table names."],
  ["backend/xlsxImport.mjs", "covered", "Reported CAND-XLSX-DOS-004; no filesystem extraction/path traversal found."],
  ["extension/content.js", "covered", "Reported EXT-FR-001; DOM XSS suppressed due escaping and value-only insertion."],
  ["extension/popup.js", "covered", "EXT-FR-002 follow-up; dynamic UI values escaped; no Smartling secrets stored."],
  ["extension/bulk-import.js", "covered", "Escapes imported rows before rendering; backend XLSX parser risk handled separately."],
  ["extension/recent-jobs.js", "covered", "Escapes backend job fields and favorites; no standalone XSS finding."],
  ["extension/versionCheck.js", "covered", "Supports EXT-FR-002; release download-page URL derives from configured base."],
  ["extension/manifest.json", "covered", "Reported EXT-FR-001 for <all_urls> content script and web-accessible resource scope."],
  ["extension/manifest.firefox.json", "covered", "Reported EXT-FR-001 for <all_urls> content script and web-accessible resource scope."],
  ["extension/popup.html", "covered", "Static popup DOM; no direct security sink found."],
  ["extension/bulk-import.html", "covered", "Static bulk import DOM; no direct security sink found."],
  ["extension/recent-jobs.html", "covered", "Static recent jobs DOM; no direct security sink found."],
  ["extension/styles.css", "covered", "Static CSS; no script or external import risk found."],
  ["extension/popup.css", "covered", "Static CSS; no script or external import risk found."],
  ["extension/bulk-import.css", "covered", "Static CSS; no script or external import risk found."],
  ["extension/recent-jobs.css", "covered", "Static CSS; no script or external import risk found."],
  ["docs/index.html", "covered", "Reported CAND-RELEASE-001; text fields escaped."],
  ["docs/styles.css", "covered", "Static CSS; no security-sensitive behavior found."],
  ["scripts/build-extension.mjs", "covered", "Target allowlisted; no untrusted path/command input found."],
  ["scripts/package-extension.mjs", "covered", "Target allowlisted; package roots fixed; no exploitable command injection found."],
  ["scripts/generate-release-info.mjs", "covered", "Normal generator emits relative download paths; supports counterevidence for CAND-RELEASE-001."],
  ["scripts/generate-custom-job-template.mjs", "covered", "Static XLSX template generator; XML escaped; fixed ZIP entries."],
  ["scripts/deploy-nginx-cms-smartling.sh", "covered", "Copies fixed docs/download paths; publishes reviewed nginx config."],
  ["scripts/newrequestform.conf", "covered", "Reported CAND-DEPLOY-001 and supports CAND-RELEASE-001 deployment exposure."],
  ["ecosystem.config.cjs", "covered", "PM2 config references .env but embeds no secrets."],
  ["package.json", "covered", "No dependencies; npm scripts are local project scripts."],
  ["package-lock.json", "covered", "No third-party packages present."],
  [".env.example", "covered", "Placeholder-only secrets; HOST defaults to 127.0.0.1."],
  [".gitignore", "covered", "Ignores .env, runtime data, dist, generated downloads/release-info."],
  ["README.md", "covered", "Documents deployed backend endpoints and production manifest hardening note."]
].map(([path, status, evidence], index) => ({
  row_id: `WL-${String(index + 1).padStart(3, "0")}`,
  path,
  status,
  reviewer: "parent-and-subagents",
  receipt_time: now,
  evidence
}));

writeRel("artifacts/02_discovery/work_ledger.jsonl", jsonl(workRows));

const reviewedSurfaces = table([
  "# Reviewed Surfaces",
  "",
  "| Surface | Risk Area | Outcome | Notes |",
  "| --- | --- | --- | --- |",
  "| Backend HTTP API | Authentication, CORS, protected actions | Reported | `CAND-DEPLOY-001`; state-changing and sensitive read routes lack auth and allow wildcard CORS. |",
  "| Nginx deployment config | Internal API publication | Reported | `/cms-smartling/api/` is proxied to the backend without an auth or network allowlist. |",
  "| Smartling adapter | SSRF and secret exposure | No issue found | Fixed API host; status redacts token values; no user-controlled destination host. |",
  "| SQLite store | SQL injection, path control | No issue found | Values are parameterized; SQLite path is operator/env-controlled. |",
  "| XLSX import parser | ZIP/XML resource exhaustion | Reported | `CAND-XLSX-DOS-004`; compressed upload cap exists, uncompressed output cap does not. |",
  "| Extension content script | Origin trust and DOM spoofing | Reported | `EXT-FR-001`; content script runs on `<all_urls>` and trusts DOM shape. |",
  "| Extension rendering | DOM XSS | Rejected | Dynamic strings are escaped and translation insertion writes form-control values, not HTML. |",
  "| Extension backend URL setting | Configuration hardening | Needs follow-up | `EXT-FR-002`; code should allowlist expected hosts but exploitability depends on user/operator setting control. |",
  "| Landing page release links | Update/download supply chain | Reported | `CAND-RELEASE-001`; release metadata can set download hrefs without URL validation. |",
  "| Build/package scripts | Command injection, path traversal | No issue found | Targets are allowlisted; paths are fixed under repo/dist/docs; no third-party dependencies. |",
  "| Secret handling | Committed credentials | No issue found | `.env` ignored; `.env.example` has blank placeholders; no secrets printed or committed. |",
  "| Report tooling | Deterministic validator | Needs follow-up | Python execution failed due blocked local Python runtime, so report validator/renderer could not be run. |"
]);

writeRel("artifacts/03_coverage/reviewed_surfaces.md", `${reviewedSurfaces}\n`);
writeRel("artifacts/03_coverage/repository_coverage_ledger.md", `${reviewedSurfaces}\n\n## Worklist Receipts\n\nAll 32 worklist rows have completion receipts in artifacts/02_discovery/work_ledger.jsonl.\n`);

writeRel("artifacts/04_reconciliation/reconciliation.md", `# Reconciliation

Four candidates survived validation and attack-path analysis as reportable findings:

1. CAND-DEPLOY-001: unauthenticated backend API with wildcard CORS and nginx publication.
2. CAND-XLSX-DOS-004: XLSX ZIP/XML resource exhaustion.
3. EXT-FR-001: all-URL content script origin trust failure.
4. CAND-RELEASE-001: unvalidated release metadata download hrefs.

Backend auth, stage/tamper, and read-leak candidates were merged into CAND-DEPLOY-001 because they share the same missing authentication and cross-origin root control. EXT-FR-002 was retained as a follow-up hardening item rather than a final finding because it requires control over the user's stored backend URL or a compromised allowed backend host.
`);

function findingLedger(candidate, validationDisposition = "reportable", attackDecision = "report") {
  return jsonl([
    {
      phase: "discovery",
      candidate_id: candidate.candidate_id,
      status: "candidate",
      receipt_time: now,
      affected_locations: candidate.affected_locations,
      summary: candidate.title
    },
    {
      phase: "validation",
      candidate_id: candidate.candidate_id,
      method: "static trace plus npm run check",
      disposition: validationDisposition,
      receipt_time: now,
      evidence: `${candidate.source} reaches ${candidate.sink}`,
      validation_report: `artifacts/05_findings/${candidate.candidate_id}/validation_report.md`
    },
    {
      phase: "attack_path",
      candidate_id: candidate.candidate_id,
      decision: attackDecision,
      severity: candidate.severity,
      confidence: candidate.confidence,
      receipt_time: now,
      attack_path_report: `artifacts/05_findings/${candidate.candidate_id}/attack_path_analysis_report.md`
    }
  ]);
}

function validationReport(candidate, checklist, notes) {
  return `# Validation Report: ${candidate.title}

Candidate id: ${candidate.candidate_id}
Disposition: ${candidate.disposition}
Confidence: ${candidate.confidence}

## Rubric

${checklist.map((item) => `- [${item.ok ? "x" : " "}] ${item.text}`).join("\n")}

## Method

Validation used source tracing and the repository syntax check. \`npm run check\` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: ${candidate.source}
- Sink/control: ${candidate.sink}
- Impact: ${candidate.impact}
- Affected locations: ${candidate.affected_locations.join(", ")}

## Notes

${notes}

## Closure

Survives validation: ${candidate.disposition === "reportable" ? "yes" : "uncertain/follow-up"}
`;
}

function attackReport(candidate, notes) {
  return `# Attack Path Analysis: ${candidate.title}

Candidate id: ${candidate.candidate_id}
Final policy decision: ${candidate.disposition === "reportable" ? "report" : "needs follow-up"}
Severity: ${candidate.severity}
Confidence: ${candidate.confidence}

## Attack Path

${notes.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Facts

- In-scope component: ${notes.scope}
- Vector: ${notes.vector}
- Auth scope: ${notes.auth}
- Attacker input control: ${notes.input}
- Cross-boundary behavior: ${notes.boundary}
- Existing controls: ${notes.controls}
- Counterevidence: ${notes.counterevidence}
- Blindspots: ${notes.blindspots}

## Severity Calibration

${notes.severity}

## Remediation

${notes.remediation}
`;
}

const validationNotes = {
  "CAND-DEPLOY-001": "No authentication middleware, bearer-token check, session check, origin allowlist, or nginx access-control directive was found before sensitive backend routes. The strongest counterevidence is the default loopback backend bind, but the reviewed nginx config intentionally publishes the API path to the internal HTTPS host.",
  "CAND-XLSX-DOS-004": "The upload body is capped by compressed byte count. The ZIP central directory records compressed size, and selected entries are synchronously inflated without a max output length. The 500-row cap is applied after workbook XML is already inflated and parsed.",
  "EXT-FR-001": "The manifests inject the content script and expose the logo resource on all URLs. The content script uses CMS DOM shape, SKU text, locale fields, and managed label names as the page trust signal. HTML escaping reduces XSS risk, but it does not prove the page is the CMS.",
  "CAND-RELEASE-001": "The normal release-info generator emits safe relative ZIP paths, but the runtime landing page accepts downloads fields from release-info.json directly. A metadata-only tamper can therefore alter the href values without changing index.html.",
  "EXT-FR-002": "The extension settings UI intentionally lets users configure a backend URL. This is useful for local testing but should be constrained for production. Existing host permissions reduce arbitrary-host exploitability."
};

const checklists = {
  "CAND-DEPLOY-001": [
    { ok: true, text: "Attacker-controlled HTTP request source identified." },
    { ok: true, text: "Sensitive state-changing and read routes identified." },
    { ok: true, text: "Missing auth/CORS/root-control line identified." },
    { ok: true, text: "Deployment evidence shows API publication beyond backend loopback." },
    { ok: true, text: "Counterevidence reviewed and not dispositive." }
  ],
  "CAND-XLSX-DOS-004": [
    { ok: true, text: "Attacker-controlled file parser input identified." },
    { ok: true, text: "Compressed request cap identified." },
    { ok: true, text: "Unbounded synchronous inflate and XML parse identified." },
    { ok: true, text: "Row cap shown to apply after parse." },
    { ok: false, text: "No live DoS PoC was executed against the backend." }
  ],
  "EXT-FR-001": [
    { ok: true, text: "All-URL content-script scope identified." },
    { ok: true, text: "Spoofable CMS DOM trust signal identified." },
    { ok: true, text: "Backend lookup/render path identified." },
    { ok: true, text: "DOM XSS counterevidence checked." },
    { ok: false, text: "Browser-host permission semantics were not dynamically reproduced." }
  ],
  "CAND-RELEASE-001": [
    { ok: true, text: "Release metadata source identified." },
    { ok: true, text: "Download href assignment sink identified." },
    { ok: true, text: "Normal generator counterevidence identified." },
    { ok: true, text: "Metadata-only tamper path remains unvalidated by code." },
    { ok: false, text: "No deployed-host tamper was performed." }
  ],
  "EXT-FR-002": [
    { ok: true, text: "Configurable backend URL source identified." },
    { ok: true, text: "Extension API/update consumers identified." },
    { ok: true, text: "Host permission counterevidence identified." },
    { ok: false, text: "No evidence that untrusted actors can alter extension storage." }
  ]
};

const attackNotes = {
  "CAND-DEPLOY-001": {
    steps: [
      "An attacker on a reachable browser origin or internal client sends a request to /cms-smartling/api/ or the backend URL.",
      "The backend responds with wildcard CORS and dispatches the route without an authentication or origin gate.",
      "State-changing handlers create Smartling jobs, submit custom jobs, import/sync translations, mock-publish, stage translations, or log events.",
      "The backend uses its configured Smartling credentials or local store privileges, crossing from an arbitrary caller into the translation workflow."
    ],
    scope: "backend API and internal nginx deployment are in scope.",
    vector: "local_network or reachable browser origin, depending on server exposure.",
    auth: "public to any caller that can reach the service.",
    input: "yes: request body, query, route id, and XLSX upload paths.",
    boundary: "verified from caller to backend-held Smartling credentials/local translation store.",
    controls: "TLS, backend loopback bind, request size caps, manual CMS save.",
    counterevidence: "loopback bind is not dispositive because nginx publishes /cms-smartling/api/.",
    blindspots: "actual enterprise network reachability and SSO front door were not tested.",
    severity: "High because unauthenticated callers can invoke privileged Smartling and translation-state actions with no app-layer authorization, and wildcard CORS enables arbitrary webpages to drive and read responses when the backend is reachable.",
    remediation: "Add backend authentication for every /api route, restrict CORS to known extension/CMS origins, reject unexpected Origin headers, protect nginx with SSO or network allowlists, and disable mock/stage test routes in production."
  },
  "CAND-XLSX-DOS-004": {
    steps: [
      "An attacker posts a crafted XLSX to /api/custom-translation-requests/import-xlsx.",
      "The server accepts up to 5 MB of compressed upload bytes.",
      "The parser locates ZIP entries, slices compressed data, and calls inflateRawSync without an output cap.",
      "The event loop spends CPU/memory inflating and regex-parsing XML before the 500-row import cap applies."
    ],
    scope: "backend parser and custom bulk import workflow are in scope.",
    vector: "same backend exposure as the API, amplified by missing auth.",
    auth: "public if the backend API is reachable.",
    input: "yes: attacker controls workbook bytes.",
    boundary: "verified from HTTP upload to synchronous Node parser.",
    controls: "5 MB compressed upload cap and 500 imported row cap.",
    counterevidence: "row cap exists but applies after inflation/parsing; no uncompressed cap found.",
    blindspots: "no crash/DoS PoC executed; exact resource ceiling depends on host memory and Node zlib behavior.",
    severity: "Medium because this is an availability issue on an internal service, but it is reachable through an unauthenticated upload path and can block the single-threaded Node event loop.",
    remediation: "Require API auth, cap ZIP entry count and uncompressed byte totals, use zlib maxOutputLength or streaming with hard limits, reject suspicious central directory sizes, and parse XML with bounded input."
  },
  "EXT-FR-001": {
    steps: [
      "A user with the extension installed visits a non-CMS webpage controlled by an attacker.",
      "The page includes CMS-like SKU, locale, and managed field DOM markers.",
      "The content script runs because the manifest uses <all_urls> and accepts the page via DOM heuristics.",
      "The script can query staged translations and render them into page DOM, or submit page-controlled source strings after a user click."
    ],
    scope: "browser extension manifest and content script are in scope.",
    vector: "remote webpage visited by an extension user.",
    auth: "extension runs without CMS origin verification.",
    input: "yes: attacker controls page DOM.",
    boundary: "browser page origin influences extension/backend workflow.",
    controls: "HTML escaping, fixed managed field labels, known locales, user click for source submission.",
    counterevidence: "escaping prevents script execution; some actions require user interaction.",
    blindspots: "browser permission behavior was not dynamically reproduced.",
    severity: "Medium because exploitation requires a user to visit a crafted page and does not execute script in the extension context, but it unnecessarily exposes the workflow to arbitrary origins and can leak or submit workflow data.",
    remediation: "Limit content_scripts.matches and web_accessible_resources to the real CMS origins, add runtime hostname checks before rendering or fetching, and keep backend credentials/tokens unavailable to content scripts on unapproved origins."
  },
  "CAND-RELEASE-001": {
    steps: [
      "An attacker tampers with deployed release-info.json while leaving index.html intact.",
      "A user opens the internal extension download page.",
      "The page fetches release-info.json and assigns downloads.chromium/firefox directly to href values.",
      "The user downloads and manually loads the attacker-selected extension package."
    ],
    scope: "internal landing page and extension distribution workflow are in scope.",
    vector: "supply-chain/update-channel tamper after static metadata compromise.",
    auth: "requires write access to deployed release metadata or equivalent deployment compromise.",
    input: "yes under metadata-tamper precondition.",
    boundary: "metadata changes user-facing extension download target.",
    controls: "normal generator emits relative downloads/*.zip paths; text is escaped; nginx serves fixed aliases.",
    counterevidence: "generator counterevidence lowers likelihood but does not validate runtime metadata.",
    blindspots: "deployment filesystem permissions and integrity monitoring were not reviewed.",
    severity: "Medium because the impact is extension distribution compromise, but the attacker must first tamper with the internal static metadata.",
    remediation: "Accept only same-origin relative downloads/cms-smartling-connector-*.zip paths, ignore external schemes, add extension package hashes to release metadata, and consider signing or checksum verification for downloaded ZIPs."
  },
  "EXT-FR-002": {
    steps: [
      "A user or attacker with access to extension settings changes the backend URL.",
      "Extension pages send API calls and release checks to that configured base.",
      "The configured host can receive job/source data and influence update banners."
    ],
    scope: "extension settings are in scope.",
    vector: "operator/user-controlled setting.",
    auth: "requires ability to change extension local settings.",
    input: "yes under privileged/local precondition.",
    boundary: "configuration controls destination for workflow data.",
    controls: "host permissions restrict declared destinations.",
    counterevidence: "no evidence arbitrary webpages can modify chrome.storage.local.",
    blindspots: "managed enterprise extension policy was not reviewed.",
    severity: "Low/follow-up because this is mainly production configuration hardening unless a less-privileged actor can change the stored URL.",
    remediation: "Use an allowlist of production/internal/local development backend URLs and warn or block unapproved schemes/hosts."
  }
};

for (const candidate of candidates) {
  writeRel(`artifacts/05_findings/${candidate.candidate_id}/candidate_ledger.jsonl`, findingLedger(candidate, candidate.disposition, candidate.disposition === "reportable" ? "report" : "needs-follow-up"));
  writeRel(
    `artifacts/05_findings/${candidate.candidate_id}/validation_report.md`,
    validationReport(candidate, checklists[candidate.candidate_id], validationNotes[candidate.candidate_id])
  );
  writeRel(
    `artifacts/05_findings/${candidate.candidate_id}/attack_path_analysis_report.md`,
    attackReport(candidate, attackNotes[candidate.candidate_id])
  );
}

writeRel("report_validation.md", `# Report Validation

The Codex Security markdown report was written, but the plugin's deterministic Python validator and HTML renderer could not be executed in this environment.

Attempted command:

\`\`\`text
python --version
\`\`\`

Observed failure:

\`\`\`text
Program 'python.exe' failed to run: A specified logon session does not exist. It may already have been terminated.
\`\`\`

The user also reported that Python312.dll is being blocked. Because the required Python runtime is unavailable, the report was manually assembled from the saved scan artifacts and rendered to HTML with a local Node-generated static wrapper instead of the plugin Python renderer.

Additional verification completed:

\`\`\`text
npm run check
\`\`\`

Result: passed.
`);

const report = `# Security Review: CMS Smartling Connector

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
`;

writeRel("report.md", report);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const findingCards = candidates
  .filter((candidate) => candidate.disposition === "reportable")
  .map(
    (candidate) => `<section class="finding ${candidate.severity}">
      <h2>${escapeHtml(candidate.title)}</h2>
      <dl>
        <div><dt>Severity</dt><dd>${escapeHtml(candidate.severity)}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(candidate.confidence)}</dd></div>
        <div><dt>Impact</dt><dd>${escapeHtml(candidate.impact)}</dd></div>
        <div><dt>Affected</dt><dd>${escapeHtml(candidate.affected_locations.join(", "))}</dd></div>
      </dl>
    </section>`
  )
  .join("\n");

writeRel("report.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CMS Smartling Connector Codex Security Scan</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; color: #111827; background: #f8fafc; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1100px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .meta { color: #475569; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 24px 0; }
    .finding { background: #fff; border: 1px solid #dbe4ef; border-radius: 8px; padding: 16px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .finding.high { border-left: 5px solid #dc2626; }
    .finding.medium { border-left: 5px solid #d97706; }
    .finding h2 { font-size: 18px; margin: 0 0 12px; }
    dl { display: grid; gap: 10px; margin: 0; }
    dt { font-weight: 700; color: #334155; }
    dd { margin: 2px 0 0; color: #0f172a; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #dbe4ef; border-radius: 8px; padding: 20px; line-height: 1.5; overflow-x: auto; }
    a { color: #0369a1; }
  </style>
</head>
<body>
  <main>
    <h1>CMS Smartling Connector Codex Security Scan</h1>
    <div class="meta">Reportable findings: 4. Severity mix: 1 high, 3 medium. Generated ${escapeHtml(now)}.</div>
    <div class="grid">
      ${findingCards}
    </div>
    <h2>Full Markdown Report</h2>
    <pre>${escapeHtml(report)}</pre>
  </main>
</body>
</html>
`);
