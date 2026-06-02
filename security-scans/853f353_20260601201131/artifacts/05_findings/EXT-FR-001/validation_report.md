# Validation Report: Extension content script runs on all URLs and trusts spoofable CMS DOM

Candidate id: EXT-FR-001
Disposition: reportable
Confidence: medium

## Rubric

- [x] All-URL content-script scope identified.
- [x] Spoofable CMS DOM trust signal identified.
- [x] Backend lookup/render path identified.
- [x] DOM XSS counterevidence checked.
- [ ] Browser-host permission semantics were not dynamically reproduced.

## Method

Validation used source tracing and the repository syntax check. `npm run check` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: An arbitrary webpage visited by a user with the extension installed.
- Sink/control: DOM-shape checks activate Smartling UI and backend translation lookups without verifying the page origin is the real CMS.
- Impact: Non-CMS pages can trigger backend lookups and render staged translations into attacker-observable page DOM; source-mode spoofing can also submit page-controlled jobs after a user click.
- Affected locations: extension/manifest.json:20, extension/manifest.firefox.json:20, extension/content.js:148, extension/content.js:472-478, extension/content.js:1482-1488

## Notes

The manifests inject the content script and expose the logo resource on all URLs. The content script uses CMS DOM shape, SKU text, locale fields, and managed label names as the page trust signal. HTML escaping reduces XSS risk, but it does not prove the page is the CMS.

## Closure

Survives validation: yes
