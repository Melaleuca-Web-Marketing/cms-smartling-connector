# Reconciliation

Four candidates survived validation and attack-path analysis as reportable findings:

1. CAND-DEPLOY-001: unauthenticated backend API with wildcard CORS and nginx publication.
2. CAND-XLSX-DOS-004: XLSX ZIP/XML resource exhaustion.
3. EXT-FR-001: all-URL content script origin trust failure.
4. CAND-RELEASE-001: unvalidated release metadata download hrefs.

Backend auth, stage/tamper, and read-leak candidates were merged into CAND-DEPLOY-001 because they share the same missing authentication and cross-origin root control. EXT-FR-002 was retained as a follow-up hardening item rather than a final finding because it requires control over the user's stored backend URL or a compromised allowed backend host.
