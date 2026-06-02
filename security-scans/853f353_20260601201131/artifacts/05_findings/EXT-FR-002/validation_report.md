# Validation Report: Stored backend URL is not allowlisted by extension code

Candidate id: EXT-FR-002
Disposition: reviewed-follow-up
Confidence: medium

## Rubric

- [x] Configurable backend URL source identified.
- [x] Extension API/update consumers identified.
- [x] Host permission counterevidence identified.
- [ ] No evidence that untrusted actors can alter extension storage.

## Method

Validation used source tracing and the repository syntax check. `npm run check` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: Operator/user-controlled extension setting or compromised permitted backend host.
- Sink/control: Extension API calls and update check use the configured base URL after only trimming trailing slashes.
- Impact: Configuration hardening gap; exploitability depends on controlling the extension setting or allowed host.
- Affected locations: extension/popup.js:581-583, extension/versionCheck.js:7-11

## Notes

The extension settings UI intentionally lets users configure a backend URL. This is useful for local testing but should be constrained for production. Existing host permissions reduce arbitrary-host exploitability.

## Closure

Survives validation: uncertain/follow-up
