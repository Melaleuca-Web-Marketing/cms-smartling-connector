# Candidate Reconciliation

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
