# CMS Smartling Connector

MVP scaffold for a browser-extension-assisted Smartling workflow.

The extension detects the CMS product page, submits only `Product Name` and `Description (Short)`, and inserts staged translations into localized CMS fields. The backend stores requests/results locally and exposes mock publishing endpoints until the live Smartling adapter is wired.

## Workflow

- `United States | en-US` submits to the US project for CMS target `es-US`, using Smartling locale `es-LA`.
- `Canada | en-CA` submits to the CA project for `fr-CA`.
- `Ireland | en-IE` submits to the EU project for selected target locales: `nl-NL`, `de-DE`, `de-AT`, `pl-PL`, `lt-LT`, and `it-IT`.
- `United States | es-US` and `Canada | fr-CA` show staged translation inserts.
- EU target cultures show staged translation inserts when matching translations are available.
- `Mexico | es-MX` is ignored.
- Authors still save manually in CMS.

On source cultures, the extension panel previews detected `Product Name` and `Description (Short)` values. Authors can uncheck a field before submission, edit the Smartling job name, set the Smartling job due date, and choose whether the job should be authorized after submission. Blank fields are shown but are not sent. The due date defaults to 3 business days at 5:00 PM local time for US/CA requests and 5 business days at 5:00 PM local time for EU requests.

## Run Backend

Create a local `.env` file first:

```powershell
Copy-Item .env.example .env
```

Then fill in the Smartling values when available. Prefer separate project tokens for the US and CA projects. Keep `SMARTLING_ENABLED=false` until the live Smartling adapter is wired.

```powershell
npm run backend
```

Default URL:

```text
http://127.0.0.1:17817
```

Run it under `pm2`:

```powershell
npm run pm2:start
pm2 save
```

To make the process come back after a machine reboot, enable the `pm2` systemd service once with:

```powershell
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u brand --hp /home/brand
```

Useful follow-up commands:

```powershell
npm run pm2:restart
npm run pm2:stop
npm run pm2:logs
pm2 status
```

Health check:

```text
GET /health
```

Stored data lives in a local SQLite database:

```text
backend/data/store.sqlite
```

If `backend/data/store.json` exists from an earlier MVP build and the SQLite database is empty, the backend imports the JSON file into SQLite on first startup. Runtime data files under `backend/data` are ignored by Git.

When `SMARTLING_ENABLED=true`, the backend can poll active submitted jobs and update local status automatically:

```text
SMARTLING_SYNC_ENABLED=true
SMARTLING_SYNC_INTERVAL_MINUTES=60
SMARTLING_SYNC_LOOKBACK_DAYS=30
SMARTLING_SYNC_MIN_CHECK_INTERVAL_MINUTES=5
```

The sync detects Smartling jobs that were cancelled or deleted, keeps progress feedback current, and stages published translations when files are ready. The Recent Jobs dashboard also runs a sync when opened or refreshed, so users do not need to click a separate check button for normal updates.

## Build Browser Extensions

Generate loadable extension folders and refresh the landing page ZIP downloads from the shared source files:

```powershell
npm run build:chromium
npm run build:firefox
```

Or build both:

```powershell
npm run build:extension
```

Build ZIP packages for distribution:

```powershell
npm run package:extension
```

The build output is ignored by Git:

```text
dist/chromium
dist/firefox
dist/packages
docs/downloads/*.zip
```

The build/package scripts create:

```text
dist/packages/cms-smartling-connector-chromium-v{version}.zip
dist/packages/cms-smartling-connector-firefox-v{version}.zip
docs/downloads/cms-smartling-connector-chromium-v{version}.zip
docs/downloads/cms-smartling-connector-firefox-v{version}.zip
```

The script also refreshes stable alias filenames without the version number for backwards compatibility. The `docs/downloads` copies are what the landing page links to. If the internal server serves the `docs` folder, run `npm run build:extension` during deployment so the downloadable ZIPs are regenerated before users access the page.

The build also creates:

```text
docs/release-info.json
```

The extension checks `{Backend URL}/release-info.json` and shows an update banner in the CMS panel and popup when the deployed version is newer than the installed extension version.

## Download Landing Page

A static download page lives in:

```text
docs/index.html
```

It links to expected ZIP files on the same internal web server:

```text
downloads/cms-smartling-connector-chromium.zip
downloads/cms-smartling-connector-firefox.zip
```

After `release-info.json` loads, the page updates those links to the versioned ZIP filenames for the current release.

This should be copied to an internal static site or web server.

Internal server release flow:

1. Run `npm run build:extension`.
2. Copy `docs/index.html`, `docs/styles.css`, and `docs/assets/smartling_logo.png` to the internal web server.
3. Copy the generated `docs/downloads` folder next to `index.html` on that server.
4. Keep the ZIP asset names unchanged so the download page always points at the latest available builds.

## Load Chrome or Edge Extension

1. Run `npm run build:chromium`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Load the unpacked extension from `dist/chromium`.
5. Open the CMS product page.
6. Use the extension popup if the backend URL needs to change.

## Load Firefox Extension

1. Run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose `Load Temporary Add-on`.
4. Select `dist/firefox/manifest.json`.
5. Open the CMS product page.

Firefox Manifest V3 host permissions are user-controlled. If the panel does not appear on the CMS page, open Firefox's extensions button and grant the assistant access to the current site.

The extension starts collapsed as a circular Smartling logo button in the lower-right corner. Open it to use the workflow panel. The panel header includes a dark/light theme toggle and a collapse control.

For production, keep the `content_scripts.matches` value in `extension/manifest.json` and `extension/manifest.firefox.json` limited to the CMS origin. Custom jobs still work from the extension popup and full-page extension screens; the content script is only needed for the in-page SKU panel.

## Backend Browser Access Controls

The backend no longer returns wildcard CORS headers. Browser callers are allowed when their `Origin` is one of the configured web origins or uses an allowed browser-extension scheme:

```env
CORS_ALLOWED_ORIGINS=https://ctuscms.melaleuca.net,https://usifhqtsagrqt01.melaleuca.net,http://localhost:17817,http://127.0.0.1:17817
CORS_ALLOWED_EXTENSION_SCHEMES=chrome-extension,moz-extension
```

Use `CORS_ALLOWED_ORIGINS` for web page origins such as the CMS host and the internal extension download host. Use `CORS_ALLOWED_EXTENSION_SCHEMES` for extension popup, Bulk Import, and Recent Jobs pages. Random web pages should not be listed.

For an additional backend guard, set `BACKEND_API_TOKEN` in `.env`. When present, every `/api/*` route requires `Authorization: Bearer <token>`. Users should save the same token in the extension Settings tab. `/health` remains unauthenticated so users can verify that the backend is reachable.

## Custom Translation Jobs

The extension popup includes a `Custom Job` tab for strings that are not tied to a SKU, such as facet/refiner labels, category headings, or custom page copy.

Custom jobs support:

- Editable job name, defaulting to `yyyymmdd-Custom`.
- Project selection for US, CA, or EU.
- Fixed US target of Spanish and fixed CA target of French.
- EU target language checkboxes for `nl-NL`, `de-DE`, `de-AT`, `pl-PL`, `lt-LT`, and `it-IT`.
- Job due date and authorize-job controls.
- One or more labeled source strings.
- Bulk import from the bundled Excel template at `extension/templates/custom-job-template.xlsx`.
- Recent custom job history and manual translation checks.

The popup keeps manual custom jobs compact. The `Bulk Import` popup button opens a full extension page for XLSX uploads, larger table review, row edits, and bulk submission.

The popup submits custom jobs through:

```text
POST /api/custom-translation-requests
```

Recent custom jobs are read through:

```text
GET /api/custom-translation-requests
```

Bulk custom-job workbooks are parsed through:

```text
POST /api/custom-translation-requests/import-xlsx
```

Published translations are checked through the same import endpoint used by SKU requests:

```text
POST /api/translation-requests/{requestId}/import-translations
```

## Test Without Smartling

Create a request from the CMS page while the active localized source is `en-US` or `en-CA`.

The extension submits a request shaped like:

```json
{
  "sku": "117",
  "country": "United States",
  "sourceLocale": "en-US",
  "jobName": "20260518-SKU117-skutranslations",
  "jobDueDate": "2026-05-21T23:00:00Z",
  "authorizeJob": false,
  "fields": [
    {
      "fieldKey": "productName",
      "fieldLabel": "Product Name",
      "value": "Source product name"
    }
  ]
}
```

Then publish mock translations:

```text
POST /api/translation-requests/{requestId}/mock-publish
```

Optional JSON body:

```json
{
  "fields": {
    "productName": "Translated product name",
    "descriptionShort": "Translated short description"
  }
}
```

You can also stage translations directly:

```text
POST /api/translations/stage
```

```json
{
  "sku": "117",
  "targetLocale": "es-US",
  "fields": {
    "productName": "Spanish product name",
    "descriptionShort": "Spanish short description"
  }
}
```

## Smartling Adapter

The backend uses Smartling Job Batches V2:

1. Authenticate with the selected project token.
2. Create a Smartling job with the submitted job name and due date.
3. Create a job batch for the uploaded file URI.
4. Upload a JSON file containing selected source strings.
5. Authorize the batch when `authorizeJob` is `true`; otherwise leave it awaiting manual authorization.

Check redacted Smartling runtime status:

```text
GET /api/smartling/status
```

Retry a stored local request:

```text
POST /api/translation-requests/{requestId}/submit-to-smartling
```

Manually import published translations for a submitted request:

```text
POST /api/translation-requests/{requestId}/import-translations
```

After import, the request status becomes `translations_available` and the existing target-culture extension flow can show inline insert controls.

Imports are guarded by Smartling file-locale status. The backend only stages translations when Smartling reports the file is 100% complete for the target locale, and downloads with `includeOriginalStrings=false` to avoid source-language bleed-through.
