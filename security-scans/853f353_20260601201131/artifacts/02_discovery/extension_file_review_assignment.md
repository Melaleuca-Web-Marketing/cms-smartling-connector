# Extension File Review Assignment

Scan id: 853f353_20260601201131

Assigned files reviewed in full:

- extension/content.js
- extension/popup.js
- extension/bulk-import.js
- extension/recent-jobs.js
- extension/versionCheck.js
- extension/manifest.json
- extension/manifest.firefox.json

## Candidate EXT-FR-001

Title: Content script runs on all URLs and trusts spoofable CMS DOM, exposing backend translation data and CMS-like actions to non-CMS pages.

Affected locations:

- extension/manifest.json:20 and extension/manifest.firefox.json:20 inject the content script on `<all_urls>`.
- extension/content.js:148 accepts a page as CMS-like based on `isCmsProductPage`.
- extension/content.js:472-478 treats any page with a SKU, active locale, managed fields, or the text `Localized Product Information` as in scope.
- extension/content.js:206-221, 238-264, and 280-302 derive SKU, locale, and managed fields directly from page DOM.
- extension/content.js:1476-1488 automatically fetches staged translations for target pages.
- extension/content.js:1513-1528 renders the fetched translation into the shared page DOM and inserts it into CMS-like controls on click.
- backend/server.mjs:179-185 and 1300-1306 send wildcard CORS headers; backend/server.mjs:1418-1432 returns translations by caller-supplied SKU and target locale.

Source: Arbitrary webpage DOM on any visited origin can provide CMS-like class names, labels, hidden locale fields, SKU headings, and text.

Sink or broken control: The origin control is missing. Manifest all-URL injection plus DOM-shape checks reach backend fetch/render/insert paths without verifying the page host is the real CMS.

Impact: A malicious webpage can make the extension query internal backend translation data for attacker-chosen SKU/locale and render staged translations into page DOM, where the page can observe shared DOM mutations. With user interaction, a spoofed source page can also submit page-controlled fields as Smartling jobs.

Closest control/counterevidence: XSS sinks escape HTML before `innerHTML`; only managed field labels and known locales are accepted; source submission requires a user click. These do not stop a non-CMS origin from spoofing the DOM shape, and target translation lookup/render is automatic once the page matches target mode.

Candidate-local validation facts: Reviewed content.js initialization, CMS detection, field extraction, target translation rendering, insertion, and API fetch path. Reviewed both manifests. Reviewed backend CORS and translation endpoint as supporting reachability evidence.

Attack-path facts: Attacker hosts a page with `Localized Product Information`, a `SKU - <value>` heading, `.left-label-input` managed field rows, and source/locale DOM matching a target route. The extension runs because of `<all_urls>`, accepts the page, calls `/api/translations?sku=...&targetLocale=...`, inserts escaped preview text into page DOM, and offers insert controls. If the attacker spoofs source mode and convinces the user to click, `/api/translation-requests` can be posted with page-controlled values.

## Candidate EXT-FR-002

Title: Backend URL configuration is not code-validated before API calls and update download banners trust the configured base URL.

Affected locations:

- extension/popup.js:24-40 loads and stores `apiBaseUrl` from extension storage.
- extension/popup.js:581-583 normalizes only trailing slashes.
- extension/content.js:118-127, extension/bulk-import.js:358-363, and extension/recent-jobs.js:31-36 reuse the stored URL.
- extension/versionCheck.js:6-31 fetches `/release-info.json` and constructs the download page URL from the same base.
- extension/content.js:450-460, extension/popup.js:178-187, extension/bulk-import.js:387-396, and extension/recent-jobs.js:417-426 render update links from that base.

Source: Operator/user-controlled extension storage value `apiBaseUrl`, or an attacker with the ability to alter that value or control an allowed backend host.

Sink or broken control: No code-level allowlist or HTTPS/internal-host validation before sending job/source data or rendering update download links.

Impact: Under the precondition that the stored backend URL is attacker-controlled or a permitted backend host is compromised, extension pages can send source strings, job metadata, XLSX imports, and dashboard lookups to that host, then show a download update link to the same untrusted base.

Closest control/counterevidence: Manifests restrict declared host permissions to the internal HTTPS host and localhost; the download URL is constructed from the configured base rather than taken directly from release JSON; banner text and href are escaped. This lowers exploitability for arbitrary internet hosts in extension pages, but there is no local code control that rejects unsafe or unexpected configured bases.

Candidate-local validation facts: Reviewed all assigned API fetch helpers and version banner renderers. No assigned file validates scheme, host, or path beyond trailing slash removal.

Attack-path facts: Attacker changes extension storage or persuades a user to save a hostile permitted/local base URL. The popup/bulk/recent/content pages fetch APIs against that base, and versionCheck fetches release metadata from it. If the response advertises a higher version, the rendered banner links users to that base for downloads.

## No-Finding Receipts

DOM XSS: Assigned `innerHTML` sinks were traced. Dynamic backend/CMS/Smartling values are escaped with `escapeHtml` or `escapeAttribute`; status updates use `textContent`; class names used in dynamic class positions are fixed by local mapping functions.

Smartling HTML insertion into CMS: Smartling translated text is previewed with escaping and inserted into input/textarea controls by assigning the control value, not by writing HTML into the CMS DOM. The final CMS save/render behavior is outside the assigned extension code.

Extension storage: Assigned files store backend URL, UI state, favorites, and draft job/source strings in `chrome.storage.local`. No Smartling secrets are stored. The data is exposed to local browser-profile/extension compromise, but not directly to arbitrary webpages by the assigned files.
