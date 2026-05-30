import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  createSmartlingJob,
  downloadPublishedTranslations,
  getSmartlingRuntimeStatus
} from "./smartlingAdapter.mjs";
import { getStoreInfo, loadStore, saveStore } from "./store.mjs";
import { parseCustomJobWorkbook } from "./xlsxImport.mjs";

const env = globalThis.process?.env ?? {};
const PORT = Number(env.PORT || 17817);
const HOST = env.HOST || "127.0.0.1";
const MAX_SMARTLING_JOB_DESCRIPTION_LENGTH = 8000;

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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  const importedAt = nowIso();

  try {
    const download = await downloadPublishedTranslations(request);

    if (download.mode !== "downloaded") {
      request.import = download;
      request.updatedAt = importedAt;
      if (["config_error", "validation_error"].includes(download.mode)) {
        request.status = "smartling_error";
      } else if (download.mode === "not_ready") {
        request.status = "submitted_to_smartling";
        store.translations = store.translations.filter(
          (translation) => translation.requestId !== request.id
        );
      }
      await saveStore(store);
      return sendJson(res, 200, {
        request,
        translations: []
      });
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
      request.updatedAt = importedAt;
    store.events.push({
      id: `evt_${randomUUID()}`,
      createdAt: importedAt,
      type: "translation_import_empty",
      requestId: request.id,
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      targetLocale: request.targetLocale
    });
      await saveStore(store);
      return sendJson(res, 200, {
        request,
        translations: []
      });
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
    request.updatedAt = importedAt;
    store.events.push({
      id: `evt_${randomUUID()}`,
      createdAt: importedAt,
      type: "translations_imported",
      requestId: request.id,
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      targetLocale: request.targetLocale,
      translationCount: translations.length
    });
    await saveStore(store);

    return sendJson(res, 200, {
      request,
      translations
    });
  } catch (error) {
    request.status = "smartling_error";
    request.import = normalizeSmartlingError(error);
    request.updatedAt = importedAt;
    store.events.push({
      id: `evt_${randomUUID()}`,
      createdAt: importedAt,
      type: "translation_import_error",
      requestId: request.id,
      sku: request.sku,
      customJobKey: request.customJobKey || null,
      targetLocale: request.targetLocale,
      message: error.message
    });
    await saveStore(store);

    return sendJson(res, 200, {
      request,
      translations: []
    });
  }
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
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
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
      return sendJson(res, 200, getSmartlingRuntimeStatus());
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
});

export { server };
