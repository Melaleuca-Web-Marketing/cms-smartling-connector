import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  createSmartlingJob,
  downloadPublishedTranslations,
  getSmartlingJobStatus,
  getSmartlingRuntimeStatus
} from "./smartlingAdapter.mjs";
import { getStoreInfo, loadStore, saveStore } from "./store.mjs";
import { parseCustomJobWorkbook } from "./xlsxImport.mjs";

const env = globalThis.process?.env ?? {};
const PORT = Number(env.PORT || 17817);
const HOST = env.HOST || "127.0.0.1";
const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "https://usifhqtsagrqt01.melaleuca.net",
  "http://localhost:17817",
  "http://127.0.0.1:17817"
];
const CORS_ALLOWED_ORIGINS = new Set(
  parseCsvEnv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ALLOWED_ORIGINS)
    .map(normalizeOrigin)
    .filter(Boolean)
);
const CORS_ALLOWED_EXTENSION_SCHEMES = new Set(
  parseCsvEnv("CORS_ALLOWED_EXTENSION_SCHEMES", ["chrome-extension", "moz-extension"])
);
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization";
const CORS_ALLOWED_METHODS = "GET, POST, OPTIONS";
const BACKEND_API_TOKEN = String(env.BACKEND_API_TOKEN || "").trim();
const corsHeadersByResponse = new WeakMap();
const MAX_SMARTLING_JOB_DESCRIPTION_LENGTH = 8000;
const DEFAULT_SMARTLING_SYNC_INTERVAL_MINUTES = 60;
const DEFAULT_SMARTLING_SYNC_LOOKBACK_DAYS = 30;
const DEFAULT_SMARTLING_SYNC_MIN_CHECK_INTERVAL_MINUTES = 5;
const SYNCABLE_REQUEST_STATUSES = new Set(["submitted_to_smartling"]);
const SMARTLING_CANCELLED_STATUSES = new Set(["CANCELLED", "DELETED"]);

const FIELD_CONFIG = {
  productName: {
    label: "Product Name",
    required: true
  },
  descriptionShort: {
    label: "Description (Short)",
    required: false
  }
};

const ROUTES = [
  {
    id: "us-es",
    cmsCountry: "United States",
    sourceCmsLocale: "en-US",
    targetCmsCountry: "United States",
    targetCmsLocale: "es-US",
    smartlingProjectKey: "cms-product-copy-us",
    smartlingSourceLocale: "en-US",
    smartlingTargetLocale: "es-LA"
  },
  {
    id: "ca-fr",
    cmsCountry: "Canada",
    sourceCmsLocale: "en-CA",
    targetCmsCountry: "Canada",
    targetCmsLocale: "fr-CA",
    smartlingProjectKey: "cms-product-copy-ca",
    smartlingSourceLocale: "en-CA",
    smartlingTargetLocale: "fr-CA"
  },
  {
    id: "eu-nl",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Netherlands",
    targetCmsLocale: "nl-NL",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "nl-NL"
  },
  {
    id: "eu-de",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Germany",
    targetCmsLocale: "de-DE",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "de-DE"
  },
  {
    id: "eu-at",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Austria",
    targetCmsLocale: "de-AT",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "de-AT"
  },
  {
    id: "eu-pl",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Poland",
    targetCmsLocale: "pl-PL",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "pl-PL"
  },
  {
    id: "eu-lt",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Lithuania",
    targetCmsLocale: "lt-LT",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "lt-LT"
  },
  {
    id: "eu-it",
    cmsCountry: "Ireland",
    sourceCmsLocale: "en-IE",
    targetCmsCountry: "Italy",
    targetCmsLocale: "it-IT",
    smartlingProjectKey: "cms-product-copy-eu",
    smartlingSourceLocale: "en-IE",
    smartlingTargetLocale: "it-IT"
  }
];

function nowIso() {
  return new Date().toISOString();
}

function getSmartlingSyncConfig() {
  const intervalMinutes = getPositiveEnvNumber(
    "SMARTLING_SYNC_INTERVAL_MINUTES",
    DEFAULT_SMARTLING_SYNC_INTERVAL_MINUTES
  );
  const lookbackDays = getNonNegativeEnvNumber(
    "SMARTLING_SYNC_LOOKBACK_DAYS",
    DEFAULT_SMARTLING_SYNC_LOOKBACK_DAYS
  );
  const minCheckIntervalMinutes = getNonNegativeEnvNumber(
    "SMARTLING_SYNC_MIN_CHECK_INTERVAL_MINUTES",
    DEFAULT_SMARTLING_SYNC_MIN_CHECK_INTERVAL_MINUTES
  );
  const explicitEnabled = String(env.SMARTLING_SYNC_ENABLED || "").trim().toLowerCase();
  const enabled =
    env.SMARTLING_ENABLED === "true" &&
    intervalMinutes > 0 &&
    !["false", "0", "no", "off"].includes(explicitEnabled);

  return {
    enabled,
    intervalMinutes,
    intervalMs: intervalMinutes * 60 * 1000,
    lookbackDays,
    minCheckIntervalMinutes
  };
}

function getSmartlingSyncRuntimeStatus() {
  const config = getSmartlingSyncConfig();

  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    lookbackDays: config.lookbackDays,
    minCheckIntervalMinutes: config.minCheckIntervalMinutes
  };
}

function getPositiveEnvNumber(name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNonNegativeEnvNumber(name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseCsvEnv(name, fallback = []) {
  const raw = String(env[name] || "").trim();
  const values = raw ? raw.split(",") : fallback;
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getOriginScheme(origin) {
  const match = String(origin || "").match(/^([a-z][a-z0-9+.-]*):\/\//i);
  return match ? match[1].toLowerCase() : "";
}

function getCorsHeadersForRequest(req) {
  const origin = normalizeOrigin(req.headers.origin || "");

  if (!origin) {
    return {};
  }

  if (
    CORS_ALLOWED_ORIGINS.has(origin) ||
    CORS_ALLOWED_EXTENSION_SCHEMES.has(getOriginScheme(origin))
  ) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
      "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
      Vary: "Origin"
    };
  }

  return null;
}

function setCorsHeaders(res, headers) {
  corsHeadersByResponse.set(res, headers || {});
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isAuthorizedApiRequest(req, pathname) {
  if (!BACKEND_API_TOKEN || !isApiPath(pathname)) {
    return true;
  }

  return String(req.headers.authorization || "") === `Bearer ${BACKEND_API_TOKEN}`;
}

function normalizeJobDueDate(value) {
  const date = new Date(String(value || ""));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    ...(corsHeadersByResponse.get(res) || {}),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(res, statusCode, message, details = null) {
  sendJson(res, statusCode, {
    error: {
      message,
      details
    }
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBinaryBody(req, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Uploaded file is too large.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function normalizeLabel(label) {
  return String(label || "")
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function fieldKeyFromLabel(label) {
  const normalized = normalizeLabel(label).toLowerCase();
  if (normalized === "product name") return "productName";
  if (normalized === "description (short)") return "descriptionShort";
  return null;
}

function normalizeFields(fields) {
  const normalized = [];

  for (const field of Array.isArray(fields) ? fields : []) {
    const fieldKey = field.fieldKey || fieldKeyFromLabel(field.fieldLabel);
    if (!FIELD_CONFIG[fieldKey]) continue;
    if (field.selected === false) continue;

    normalized.push({
      fieldKey,
      fieldLabel: FIELD_CONFIG[fieldKey].label,
      sourceText: typeof field.value === "string" ? field.value : String(field.value ?? "")
    });
  }

  return normalized;
}

function normalizeCustomFields(fields) {
  const normalized = [];
  const keyCounts = new Map();

  for (const [index, field] of (Array.isArray(fields) ? fields : []).entries()) {
    if (field == null) continue;
    const label = normalizeLabel(field.label || field.fieldLabel || `String ${index + 1}`);
    const sourceText = typeof field.value === "string" ? field.value : String(field.value ?? "");
    const baseFieldKey =
      safeSegment(field.fieldKey || label || `string-${index + 1}`) || `string-${index + 1}`;
    const count = (keyCounts.get(baseFieldKey) || 0) + 1;
    keyCounts.set(baseFieldKey, count);
    const fieldKey = count === 1 ? baseFieldKey : `${baseFieldKey}-${count}`;

    normalized.push({
      fieldKey,
      fieldLabel: label,
      sourceText
    });
  }

  return normalized;
}

function sourceHash(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function countrySegment(country) {
  if (country === "United States") return "us";
  if (country === "Canada") return "ca";
  return safeSegment(country || "unknown");
}

function findRouteBySource(country, locale, targetLocale = null) {
  return ROUTES.find((route) => {
    const localeMatches = route.sourceCmsLocale === locale;
    const countryMatches = !country || route.cmsCountry === country;
    const targetMatches = !targetLocale || route.targetCmsLocale === targetLocale;
    return localeMatches && countryMatches && targetMatches;
  });
}

function findRouteByTarget(locale) {
  return ROUTES.find((route) => route.targetCmsLocale === locale);
}

function buildJobName(route, sku) {
  return `${formatCompactDate()}-${formatSkuForJobName(sku)}-skutranslations`;
}

function formatCompactDate(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatSkuForJobName(sku) {
  const skuValue = String(sku || "")
    .trim()
    .replace(/^SKU\s*-?\s*/i, "")
    .replace(/\s+/g, "");

  return `SKU${skuValue}`;
}

function buildFileUri(route, sku, requestId = null) {
  const uniqueSegment = requestId ? safeSegment(requestId) : `${route.sourceCmsLocale}_${route.targetCmsLocale}`;

  return [
    "cms-product-copy",
    countrySegment(route.cmsCountry),
    safeSegment(sku),
    `${uniqueSegment}.json`
  ].join("/");
}

function buildCustomFileUri(route, jobName, requestId) {
  return [
    "cms-custom-copy",
    `${safeSegment(route.smartlingSourceLocale)}_${safeSegment(route.smartlingTargetLocale)}`,
    safeSegment(jobName || requestId),
    `${safeSegment(requestId)}.json`
  ].join("/");
}

function latestTranslationsFor(store, sku, targetLocale) {
  const latestByField = new Map();

  for (const translation of store.translations) {
    if (translation.sku !== sku || translation.targetLocale !== targetLocale) {
      continue;
    }

    const existing = latestByField.get(translation.fieldKey);
    if (!existing || existing.createdAt < translation.createdAt) {
      latestByField.set(translation.fieldKey, translation);
    }
  }

  return [...latestByField.values()].sort((a, b) =>
    a.fieldLabel.localeCompare(b.fieldLabel)
  );
}

function attachTranslationsToCustomRequests(store, requests) {
  const translationsByRequest = new Map();

  for (const translation of store.translations) {
    if (translation.requestType !== "custom") {
      continue;
    }
    const list = translationsByRequest.get(translation.requestId) || [];
    list.push(translation);
    translationsByRequest.set(translation.requestId, list);
  }

  return requests.map((request) => {
    const byField = new Map(
      (translationsByRequest.get(request.id) || []).map((translation) => [
        translation.fieldKey,
        translation
      ])
    );

    return {
      ...request,
      fields: (request.fields || []).map((field) => ({
        ...field,
        translatedText: byField.get(field.fieldKey)?.translatedText || field.translatedText || null
      }))
    };
  });
}

function mapDownloadedTranslations(request, translatedFile) {
  const translations = [];
  const createdAt = nowIso();

  for (const field of request.fields) {
    if (!field.sentToSmartling) {
      continue;
    }

    const smartlingKey = getSmartlingFieldKey(request, field);
    const translatedText = translatedFile?.[smartlingKey];

    if (translatedText == null || String(translatedText).trim() === "") {
      continue;
    }

    translations.push({
      id: `tx_${randomUUID()}`,
      requestId: request.id,
      createdAt,
      status: "staged",
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      requestType: request.requestType || "sku",
      country: request.country,
      targetCountry: request.targetCountry,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      smartlingProjectKey: request.smartlingProjectKey,
      fieldKey: field.fieldKey,
      fieldLabel: field.fieldLabel,
      sourceText: field.sourceText,
      sourceHash: field.sourceHash,
      translatedText: String(translatedText)
    });
  }

  return translations;
}

function getSmartlingFieldKey(request, field) {
  return field.smartlingKey || `sku.${request.sku}.${field.fieldKey}`;
}

async function handleCreateRequest(req, res) {
  const body = await readJsonBody(req);
  const sku = String(body.sku || "").trim();
  const country = String(body.country || body.sourceCountry || "").trim();
  const sourceLocale = String(body.sourceLocale || "").trim();
  const targetLocale = String(body.targetLocale || "").trim();
  const route = findRouteBySource(country, sourceLocale, targetLocale);
  const requestedJobName = String(body.jobName || "").trim();
  const requestedJobDueDate = normalizeJobDueDate(body.jobDueDate || body.dueDate);
  const authorizeJob = body.authorizeJob === true;

  if (!sku) {
    return sendError(res, 400, "Missing SKU.");
  }

  if (!route) {
    return sendError(res, 400, "No translation route is configured for this source culture.", {
      country,
      sourceLocale,
      targetLocale,
      configuredRoutes: ROUTES
    });
  }

  const jobName = requestedJobName || buildJobName(route, sku);

  if (!requestedJobDueDate) {
    return sendError(res, 400, "Missing or invalid job due date.");
  }

  const fields = normalizeFields(body.fields).map((field) => {
    const text = field.sourceText;
    const trimmed = text.trim();
    return {
      ...field,
      sourceHash: sourceHash(text),
      emptySource: trimmed.length === 0,
      sentToSmartling: trimmed.length > 0
    };
  });

  if (!fields.length) {
    return sendError(res, 400, "Select at least one field before submitting to Smartling.");
  }

  if (!fields.some((field) => field.sentToSmartling)) {
    return sendError(res, 400, "At least one selected field must have source text.");
  }

  const requestId = `tr_${randomUUID()}`;
  const request = {
    id: requestId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "stored_waiting_for_smartling",
    sku,
    country: route.cmsCountry,
    sourceLocale: route.sourceCmsLocale,
    targetCountry: route.targetCmsCountry,
    targetLocale: route.targetCmsLocale,
    smartlingProjectKey: route.smartlingProjectKey,
    smartlingSourceLocale: route.smartlingSourceLocale,
    smartlingTargetLocale: route.smartlingTargetLocale,
    jobName,
    jobDueDate: requestedJobDueDate,
    authorizeJob,
    fileUri: buildFileUri(route, sku, requestId),
    fields
  };

  await submitRequestToSmartling(request);

  const store = await loadStore();
  store.requests.push(request);
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt: nowIso(),
    type: "translation_request_created",
    requestId: request.id,
    sku,
    targetLocale: request.targetLocale,
    status: request.status,
    smartlingMode: request.smartling?.mode || null
  });
  await saveStore(store);

  return sendJson(res, 201, {
    request
  });
}

async function handleCreateCustomRequest(req, res) {
  const body = await readJsonBody(req);
  const sourceLocale = String(body.sourceLocale || "").trim();
  const targetLocale = String(body.targetLocale || "").trim();
  const route = findRouteBySource(null, sourceLocale, targetLocale);
  const requestedJobName = String(body.jobName || "").trim();
  const requestedJobDueDate = normalizeJobDueDate(body.jobDueDate || body.dueDate);
  const jobDescription = normalizeOptionalText(
    body.jobDescription || body.description || body.additionalDetails
  );
  const referenceNumber = normalizeOptionalText(body.referenceNumber || body.jobReferenceNumber);
  const authorizeJob = body.authorizeJob === true;

  if (!route) {
    return sendError(res, 400, "No translation route is configured for this custom request.", {
      sourceLocale,
      targetLocale,
      configuredRoutes: ROUTES
    });
  }

  const jobName = requestedJobName || `${formatCompactDate()}-Custom`;

  if (!requestedJobDueDate) {
    return sendError(res, 400, "Missing or invalid job due date.");
  }

  if (jobDescription.length > MAX_SMARTLING_JOB_DESCRIPTION_LENGTH) {
    return sendError(
      res,
      400,
      `Additional details must be ${MAX_SMARTLING_JOB_DESCRIPTION_LENGTH} characters or fewer.`
    );
  }

  const requestId = `tr_${randomUUID()}`;
  const customJobKey = safeSegment(jobName || requestId);
  const fields = normalizeCustomFields(body.fields || body.strings).map((field) => {
    const text = field.sourceText;
    const trimmed = text.trim();
    return {
      ...field,
      smartlingKey: `custom.${customJobKey}.${field.fieldKey}`,
      sourceHash: sourceHash(text),
      emptySource: trimmed.length === 0,
      sentToSmartling: trimmed.length > 0
    };
  });

  if (!fields.length) {
    return sendError(res, 400, "Add at least one string before submitting to Smartling.");
  }

  if (!fields.some((field) => field.sentToSmartling)) {
    return sendError(res, 400, "At least one custom string must have source text.");
  }

  const request = {
    id: requestId,
    requestType: "custom",
    customJobKey,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "stored_waiting_for_smartling",
    sku: null,
    country: route.cmsCountry,
    sourceLocale: route.sourceCmsLocale,
    targetCountry: route.targetCmsCountry,
    targetLocale: route.targetCmsLocale,
    smartlingProjectKey: route.smartlingProjectKey,
    smartlingSourceLocale: route.smartlingSourceLocale,
    smartlingTargetLocale: route.smartlingTargetLocale,
    jobName,
    jobDueDate: requestedJobDueDate,
    jobDescription,
    referenceNumber,
    authorizeJob,
    fileUri: buildCustomFileUri(route, jobName, requestId),
    fields
  };

  await submitRequestToSmartling(request);

  const store = await loadStore();
  store.requests.push(request);
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt: nowIso(),
    type: "custom_translation_request_created",
    requestId: request.id,
    customJobKey,
    targetLocale: request.targetLocale,
    status: request.status,
    smartlingMode: request.smartling?.mode || null
  });
  await saveStore(store);

  return sendJson(res, 201, {
    request
  });
}

async function handleImportCustomWorkbook(req, res) {
  const workbook = await readBinaryBody(req);

  if (!workbook.length) {
    return sendError(res, 400, "Upload an XLSX file before importing strings.");
  }

  const importResult = parseCustomJobWorkbook(workbook);

  if (!importResult.fields.length) {
    return sendError(
      res,
      400,
      "No source strings were found. Use the template columns Custom label and Source string."
    );
  }

  return sendJson(res, 200, importResult);
}

async function submitRequestToSmartling(request) {
  try {
    const smartling = await createSmartlingJob(request);
    request.smartling = smartling;
    request.updatedAt = nowIso();

    if (smartling.mode === "submitted") {
      request.status = "submitted_to_smartling";
      return;
    }

    if (smartling.mode === "not_configured") {
      request.status = "stored_waiting_for_smartling";
      return;
    }

    if (smartling.mode === "config_error" || smartling.mode === "validation_error") {
      request.status = "smartling_error";
      return;
    }

    request.status = "stored_waiting_for_smartling";
  } catch (error) {
    request.updatedAt = nowIso();
    request.status = "smartling_error";
    request.smartling = normalizeSmartlingError(error);
  }
}

function normalizeSmartlingError(error) {
  return {
    mode: "error",
    name: error.name || "Error",
    message: error.message || "Smartling submission failed.",
    details: error.details || null,
    failedAt: nowIso()
  };
}

async function handleRetrySmartlingSubmission(res, requestId) {
  const store = await loadStore();
  const request = store.requests.find((candidate) => candidate.id === requestId);

  if (!request) {
    return sendError(res, 404, "Translation request was not found.");
  }

  await submitRequestToSmartling(request);
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt: nowIso(),
    type: "translation_request_smartling_retry",
    requestId: request.id,
    sku: request.sku,
    targetLocale: request.targetLocale,
    status: request.status,
    smartlingMode: request.smartling?.mode || null
  });
  await saveStore(store);

  return sendJson(res, 200, {
    request
  });
}

async function handleCheckSmartlingSubmission(res, requestId) {
  const store = await loadStore();
  const request = store.requests.find((candidate) => candidate.id === requestId);

  if (!request) {
    return sendError(res, 404, "Translation request was not found.");
  }

  return sendJson(res, 200, {
    request
  });
}

async function handleImportSmartlingTranslations(res, requestId) {
  const store = await loadStore();
  const request = store.requests.find((candidate) => candidate.id === requestId);

  if (!request) {
    return sendError(res, 404, "Translation request was not found.");
  }

  const result = await syncSmartlingRequest(store, request, {
    force: true,
    markErrors: true,
    reason: "manual"
  });
  await saveStore(store);

  return sendJson(res, 200, {
    request,
    translations: result.translations || []
  });
}

async function handleSyncSmartlingRequests(req, res, url) {
  const body = await readJsonBody(req);
  const result = await runSmartlingSync({
    force:
      body.force === true ||
      url.searchParams.get("force") === "true" ||
      url.searchParams.get("force") === "1",
    reason: body.reason || "manual",
    requestId: String(body.requestId || url.searchParams.get("requestId") || "").trim(),
    sku: String(body.sku || url.searchParams.get("sku") || "").trim()
  });

  return sendJson(res, 200, result);
}

async function handleSyncSingleSmartlingRequest(req, res, requestId) {
  const body = await readJsonBody(req);
  const store = await loadStore();
  const request = store.requests.find((candidate) => candidate.id === requestId);

  if (!request) {
    return sendError(res, 404, "Translation request was not found.");
  }

  const result = await syncSmartlingRequest(store, request, {
    force: body.force !== false,
    markErrors: true,
    reason: body.reason || "manual"
  });
  await saveStore(store);

  return sendJson(res, 200, {
    request,
    translations: result.translations || [],
    sync: result
  });
}

async function runSmartlingSync(options = {}) {
  const store = await loadStore();
  const config = getSmartlingSyncConfig();
  const summary = {
    enabled: config.enabled,
    checked: 0,
    skipped: 0,
    imported: 0,
    cancelled: 0,
    errors: 0,
    notReady: 0,
    startedAt: nowIso(),
    finishedAt: null
  };

  if (!config.enabled) {
    summary.finishedAt = nowIso();
    summary.message = env.SMARTLING_ENABLED === "true"
      ? "Smartling sync is disabled by configuration."
      : "Smartling sync is disabled because Smartling API calls are disabled.";
    return {
      summary,
      requests: []
    };
  }

  const requests = store.requests.filter((request) =>
    shouldConsiderRequestForSync(request, options, config)
  );
  const syncedRequests = [];

  for (const request of requests) {
    if (!shouldRunRequestSync(request, options, config)) {
      summary.skipped += 1;
      continue;
    }

    const result = await syncSmartlingRequest(store, request, {
      force: options.force === true,
      markErrors: options.markErrors === true,
      reason: options.reason || "scheduled"
    });
    syncedRequests.push(request);
    summary.checked += 1;

    if (result.status === "cancelled") summary.cancelled += 1;
    if (result.status === "translations_available") summary.imported += 1;
    if (result.status === "not_ready") summary.notReady += 1;
    if (result.status === "error") summary.errors += 1;
  }

  if (summary.checked > 0) {
    await saveStore(store);
  }

  summary.finishedAt = nowIso();
  summary.message = buildSmartlingSyncSummaryMessage(summary);

  return {
    summary,
    requests: syncedRequests
  };
}

function shouldConsiderRequestForSync(request, options, config) {
  if (!request || !SYNCABLE_REQUEST_STATUSES.has(request.status)) {
    return false;
  }

  if (options.requestId && request.id !== options.requestId) {
    return false;
  }

  if (options.sku && request.sku !== options.sku) {
    return false;
  }

  if (!request.fileUri && !request.smartling?.translationJobUid) {
    return false;
  }

  if (options.force === true || options.requestId) {
    return true;
  }

  return isWithinSyncLookback(request, config);
}

function shouldRunRequestSync(request, options, config) {
  if (options.force === true || options.requestId) {
    return true;
  }

  const lastCheckedAt = new Date(request.smartlingSync?.lastCheckedAt || "");
  if (Number.isNaN(lastCheckedAt.getTime())) {
    return true;
  }

  const elapsedMs = Date.now() - lastCheckedAt.getTime();
  return elapsedMs >= config.minCheckIntervalMinutes * 60 * 1000;
}

function isWithinSyncLookback(request, config) {
  if (config.lookbackDays === 0) {
    return true;
  }

  const createdAt = new Date(request.createdAt || "");
  if (Number.isNaN(createdAt.getTime())) {
    return true;
  }

  return Date.now() - createdAt.getTime() <= config.lookbackDays * 24 * 60 * 60 * 1000;
}

async function syncSmartlingRequest(store, request, options = {}) {
  const checkedAt = nowIso();
  request.smartlingSync = {
    ...(request.smartlingSync || {}),
    lastCheckedAt: checkedAt,
    lastReason: options.reason || "manual"
  };

  const statusResult = await syncSmartlingJobStatus(store, request, checkedAt);
  if (statusResult.status === "cancelled") {
    return statusResult;
  }

  return await importSmartlingTranslationsForRequest(store, request, {
    checkedAt,
    markErrors: options.markErrors === true,
    reason: options.reason || "manual"
  });
}

async function syncSmartlingJobStatus(store, request, checkedAt) {
  if (!request.smartling?.translationJobUid) {
    return {
      status: "skipped",
      reason: "missing_translation_job_uid",
      translations: []
    };
  }

  try {
    const jobStatus = await getSmartlingJobStatus(request);
    request.smartlingJobStatus = summarizeSmartlingJobStatus(jobStatus);
    request.smartlingSync.lastJobStatus = request.smartlingJobStatus.jobStatus || null;

    if (request.smartling && request.smartlingJobStatus.jobStatus) {
      request.smartling.jobStatus = request.smartlingJobStatus.jobStatus;
    }

    if (SMARTLING_CANCELLED_STATUSES.has(request.smartlingJobStatus.jobStatus)) {
      markRequestCancelled(store, request, request.smartlingJobStatus, checkedAt);
      return {
        status: "cancelled",
        translations: []
      };
    }
  } catch (error) {
    const normalizedError = normalizeSmartlingError(error);
    request.smartlingJobStatus = {
      ...normalizedError,
      mode: "status_error",
      checkedAt
    };
    request.smartlingSync.lastError = request.smartlingJobStatus;
  }

  return {
    status: "checked",
    translations: []
  };
}

function summarizeSmartlingJobStatus(jobStatus) {
  return {
    mode: jobStatus.mode,
    projectId: jobStatus.projectId || null,
    translationJobUid: jobStatus.translationJobUid || null,
    jobStatus: jobStatus.jobStatus || null,
    checkedAt: jobStatus.checkedAt || nowIso(),
    message: jobStatus.message || null
  };
}

function markRequestCancelled(store, request, jobStatus, cancelledAt) {
  request.status = "cancelled";
  request.updatedAt = cancelledAt;
  request.import = {
    mode: "cancelled",
    jobStatus: jobStatus.jobStatus || null,
    checkedAt: cancelledAt,
    message:
      jobStatus.jobStatus === "DELETED"
        ? "Smartling job was deleted. Translations were not imported."
        : "Smartling job was cancelled. Translations were not imported."
  };
  request.smartlingSync.lastResult = "cancelled";
  store.translations = store.translations.filter(
    (translation) => translation.requestId !== request.id
  );
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt: cancelledAt,
    type: "translation_request_cancelled",
    requestId: request.id,
    sku: request.sku,
    customJobKey: request.customJobKey || null,
    targetLocale: request.targetLocale,
    smartlingJobStatus: jobStatus.jobStatus || null
  });
}

async function importSmartlingTranslationsForRequest(
  store,
  request,
  { checkedAt = nowIso(), markErrors = true, reason = "manual" } = {}
) {
  try {
    const download = await downloadPublishedTranslations(request);

    if (download.mode !== "downloaded") {
      request.import = download;
      request.updatedAt = checkedAt;
      request.smartlingSync.lastResult = download.mode;
      if (["config_error", "validation_error"].includes(download.mode)) {
        if (markErrors) {
          request.status = "smartling_error";
        }
      } else if (download.mode === "not_ready") {
        request.status = "submitted_to_smartling";
        store.translations = store.translations.filter(
          (translation) => translation.requestId !== request.id
        );
        return {
          status: "not_ready",
          translations: []
        };
      }
      return {
        status: ["config_error", "validation_error"].includes(download.mode) ? "error" : download.mode,
        translations: []
      };
    }

    const translations = mapDownloadedTranslations(request, download.translatedFile);

    if (!translations.length) {
      request.status = "smartling_error";
      request.import = {
        ...download,
        translatedFile: undefined,
        message:
          "Published file was downloaded, but no translated values matched this request's field keys."
      };
      request.updatedAt = checkedAt;
      request.smartlingSync.lastResult = "empty_download";
      store.events.push({
        id: `evt_${randomUUID()}`,
        createdAt: checkedAt,
        type: "translation_import_empty",
        requestId: request.id,
        sku: request.sku,
        customJobKey: request.customJobKey || null,
        targetLocale: request.targetLocale
      });
      return {
        status: "error",
        translations: []
      };
    }

    store.translations = store.translations.filter(
      (translation) => translation.requestId !== request.id
    );
    store.translations.push(...translations);
    request.status = "translations_available";
    request.import = {
      mode: download.mode,
      projectId: download.projectId,
      fileUri: download.fileUri,
      targetLocale: download.targetLocale,
      downloadedAt: download.downloadedAt,
      translationCount: translations.length,
      message: download.message
    };
    request.updatedAt = checkedAt;
    request.smartlingSync.lastResult = "downloaded";
    store.events.push({
      id: `evt_${randomUUID()}`,
      createdAt: checkedAt,
      type: reason === "scheduled" ? "translations_auto_imported" : "translations_imported",
      requestId: request.id,
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      targetLocale: request.targetLocale,
      translationCount: translations.length
    });

    return {
      status: "translations_available",
      translations
    };
  } catch (error) {
    const normalizedError = normalizeSmartlingError(error);
    request.import = normalizedError;
    request.updatedAt = checkedAt;
    request.smartlingSync.lastResult = "error";
    request.smartlingSync.lastError = normalizedError;

    if (markErrors) {
      request.status = "smartling_error";
      store.events.push({
        id: `evt_${randomUUID()}`,
        createdAt: checkedAt,
        type: "translation_import_error",
        requestId: request.id,
        sku: request.sku,
        customJobKey: request.customJobKey || null,
        targetLocale: request.targetLocale,
        message: error.message
      });
    }

    return {
      status: "error",
      translations: []
    };
  }
}

function buildSmartlingSyncSummaryMessage(summary) {
  if (!summary.enabled) {
    return summary.message || "Smartling sync is disabled.";
  }

  if (!summary.checked) {
    return summary.skipped
      ? "Active Smartling jobs were checked recently."
      : "No active Smartling jobs needed syncing.";
  }

  const parts = [`${summary.checked} checked`];
  if (summary.imported) parts.push(`${summary.imported} ready`);
  if (summary.cancelled) parts.push(`${summary.cancelled} cancelled`);
  if (summary.notReady) parts.push(`${summary.notReady} not ready`);
  if (summary.errors) parts.push(`${summary.errors} error${summary.errors === 1 ? "" : "s"}`);
  return parts.join(", ");
}

async function handleMockPublish(req, res, requestId) {
  const body = await readJsonBody(req);
  const store = await loadStore();
  const request = store.requests.find((candidate) => candidate.id === requestId);

  if (!request) {
    return sendError(res, 404, "Translation request was not found.");
  }

  const suppliedFields = body.fields && typeof body.fields === "object" ? body.fields : {};
  const publishedAt = nowIso();
  const translations = [];

  for (const field of request.fields) {
    if (field.emptySource && suppliedFields[field.fieldKey] == null) {
      continue;
    }

    const translatedText =
      suppliedFields[field.fieldKey] == null
        ? `[${request.targetLocale}] ${field.sourceText}`
        : String(suppliedFields[field.fieldKey]);

    translations.push({
      id: `tx_${randomUUID()}`,
      requestId: request.id,
      createdAt: publishedAt,
      status: "published",
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      requestType: request.requestType || "sku",
      country: request.country,
      targetCountry: request.targetCountry,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      smartlingProjectKey: request.smartlingProjectKey,
      fieldKey: field.fieldKey,
      fieldLabel: field.fieldLabel,
      sourceText: field.sourceText,
      sourceHash: field.sourceHash,
      translatedText
    });
  }

  store.translations = store.translations.filter(
    (translation) => translation.requestId !== request.id
  );
  store.translations.push(...translations);
  request.status = "published";
  request.updatedAt = publishedAt;
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt: publishedAt,
    type: "mock_translation_published",
    requestId: request.id,
    sku: request.sku,
    targetLocale: request.targetLocale,
    translationCount: translations.length
  });
  await saveStore(store);

  return sendJson(res, 200, {
    request,
    translations
  });
}

async function handleStageTranslations(req, res) {
  const body = await readJsonBody(req);
  const sku = String(body.sku || "").trim();
  const targetLocale = String(body.targetLocale || "").trim();
  const route = findRouteByTarget(targetLocale);

  if (!sku || !targetLocale || !route) {
    return sendError(res, 400, "SKU and a configured targetLocale are required.");
  }

  const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
  const createdAt = nowIso();
  const translations = [];

  for (const [fieldKey, config] of Object.entries(FIELD_CONFIG)) {
    if (fields[fieldKey] == null || String(fields[fieldKey]).trim() === "") {
      continue;
    }

    translations.push({
      id: `tx_${randomUUID()}`,
      requestId: body.requestId || null,
      createdAt,
      status: "staged",
      sku,
      country: route.cmsCountry,
      targetCountry: route.targetCmsCountry,
      sourceLocale: route.sourceCmsLocale,
      targetLocale: route.targetCmsLocale,
      smartlingProjectKey: route.smartlingProjectKey,
      fieldKey,
      fieldLabel: config.label,
      sourceText: body.sourceTextByField?.[fieldKey] || "",
      sourceHash: body.sourceTextByField?.[fieldKey]
        ? sourceHash(body.sourceTextByField[fieldKey])
        : null,
      translatedText: String(fields[fieldKey])
    });
  }

  const store = await loadStore();
  store.translations.push(...translations);
  store.events.push({
    id: `evt_${randomUUID()}`,
    createdAt,
    type: "translations_staged",
    sku,
    targetLocale,
    translationCount: translations.length
  });
  await saveStore(store);

  return sendJson(res, 201, {
    translations
  });
}

async function handleEvent(req, res) {
  const body = await readJsonBody(req);
  const store = await loadStore();
  const event = {
    id: `evt_${randomUUID()}`,
    createdAt: nowIso(),
    type: body.type || "extension_event",
    ...body
  };
  store.events.push(event);
  await saveStore(store);
  return sendJson(res, 201, {
    event
  });
}

async function handleRequest(req, res) {
  const corsHeaders = getCorsHeadersForRequest(req);
  if (corsHeaders === null) {
    res.writeHead(403, {
      "Content-Type": "application/json; charset=utf-8"
    });
    res.end(
      JSON.stringify({
        error: {
          message: "Origin is not allowed.",
          details: null
        }
      })
    );
    return;
  }
  setCorsHeaders(res, corsHeaders);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (!isAuthorizedApiRequest(req, pathname)) {
      return sendError(res, 401, "Backend API token is required.");
    }

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "cms-smartling-connector",
        store: getStoreInfo(),
        time: nowIso()
      });
    }

    if (req.method === "GET" && pathname === "/api/config") {
      return sendJson(res, 200, {
        fields: FIELD_CONFIG,
        routes: ROUTES
      });
    }

    if (req.method === "GET" && pathname === "/api/smartling/status") {
      return sendJson(res, 200, {
        ...getSmartlingRuntimeStatus(),
        sync: getSmartlingSyncRuntimeStatus()
      });
    }

    if (req.method === "POST" && pathname === "/api/translation-requests/sync") {
      return await handleSyncSmartlingRequests(req, res, url);
    }

    if (req.method === "POST" && pathname === "/api/translation-requests") {
      return await handleCreateRequest(req, res);
    }

    if (req.method === "POST" && pathname === "/api/custom-translation-requests") {
      return await handleCreateCustomRequest(req, res);
    }

    if (req.method === "POST" && pathname === "/api/custom-translation-requests/import-xlsx") {
      return await handleImportCustomWorkbook(req, res);
    }

    if (req.method === "GET" && pathname === "/api/custom-translation-requests") {
      const store = await loadStore();
      const jobName = String(url.searchParams.get("jobName") || "").trim().toLowerCase();
      const requests = store.requests
        .filter((request) => request.requestType === "custom")
        .filter((request) => !jobName || String(request.jobName || "").toLowerCase().includes(jobName));

      return sendJson(res, 200, {
        requests: attachTranslationsToCustomRequests(store, requests)
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      });
    }

    if (req.method === "GET" && pathname === "/api/translation-requests") {
      const store = await loadStore();
      const sku = url.searchParams.get("sku");
      const requests = (sku
        ? store.requests.filter((request) => request.sku === sku)
        : store.requests
      ).filter((request) => request.requestType !== "custom");
      return sendJson(res, 200, {
        requests: requests
          .slice()
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      });
    }

    const translationRequestMatch = pathname.match(/^\/api\/translation-requests\/([^/]+)$/);
    if (req.method === "GET" && translationRequestMatch) {
      return await handleCheckSmartlingSubmission(res, translationRequestMatch[1]);
    }

    const syncSmartlingMatch = pathname.match(
      /^\/api\/translation-requests\/([^/]+)\/sync$/
    );
    if (req.method === "POST" && syncSmartlingMatch) {
      return await handleSyncSingleSmartlingRequest(req, res, syncSmartlingMatch[1]);
    }

    const retrySmartlingMatch = pathname.match(
      /^\/api\/translation-requests\/([^/]+)\/submit-to-smartling$/
    );
    if (req.method === "POST" && retrySmartlingMatch) {
      return await handleRetrySmartlingSubmission(res, retrySmartlingMatch[1]);
    }

    const importSmartlingMatch = pathname.match(
      /^\/api\/translation-requests\/([^/]+)\/import-translations$/
    );
    if (req.method === "POST" && importSmartlingMatch) {
      return await handleImportSmartlingTranslations(res, importSmartlingMatch[1]);
    }

    const mockPublishMatch = pathname.match(
      /^\/api\/translation-requests\/([^/]+)\/mock-publish$/
    );
    if (req.method === "POST" && mockPublishMatch) {
      return await handleMockPublish(req, res, mockPublishMatch[1]);
    }

    if (req.method === "POST" && pathname === "/api/translations/stage") {
      return await handleStageTranslations(req, res);
    }

    if (req.method === "GET" && pathname === "/api/translations") {
      const sku = String(url.searchParams.get("sku") || "").trim();
      const targetLocale = String(url.searchParams.get("targetLocale") || "").trim();

      if (!sku || !targetLocale) {
        return sendError(res, 400, "sku and targetLocale query parameters are required.");
      }

      const store = await loadStore();
      return sendJson(res, 200, {
        sku,
        targetLocale,
        route: findRouteByTarget(targetLocale),
        translations: latestTranslationsFor(store, sku, targetLocale)
      });
    }

    if (req.method === "POST" && pathname === "/api/events") {
      return await handleEvent(req, res);
    }

    return sendError(res, 404, "Route not found.");
  } catch (error) {
    return sendError(res, 500, "Unexpected server error.", {
      message: error.message
    });
  }
}

let smartlingSyncTimer = null;
let smartlingSyncInProgress = false;

function startSmartlingSyncScheduler() {
  const config = getSmartlingSyncConfig();

  if (!config.enabled) {
    console.log("Smartling status sync is disabled.");
    return;
  }

  smartlingSyncTimer = setInterval(() => {
    runScheduledSmartlingSync();
  }, config.intervalMs);
  smartlingSyncTimer.unref?.();

  console.log(
    `Smartling status sync enabled every ${config.intervalMinutes} minute${
      config.intervalMinutes === 1 ? "" : "s"
    }.`
  );
}

async function runScheduledSmartlingSync() {
  if (smartlingSyncInProgress) {
    console.warn("Smartling status sync skipped because a previous sync is still running.");
    return;
  }

  smartlingSyncInProgress = true;
  try {
    const result = await runSmartlingSync({
      reason: "scheduled"
    });
    console.log(`Smartling status sync finished: ${result.summary.message}`);
  } catch (error) {
    console.error(`Smartling status sync failed: ${error.message}`);
  } finally {
    smartlingSyncInProgress = false;
  }
}

const server = createServer(handleRequest);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use on ${HOST}. Stop the existing backend or start this one with a different port, for example: $env:PORT=17818; npm run backend`
    );
    globalThis.process?.exit?.(1);
    return;
  }

  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`CMS Smartling backend listening at http://${HOST}:${PORT}`);
  startSmartlingSyncScheduler();
});

export { server };
