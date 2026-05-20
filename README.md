# CMS Smartling Connector

MVP scaffold for a browser-extension-assisted Smartling workflow.

The extension detects the CMS product page, submits only `Product Name` and `Description (Short)`, and inserts staged translations into localized CMS fields. The backend stores requests/results locally and exposes mock publishing endpoints until the live Smartling adapter is wired.

## Workflow

- `United States | en-US` submits to the US project for `es-US`.
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

Health check:

```text
GET /health
```

Stored data lives in a local SQLite database:

```text
backend/data/store.sqlite
```

If `backend/data/store.json` exists from an earlier MVP build and the SQLite database is empty, the backend imports the JSON file into SQLite on first startup. Runtime data files under `backend/data` are ignored by Git.

## Build Browser Extensions

Generate loadable extension folders from the shared source files:

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
```

The package script creates:

```text
dist/packages/cms-smartling-connector-chromium.zip
dist/packages/cms-smartling-connector-firefox.zip
```

These ZIPs can be uploaded to a GitHub Release so the static landing page can link to the latest downloads.

## Download Landing Page

A static download page lives in:

```text
docs/index.html
```

It links to expected GitHub Release assets:

```text
cms-smartling-connector-chromium.zip
cms-smartling-connector-firefox.zip
```

This can be published with GitHub Pages from the `docs` folder or copied to an internal static site.

Release flow:

1. Run `npm run package:extension`.
2. Create a GitHub Release.
3. Upload both ZIP files from `dist/packages`.
4. Keep the asset names unchanged so the download page always points at the latest release.

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

For production, narrow the `content_scripts.matches` value in `extension/manifest.json` and `extension/manifest.firefox.json` to the CMS origin.

## Custom Translation Jobs

The extension popup includes a `Custom Job` tab for strings that are not tied to a SKU, such as facet/refiner labels, category headings, or custom page copy.

Custom jobs support:

- Editable job name, defaulting to `yyyymmdd-Custom`.
- Project selection for US, CA, or EU.
- Fixed US target of Spanish and fixed CA target of French.
- EU target language checkboxes for `nl-NL`, `de-DE`, `de-AT`, `pl-PL`, `lt-LT`, and `it-IT`.
- Job due date and authorize-job controls.
- One or more labeled source strings.
- Recent custom job history and manual translation checks.

The popup submits custom jobs through:

```text
POST /api/custom-translation-requests
```

Recent custom jobs are read through:

```text
GET /api/custom-translation-requests
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
