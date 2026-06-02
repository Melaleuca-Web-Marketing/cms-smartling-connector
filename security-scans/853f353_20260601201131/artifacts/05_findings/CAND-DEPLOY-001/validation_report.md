# Validation Report: Unauthenticated backend API is published with wildcard CORS

Candidate id: CAND-DEPLOY-001
Disposition: reportable
Confidence: high

## Rubric

- [x] Attacker-controlled HTTP request source identified.
- [x] Sensitive state-changing and read routes identified.
- [x] Missing auth/CORS/root-control line identified.
- [x] Deployment evidence shows API publication beyond backend loopback.
- [x] Counterevidence reviewed and not dispositive.

## Method

Validation used source tracing and the repository syntax check. `npm run check` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: Any browser origin or client that can reach the backend or nginx /cms-smartling/api/ path.
- Sink/control: Unauthenticated create, sync, import, mock-publish, stage, and read routes execute with backend-held Smartling credentials or mutate local translation state.
- Impact: Unauthorized Smartling job creation, workflow data disclosure, and attacker-controlled staged translations for CMS authors.
- Affected locations: backend/server.mjs:179-185, backend/server.mjs:1300-1308, backend/server.mjs:1342-1418, scripts/newrequestform.conf:135-143

## Notes

No authentication middleware, bearer-token check, session check, origin allowlist, or nginx access-control directive was found before sensitive backend routes. The strongest counterevidence is the default loopback backend bind, but the reviewed nginx config intentionally publishes the API path to the internal HTTPS host.

## Closure

Survives validation: yes
