# Validation Report: Release metadata can replace extension download links with unvalidated URLs

Candidate id: CAND-RELEASE-001
Disposition: reportable
Confidence: medium

## Rubric

- [x] Release metadata source identified.
- [x] Download href assignment sink identified.
- [x] Normal generator counterevidence identified.
- [x] Metadata-only tamper path remains unvalidated by code.
- [ ] No deployed-host tamper was performed.

## Method

Validation used source tracing and the repository syntax check. `npm run check` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: Tampered deployed release-info.json.
- Sink/control: releaseInfo.downloads.chromium/firefox are assigned directly to anchor hrefs.
- Impact: A metadata-only compromise can point users at a malicious extension ZIP during manual extension distribution.
- Affected locations: docs/index.html:100-111, docs/index.html:134-157, scripts/newrequestform.conf:113-123

## Notes

The normal release-info generator emits safe relative ZIP paths, but the runtime landing page accepts downloads fields from release-info.json directly. A metadata-only tamper can therefore alter the href values without changing index.html.

## Closure

Survives validation: yes
