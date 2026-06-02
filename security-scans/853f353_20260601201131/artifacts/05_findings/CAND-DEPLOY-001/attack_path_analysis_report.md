# Attack Path Analysis: Unauthenticated backend API is published with wildcard CORS

Candidate id: CAND-DEPLOY-001
Final policy decision: report
Severity: high
Confidence: high

## Attack Path

1. An attacker on a reachable browser origin or internal client sends a request to /cms-smartling/api/ or the backend URL.
2. The backend responds with wildcard CORS and dispatches the route without an authentication or origin gate.
3. State-changing handlers create Smartling jobs, submit custom jobs, import/sync translations, mock-publish, stage translations, or log events.
4. The backend uses its configured Smartling credentials or local store privileges, crossing from an arbitrary caller into the translation workflow.

## Facts

- In-scope component: backend API and internal nginx deployment are in scope.
- Vector: local_network or reachable browser origin, depending on server exposure.
- Auth scope: public to any caller that can reach the service.
- Attacker input control: yes: request body, query, route id, and XLSX upload paths.
- Cross-boundary behavior: verified from caller to backend-held Smartling credentials/local translation store.
- Existing controls: TLS, backend loopback bind, request size caps, manual CMS save.
- Counterevidence: loopback bind is not dispositive because nginx publishes /cms-smartling/api/.
- Blindspots: actual enterprise network reachability and SSO front door were not tested.

## Severity Calibration

High because unauthenticated callers can invoke privileged Smartling and translation-state actions with no app-layer authorization, and wildcard CORS enables arbitrary webpages to drive and read responses when the backend is reachable.

## Remediation

Add backend authentication for every /api route, restrict CORS to known extension/CMS origins, reject unexpected Origin headers, protect nginx with SSO or network allowlists, and disable mock/stage test routes in production.
