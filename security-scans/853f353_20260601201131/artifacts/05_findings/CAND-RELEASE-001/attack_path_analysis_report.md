# Attack Path Analysis: Release metadata can replace extension download links with unvalidated URLs

Candidate id: CAND-RELEASE-001
Final policy decision: report
Severity: medium
Confidence: medium

## Attack Path

1. An attacker tampers with deployed release-info.json while leaving index.html intact.
2. A user opens the internal extension download page.
3. The page fetches release-info.json and assigns downloads.chromium/firefox directly to href values.
4. The user downloads and manually loads the attacker-selected extension package.

## Facts

- In-scope component: internal landing page and extension distribution workflow are in scope.
- Vector: supply-chain/update-channel tamper after static metadata compromise.
- Auth scope: requires write access to deployed release metadata or equivalent deployment compromise.
- Attacker input control: yes under metadata-tamper precondition.
- Cross-boundary behavior: metadata changes user-facing extension download target.
- Existing controls: normal generator emits relative downloads/*.zip paths; text is escaped; nginx serves fixed aliases.
- Counterevidence: generator counterevidence lowers likelihood but does not validate runtime metadata.
- Blindspots: deployment filesystem permissions and integrity monitoring were not reviewed.

## Severity Calibration

Medium because the impact is extension distribution compromise, but the attacker must first tamper with the internal static metadata.

## Remediation

Accept only same-origin relative downloads/cms-smartling-connector-*.zip paths, ignore external schemes, add extension package hashes to release metadata, and consider signing or checksum verification for downloaded ZIPs.
