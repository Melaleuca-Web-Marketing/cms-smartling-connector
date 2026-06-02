# Attack Path Analysis: Extension content script runs on all URLs and trusts spoofable CMS DOM

Candidate id: EXT-FR-001
Final policy decision: report
Severity: medium
Confidence: medium

## Attack Path

1. A user with the extension installed visits a non-CMS webpage controlled by an attacker.
2. The page includes CMS-like SKU, locale, and managed field DOM markers.
3. The content script runs because the manifest uses <all_urls> and accepts the page via DOM heuristics.
4. The script can query staged translations and render them into page DOM, or submit page-controlled source strings after a user click.

## Facts

- In-scope component: browser extension manifest and content script are in scope.
- Vector: remote webpage visited by an extension user.
- Auth scope: extension runs without CMS origin verification.
- Attacker input control: yes: attacker controls page DOM.
- Cross-boundary behavior: browser page origin influences extension/backend workflow.
- Existing controls: HTML escaping, fixed managed field labels, known locales, user click for source submission.
- Counterevidence: escaping prevents script execution; some actions require user interaction.
- Blindspots: browser permission behavior was not dynamically reproduced.

## Severity Calibration

Medium because exploitation requires a user to visit a crafted page and does not execute script in the extension context, but it unnecessarily exposes the workflow to arbitrary origins and can leak or submit workflow data.

## Remediation

Limit content_scripts.matches and web_accessible_resources to the real CMS origins, add runtime hostname checks before rendering or fetching, and keep backend credentials/tokens unavailable to content scripts on unapproved origins.
