# CMS Smartling Connector Threat Model

## Overview

This repository contains a browser-extension-assisted workflow and a local/internal Node.js backend for submitting selected CMS product copy and custom strings to Smartling, tracking translation jobs, importing published translations, and helping content authors insert translated strings into localized CMS fields. Primary runtime components are the backend HTTP API in `backend/server.mjs`, the Smartling client in `backend/smartlingAdapter.mjs`, SQLite persistence in `backend/store.mjs`, the CMS content script in `extension/content.js`, extension popup/full-page UIs in `extension/popup.js`, `extension/bulk-import.js`, and `extension/recent-jobs.js`, and the internal static download page in `docs/index.html`.

Important assets include Smartling API user identifiers/secrets and project IDs, submitted source strings, downloaded translations, local job/request history in SQLite, CMS page content read by the extension, and the integrity of translation values inserted into CMS fields. The repository does not contain a full CMS authentication layer; it relies on the CMS and internal network/server deployment for user authentication and authorization.

## Threat Model, Trust Boundaries, and Assumptions

Trust boundaries:

- Browser extension to backend API: extension pages and the CMS content script call the backend over a configurable URL. Requests include job names, due dates, strings, SKU/culture metadata, XLSX upload content, and sync/import actions.
- Backend to Smartling API: backend authenticates to Smartling using environment-provided secrets and uploads/downloads JSON translation files.
- Backend to local SQLite/legacy JSON store: request and translation records are persisted locally or on an internal server.
- Extension content script to CMS DOM: the extension reads visible CMS fields and writes translated values into CMS form controls, but authors still save manually in CMS.
- Internal landing page to users: static docs and ZIP download links distribute extension packages and release metadata.
- Build/deploy scripts to host filesystem and Git: packaging and deployment scripts copy files, generate ZIPs, and run git/zip commands.

Attacker-controlled inputs include any request body sent to the backend API if the backend is reachable, XLSX file bytes uploaded for bulk import, job names/reference/additional details/custom labels/source strings, SKU/culture/query parameters, release-info JSON if the static download host is compromised, Smartling translated file contents returned from the API, and CMS DOM text if the CMS page contains untrusted product values. Operator-controlled inputs include `.env` configuration, Smartling project tokens, backend URL settings in extension storage, deployment paths, and internal server routing. Developer-controlled inputs include repository source files and build scripts.

Core assumptions:

- The backend is intended for local or internal-network use, not public Internet exposure.
- The CMS itself authenticates users and controls who can view/edit product pages.
- Smartling credentials are stored outside Git in `.env` and protected by host access controls.
- Content authors are trusted to manually confirm translations before saving them in CMS.
- Extension packages are distributed by an internal server and loaded manually by users.

## Attack Surface, Mitigations, and Attacker Stories

Primary attack surfaces are unauthenticated backend HTTP endpoints, permissive CORS, Smartling submission/import routes, the XLSX bulk-import parser, extension HTML rendering via `innerHTML`, extension host permissions, configurable backend URL storage, static landing-page release rendering, and deployment/build scripts.

High-impact attacker stories include: an internal attacker or malicious webpage reaching the backend to create or import translation requests; forged backend requests using permissive CORS; malicious XLSX files attempting parser/resource exhaustion or XML/ZIP confusion; malicious Smartling translations or source strings attempting HTML/script injection in extension pages; a compromised release-info endpoint misleading users into extension update downloads; and accidental exposure of Smartling secrets or runtime SQLite data.

Existing controls include JSON response helpers that redact Smartling token presence in status responses, `.gitignore` exclusions for `.env` and runtime data, source string and translation rendering functions that escape HTML before assigning into `innerHTML`, size limits for JSON and XLSX request bodies, Smartling file-readiness checks before import, SQLite parameterized inserts, fixed Smartling API host, and manual CMS save as the final confirmation step.

Out-of-scope or lower-priority stories include attacks requiring write access to this Git repository or trusted deployment scripts unless they affect distributed artifacts, and CMS authorization bypasses inside the CMS application itself because that code is not in this repository.

## Severity Calibration (Critical, High, Medium, Low)

Critical findings would include exposed Smartling secrets in committed files, arbitrary code execution in the backend from unauthenticated input, or a public unauthenticated backend route that can directly overwrite CMS without author confirmation.

High findings would include unauthenticated backend routes that let arbitrary internal web pages submit Smartling jobs or stage attacker-controlled translations, XSS in extension pages or the CMS content script that can execute in the extension context, path traversal or arbitrary file write/read through upload/build/deploy code, or a compromised update flow that can direct users to malicious extension packages.

Medium findings would include denial of service from oversized or malformed XLSX/JSON requests, excessive host permissions increasing extension blast radius, insufficient authorization on sensitive internal status/history endpoints, or persistent local data exposure where only internal users or local attackers are in scope.

Low findings would include missing hardening headers on static pages, minor information disclosure from redacted configuration status, non-sensitive logging, or security improvements that require an already trusted operator/developer account to exploit.
