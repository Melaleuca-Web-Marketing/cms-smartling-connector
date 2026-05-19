const SMARTLING_API_BASE_URL = "https://api.smartling.com";

export async function createSmartlingJob(request = {}) {
  const env = globalThis.process?.env ?? {};

  if (env.SMARTLING_ENABLED !== "true") {
    return {
      mode: "not_configured",
      message:
        "Smartling API calls are disabled. Set SMARTLING_ENABLED=true after credentials and project IDs are configured."
    };
  }

  const projectConfig = getProjectConfig(env, request);
  const missingConfig = getMissingProjectConfig(projectConfig);

  if (missingConfig.length) {
    return {
      mode: "config_error",
      projectId: projectConfig.projectId || null,
      hasProjectToken: Boolean(projectConfig.userIdentifier && projectConfig.userSecret),
      missingConfig,
      message: `Missing Smartling configuration: ${missingConfig.join(", ")}.`
    };
  }

  const auth = await authenticate(projectConfig);
  const fileUri = request.fileUri;
  const filePayload = buildSmartlingJsonPayload(request);
  const fileName = fileUri.split("/").pop() || "cms-product-copy.json";
  const targetLocale = request.smartlingTargetLocale || request.targetLocale;

  if (!Object.keys(filePayload).length) {
    return {
      mode: "validation_error",
      projectId: projectConfig.projectId,
      hasProjectToken: true,
      message: "No non-empty fields were available to send to Smartling."
    };
  }

  const job = await createJob(projectConfig.projectId, auth.accessToken, request);
  const batch = await createBatch(projectConfig.projectId, auth.accessToken, {
    translationJobUid: job.translationJobUid,
    authorize: request.authorizeJob === true,
    fileUri
  });

  const upload = await uploadFileToBatch(projectConfig.projectId, auth.accessToken, {
    batchUid: batch.batchUid,
    fileUri,
    fileName,
    filePayload,
    targetLocale
  });

  const batchStatus = await getBatchStatus(
    projectConfig.projectId,
    auth.accessToken,
    batch.batchUid
  ).catch((error) => ({
    error: sanitizeError(error)
  }));

  return {
    mode: "submitted",
    projectId: projectConfig.projectId,
    hasProjectToken: true,
    authorizeJob: request.authorizeJob === true,
    dueDate: request.jobDueDate || request.dueDate || null,
    translationJobUid: job.translationJobUid,
    batchUid: batch.batchUid,
    fileUri,
    fileType: "json",
    targetLocale,
    uploadStatus: upload.status,
    batchStatus,
    sentAt: new Date().toISOString(),
    message: request.authorizeJob
      ? "Smartling job batch submitted and marked for authorization."
      : "Smartling job batch submitted and awaiting manual authorization."
  };
}

export async function downloadPublishedTranslations(request = {}) {
  const env = globalThis.process?.env ?? {};

  if (env.SMARTLING_ENABLED !== "true") {
    return {
      mode: "not_configured",
      message:
        "Smartling API calls are disabled. Set SMARTLING_ENABLED=true after credentials and project IDs are configured."
    };
  }

  const projectConfig = getProjectConfig(env, request);
  const missingConfig = getMissingProjectConfig(projectConfig);

  if (missingConfig.length) {
    return {
      mode: "config_error",
      projectId: projectConfig.projectId || null,
      hasProjectToken: Boolean(projectConfig.userIdentifier && projectConfig.userSecret),
      missingConfig,
      message: `Missing Smartling configuration: ${missingConfig.join(", ")}.`
    };
  }

  if (!request.fileUri) {
    return {
      mode: "validation_error",
      projectId: projectConfig.projectId,
      hasProjectToken: true,
      message: "Cannot import translations because the request does not have a Smartling fileUri."
    };
  }

  const auth = await authenticate(projectConfig);
  const targetLocale = request.smartlingTargetLocale || request.targetLocale;
  const fileStatus = await getFileLocaleStatus(projectConfig.projectId, auth.accessToken, {
    fileUri: request.fileUri,
    targetLocale
  });
  const readiness = evaluateFileReadiness(fileStatus);

  if (!readiness.ready) {
    return {
      mode: "not_ready",
      projectId: projectConfig.projectId,
      hasProjectToken: true,
      fileUri: request.fileUri,
      targetLocale,
      fileStatus,
      progressPercent: readiness.progressPercent,
      message: `Translations are not ready for import yet. Progress is ${readiness.progressPercent}%.`
    };
  }

  const translatedFile = await downloadTranslatedFile(projectConfig.projectId, auth.accessToken, {
    fileUri: request.fileUri,
    targetLocale
  });

  return {
    mode: "downloaded",
    projectId: projectConfig.projectId,
    hasProjectToken: true,
    fileUri: request.fileUri,
    targetLocale,
    downloadedAt: new Date().toISOString(),
    translatedFile,
    message: "Published translations downloaded from Smartling."
  };
}

export function getSmartlingRuntimeStatus() {
  const env = globalThis.process?.env ?? {};
  const projectKeys = ["US", "CA", "EU"];

  return {
    enabled: env.SMARTLING_ENABLED === "true",
    apiBaseUrl: SMARTLING_API_BASE_URL,
    adapter: "job-batches-v2",
    projects: Object.fromEntries(
      projectKeys.map((key) => {
        const prefix = `SMARTLING_${key}`;
        const config = {
          projectId: env[`${prefix}_PROJECT_ID`] || null,
          hasUserIdentifier: Boolean(env[`${prefix}_USER_IDENTIFIER`] || env.SMARTLING_USER_IDENTIFIER),
          hasUserSecret: Boolean(env[`${prefix}_USER_SECRET`] || env.SMARTLING_USER_SECRET),
          workflowId: env[`${prefix}_WORKFLOW_ID`] || null
        };

        return [key.toLowerCase(), config];
      })
    )
  };
}

function getProjectConfig(env, request = {}) {
  const isEuropeProject =
    request.smartlingProjectKey === "cms-product-copy-eu" ||
    request.sourceLocale === "en-IE";
  const isCanadaProject =
    request.smartlingProjectKey === "cms-product-copy-ca" ||
    request.targetLocale === "fr-CA";

  const prefix = isEuropeProject
    ? "SMARTLING_EU"
    : isCanadaProject
      ? "SMARTLING_CA"
      : "SMARTLING_US";

  return {
    projectId: env[`${prefix}_PROJECT_ID`],
    userIdentifier: env[`${prefix}_USER_IDENTIFIER`] || env.SMARTLING_USER_IDENTIFIER,
    userSecret: env[`${prefix}_USER_SECRET`] || env.SMARTLING_USER_SECRET,
    workflowId: env[`${prefix}_WORKFLOW_ID`]
  };
}

function getMissingProjectConfig(projectConfig) {
  return [
    ["projectId", projectConfig.projectId],
    ["userIdentifier", projectConfig.userIdentifier],
    ["userSecret", projectConfig.userSecret]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

async function authenticate(projectConfig) {
  const data = await smartlingJsonRequest("/auth-api/v2/authenticate", {
    method: "POST",
    body: {
      userIdentifier: projectConfig.userIdentifier,
      userSecret: projectConfig.userSecret
    }
  });

  const accessToken = data?.accessToken;
  if (!accessToken) {
    throw new SmartlingApiError("Smartling authentication succeeded but did not return an access token.", {
      endpoint: "/auth-api/v2/authenticate"
    });
  }

  return {
    accessToken
  };
}

async function createJob(projectId, accessToken, request) {
  const body = {
    jobName: request.jobName
  };

  if (request.jobDueDate || request.dueDate) {
    body.dueDate = request.jobDueDate || request.dueDate;
  }

  const data = await smartlingJsonRequest(`/jobs-api/v3/projects/${projectId}/jobs`, {
    method: "POST",
    accessToken,
    body
  });

  const translationJobUid = data?.translationJobUid;
  if (!translationJobUid) {
    throw new SmartlingApiError("Smartling create job response did not include translationJobUid.", {
      endpoint: `/jobs-api/v3/projects/${projectId}/jobs`,
      data
    });
  }

  return {
    translationJobUid,
    raw: data
  };
}

async function createBatch(projectId, accessToken, { translationJobUid, authorize, fileUri }) {
  const data = await smartlingJsonRequest(`/job-batches-api/v2/projects/${projectId}/batches`, {
    method: "POST",
    accessToken,
    body: {
      authorize,
      translationJobUid,
      fileUris: [fileUri]
    }
  });

  const batchUid = data?.batchUid;
  if (!batchUid) {
    throw new SmartlingApiError("Smartling create batch response did not include batchUid.", {
      endpoint: `/job-batches-api/v2/projects/${projectId}/batches`,
      data
    });
  }

  return {
    batchUid,
    raw: data
  };
}

async function uploadFileToBatch(
  projectId,
  accessToken,
  { batchUid, fileUri, fileName, filePayload, targetLocale }
) {
  const formData = new FormData();
  const json = `${JSON.stringify(filePayload, null, 2)}\n`;

  formData.append("fileUri", fileUri);
  formData.append("fileType", "json");
  formData.append("localeIdsToAuthorize[]", targetLocale);
  formData.append("file", new Blob([json], { type: "application/json" }), fileName);

  const response = await fetch(
    `${SMARTLING_API_BASE_URL}/job-batches-api/v2/projects/${projectId}/batches/${batchUid}/file`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: formData
    }
  );

  const body = await parseResponseBody(response);
  if (!response.ok && response.status !== 202) {
    throw buildSmartlingError(response, body, {
      endpoint: `/job-batches-api/v2/projects/${projectId}/batches/${batchUid}/file`
    });
  }

  return {
    status: response.status,
    data: body?.response?.data || body
  };
}

async function getBatchStatus(projectId, accessToken, batchUid) {
  return await smartlingJsonRequest(
    `/job-batches-api/v2/projects/${projectId}/batches/${batchUid}`,
    {
      method: "GET",
      accessToken
    }
  );
}

async function getFileLocaleStatus(projectId, accessToken, { fileUri, targetLocale }) {
  const url = new URL(
    `${SMARTLING_API_BASE_URL}/files-api/v2/projects/${projectId}/locales/${targetLocale}/file/status`
  );
  url.searchParams.set("fileUri", fileUri);

  return await smartlingJsonRequest(url.pathname + url.search, {
    method: "GET",
    accessToken
  });
}

function evaluateFileReadiness(fileStatus) {
  const total = getStatusMetric(fileStatus, "totalStringCount");
  const completed = getStatusMetric(fileStatus, "completedStringCount");
  const excluded = getStatusMetric(fileStatus, "excludedStringCount");

  if (!Number.isFinite(total) || total <= 0) {
    return {
      ready: false,
      progressPercent: 0
    };
  }

  const translatableTotal = Math.max(total - (Number.isFinite(excluded) ? excluded : 0), 0);
  const progress = translatableTotal === 0 ? 100 : (completed / translatableTotal) * 100;
  const progressPercent = Math.max(0, Math.min(100, Math.floor(progress)));

  return {
    ready: progressPercent >= 100,
    progressPercent
  };
}

function getStatusMetric(value, key) {
  if (!value || typeof value !== "object") {
    return Number.NaN;
  }

  if (Number.isFinite(Number(value[key]))) {
    return Number(value[key]);
  }

  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") continue;
    const found = getStatusMetric(child, key);
    if (Number.isFinite(found)) {
      return found;
    }
  }

  return Number.NaN;
}

async function downloadTranslatedFile(projectId, accessToken, { fileUri, targetLocale }) {
  const url = new URL(
    `${SMARTLING_API_BASE_URL}/files-api/v2/projects/${projectId}/locales/${targetLocale}/file`
  );
  url.searchParams.set("fileUri", fileUri);
  url.searchParams.set("retrievalType", "published");
  url.searchParams.set("includeOriginalStrings", "false");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = {
        raw: text
      };
    }

    throw buildSmartlingError(response, body, {
      endpoint: `/files-api/v2/projects/${projectId}/locales/${targetLocale}/file`,
      fileUri,
      targetLocale
    });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SmartlingApiError("Smartling returned a translated file that is not valid JSON.", {
      fileUri,
      targetLocale,
      parseError: error.message,
      sample: text.slice(0, 500)
    });
  }
}

async function smartlingJsonRequest(endpoint, { method, accessToken = null, body = null }) {
  const response = await fetch(`${SMARTLING_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: body == null ? undefined : JSON.stringify(body)
  });

  const responseBody = await parseResponseBody(response);

  if (!response.ok) {
    throw buildSmartlingError(response, responseBody, { endpoint });
  }

  return responseBody?.response?.data || responseBody;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text
    };
  }
}

function buildSmartlingJsonPayload(request) {
  return Object.fromEntries(
    request.fields
      .filter((field) => field.sentToSmartling && field.sourceText.trim())
      .map((field) => [`sku.${request.sku}.${field.fieldKey}`, field.sourceText])
  );
}

function buildSmartlingError(response, body, details = {}) {
  const apiErrors = body?.response?.errors || body?.errors || [];
  const message =
    apiErrors.map((error) => error.message).filter(Boolean).join("; ") ||
    body?.message ||
    body?.raw ||
    `Smartling API request failed with HTTP ${response.status}.`;

  return new SmartlingApiError(message, {
    ...details,
    status: response.status,
    code: body?.response?.code || body?.code || null,
    errors: apiErrors,
    raw: body?.raw ? body.raw.slice(0, 1000) : undefined
  });
}

function sanitizeError(error) {
  return {
    name: error.name,
    message: error.message,
    details: error.details || null
  };
}

export class SmartlingApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SmartlingApiError";
    this.details = details;
  }
}
