# Attack Path Analysis: Stored backend URL is not allowlisted by extension code

Candidate id: EXT-FR-002
Final policy decision: needs follow-up
Severity: low
Confidence: medium

## Attack Path

1. A user or attacker with access to extension settings changes the backend URL.
2. Extension pages send API calls and release checks to that configured base.
3. The configured host can receive job/source data and influence update banners.

## Facts

- In-scope component: extension settings are in scope.
- Vector: operator/user-controlled setting.
- Auth scope: requires ability to change extension local settings.
- Attacker input control: yes under privileged/local precondition.
- Cross-boundary behavior: configuration controls destination for workflow data.
- Existing controls: host permissions restrict declared destinations.
- Counterevidence: no evidence arbitrary webpages can modify chrome.storage.local.
- Blindspots: managed enterprise extension policy was not reviewed.

## Severity Calibration

Low/follow-up because this is mainly production configuration hardening unless a less-privileged actor can change the stored URL.

## Remediation

Use an allowlist of production/internal/local development backend URLs and warn or block unapproved schemes/hosts.
