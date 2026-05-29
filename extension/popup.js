const DEFAULT_API_BASE_URL =
  "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";
const CUSTOM_DRAFT_STORAGE_KEY = "smartlingCustomJobDraft";
let draftSaveTimer = null;
let restoringDraft = false;

const input = document.getElementById("apiBaseUrl");
const statusElement = document.getElementById("status");
const backendState = document.getElementById("backendState");
const backendDetails = document.getElementById("backendDetails");
const smartlingSummary = document.getElementById("smartlingSummary");
const updateBanner = document.getElementById("updateBanner");
const customJobPrefix = document.getElementById("customJobPrefix");
const customJobName = document.getElementById("customJobName");
const customJobSuffix = document.getElementById("customJobSuffix");
const customProject = document.getElementById("customProject");
const customEuTargets = document.getElementById("customEuTargets");
const customDueDate = document.getElementById("customDueDate");
const customAuthorize = document.getElementById("customAuthorize");
const customStringList = document.getElementById("customStringList");
const customJobList = document.getElementById("customJobList");

chrome.storage.local.get(
  {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    [CUSTOM_DRAFT_STORAGE_KEY]: null,
  },
  (items) => {
    input.value = items.apiBaseUrl || DEFAULT_API_BASE_URL;
    initCustomJobForm(items[CUSTOM_DRAFT_STORAGE_KEY]);
    checkForExtensionUpdates();
  },
);

wireTabs();

document.getElementById("save").addEventListener("click", () => {
  const apiBaseUrl = getApiBaseUrl();
  chrome.storage.local.set({ apiBaseUrl }, () => {
    input.value = apiBaseUrl;
    setBackendState(
      "muted",
      "Not tested",
      "Backend URL saved. Test the connection when ready.",
    );
    setStatus("Saved backend URL.", "success");
    checkForExtensionUpdates();
  });
});

document.getElementById("test").addEventListener("click", testBackend);
document
  .getElementById("checkSmartling")
  .addEventListener("click", checkSmartlingConfig);
document
  .getElementById("resetPanel")
  .addEventListener("click", resetPanelState);
document
  .getElementById("addCustomString")
  .addEventListener("click", () => addCustomStringRow());
document
  .getElementById("submitCustomJob")
  .addEventListener("click", submitCustomJob);
document
  .getElementById("refreshCustomJobs")
  .addEventListener("click", loadCustomJobs);
document
  .getElementById("openBulkImport")
  .addEventListener("click", openBulkImportPage);
customProject.addEventListener("change", () => {
  const project = getSelectedProject();
  customDueDate.value = getDefaultDueDateLocalValue(project.sourceLocale);
  renderProjectTargetControls(project);
  scheduleCustomDraftSave();
});
customJobName.addEventListener("input", scheduleCustomDraftSave);
customJobSuffix.addEventListener("input", scheduleCustomDraftSave);
customDueDate.addEventListener("input", scheduleCustomDraftSave);
customAuthorize.addEventListener("change", scheduleCustomDraftSave);
document.querySelectorAll(".custom-target-check").forEach((inputElement) => {
  inputElement.addEventListener("change", scheduleCustomDraftSave);
});
customStringList.addEventListener("input", scheduleCustomDraftSave);

async function testBackend() {
  const apiBaseUrl = getApiBaseUrl();
  setBackendState("warning", "Testing", "Checking backend health...");
  setStatus("Testing backend...");

  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.json().catch(() => ({}));
    setBackendState(
      "success",
      "Connected",
      `${body.service || "Backend"} responded at ${formatTime(body.time)}.`,
    );
    setStatus("Backend is reachable.", "success");
  } catch (error) {
    setBackendState(
      "error",
      "Offline",
      `Backend test failed: ${error.message}`,
    );
    setStatus(`Backend test failed: ${error.message}`, "error");
  }
}

async function checkSmartlingConfig() {
  const apiBaseUrl = getApiBaseUrl();
  smartlingSummary.innerHTML =
    '<div class="empty-state">Checking Smartling configuration...</div>';
  setStatus("Checking Smartling configuration...");

  try {
    const response = await fetch(`${apiBaseUrl}/api/smartling/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const status = await response.json();
    renderSmartlingStatus(status);
    setStatus("Smartling configuration checked.", "success");
  } catch (error) {
    smartlingSummary.innerHTML = `<div class="empty-state">Config check failed: ${escapeHtml(
      error.message,
    )}</div>`;
    setStatus(`Smartling config check failed: ${error.message}`, "error");
  }
}

function resetPanelState() {
  chrome.storage.local.set(
    {
      smartlingPanelTheme: "light",
      smartlingRecentRequestsCollapsed: true,
    },
    () => {
      setStatus(
        "Panel state reset. Refresh the CMS page if it is already open.",
        "success",
      );
    },
  );
}

async function checkForExtensionUpdates() {
  if (!globalThis.SmartlingVersionCheck) {
    return;
  }

  try {
    renderUpdateBanner(await SmartlingVersionCheck.check(getApiBaseUrl()));
  } catch {
    renderUpdateBanner(null);
  }
}

function renderUpdateBanner(updateInfo) {
  if (!updateBanner) {
    return;
  }

  if (!updateInfo?.isUpdateAvailable) {
    updateBanner.hidden = true;
    updateBanner.innerHTML = "";
    return;
  }

  updateBanner.hidden = false;
  updateBanner.innerHTML = `
    <div>
      <strong>Update available</strong>
      <span>Version ${escapeHtml(updateInfo.latestVersion)} is available. You are using ${escapeHtml(
        updateInfo.currentVersion,
      )}.</span>
    </div>
    <a href="${escapeAttribute(
      updateInfo.downloadPageUrl,
    )}" target="_blank" rel="noopener noreferrer">Download update</a>
  `;
}

function wireTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) {
        return;
      }
      document.querySelectorAll(".tab-button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `tab-${tab}`);
      });
    });
  });
}

function openBulkImportPage() {
  const url = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL("bulk-import.html")
    : "bulk-import.html";
  if (globalThis.chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener");
}

function initCustomJobForm(draft = null) {
  restoringDraft = true;
  setDefaultCustomJobNameParts();
  customDueDate.value = getDefaultDueDateLocalValue(
    getSelectedProject().sourceLocale,
  );
  customAuthorize.checked = true;
  customStringList.innerHTML = "";

  if (draft) {
    restoreCustomDraft(draft);
  } else {
    renderProjectTargetControls(getSelectedProject());
    addCustomStringRow("", "");
  }

  restoringDraft = false;
  loadCustomJobs();
}

function addCustomStringRow(label = "", value = "") {
  const row = document.createElement("div");
  row.className = "custom-string-row";
  row.innerHTML = `
    <label>
      <span>Custom label</span>
      <input class="custom-string-label" type="text" placeholder="Custom label" value="${escapeAttribute(label)}">
    </label>
    <label>
      <span>Source string</span>
      <textarea class="custom-string-value" rows="3" placeholder="Text to translate">${escapeHtml(value)}</textarea>
    </label>
    <button class="text-button custom-remove" type="button">Remove</button>
  `;
  row.querySelector(".custom-remove").addEventListener("click", () => {
    if (customStringList.querySelectorAll(".custom-string-row").length === 1) {
      row.querySelector(".custom-string-label").value = "";
      row.querySelector(".custom-string-value").value = "";
      scheduleCustomDraftSave();
      return;
    }
    row.remove();
    scheduleCustomDraftSave();
  });
  customStringList.append(row);
  scheduleCustomDraftSave();
}

function restoreCustomDraft(draft) {
  customProject.value = draft.project || "us";
  customJobPrefix.value = formatCompactDate(new Date());
  customJobName.value = getDraftJobName(draft);
  customJobSuffix.value = draft.jobSuffix || "";
  customAuthorize.checked = draft.authorizeJob !== false;
  restoreEuTargets(draft.euTargets);
  renderProjectTargetControls(getSelectedProject());
  customDueDate.value =
    draft.jobDueDateLocal ||
    getDefaultDueDateLocalValue(getSelectedProject().sourceLocale);

  const strings =
    Array.isArray(draft.strings) && draft.strings.length
      ? draft.strings
      : [{ label: "", value: "" }];

  for (const string of strings) {
    addCustomStringRow(string.label || "", string.value || "");
  }
}

function restoreEuTargets(targets) {
  const selectedTargets = new Set(Array.isArray(targets) ? targets : []);

  document.querySelectorAll(".custom-target-check").forEach((inputElement) => {
    inputElement.checked = selectedTargets.size
      ? selectedTargets.has(inputElement.value)
      : true;
  });
}

function scheduleCustomDraftSave() {
  if (restoringDraft) {
    return;
  }

  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveCustomDraft, 150);
}

function saveCustomDraft() {
  chrome.storage.local.set({
    [CUSTOM_DRAFT_STORAGE_KEY]: getCustomDraft(),
  });
}

function clearCustomDraft() {
  clearTimeout(draftSaveTimer);
  chrome.storage.local.remove(CUSTOM_DRAFT_STORAGE_KEY);
}

function getCustomDraft() {
  return {
    savedAt: new Date().toISOString(),
    project: customProject.value,
    jobName: customJobName.value,
    jobSuffix: customJobSuffix.value,
    jobDueDateLocal: customDueDate.value,
    authorizeJob: customAuthorize.checked,
    euTargets: getSelectedEuTargetLocales(),
    strings: [...customStringList.querySelectorAll(".custom-string-row")].map(
      (row) => ({
        label: row.querySelector(".custom-string-label")?.value || "",
        value: row.querySelector(".custom-string-value")?.value || "",
      }),
    ),
  };
}

async function submitCustomJob() {
  const project = getSelectedProject();
  const routes = getSelectedCustomRoutes(project);
  const jobName = buildCustomJobName() || buildDefaultCustomJobName();
  const jobDueDate = toSmartlingDueDateIso(customDueDate.value);
  const fields = getCustomFields();

  if (!jobDueDate) {
    setStatus("Select a valid custom job due date.", "error");
    return;
  }

  if (!fields.length) {
    setStatus("Add at least one custom string before submitting.", "error");
    return;
  }

  if (!routes.length) {
    setStatus(
      "Select at least one target language before submitting.",
      "error",
    );
    return;
  }

  setStatus(
    routes.length === 1
      ? "Submitting custom job..."
      : `Submitting ${routes.length} custom jobs...`,
  );

  try {
    const responses = [];
    for (const route of routes) {
      responses.push(
        await apiFetch("/api/custom-translation-requests", {
          method: "POST",
          body: JSON.stringify({
            sourceLocale: route.sourceLocale,
            targetLocale: route.targetLocale,
            jobName,
            jobDueDate,
            authorizeJob: customAuthorize.checked,
            fields,
          }),
        }),
      );
    }

    setStatus(
      getMultiSubmitStatusMessage(
        responses.map((response) => response.request),
      ),
      "success",
    );
    setDefaultCustomJobNameParts();
    customDueDate.value = getDefaultDueDateLocalValue(project.sourceLocale);
    customStringList.innerHTML = "";
    addCustomStringRow("", "");
    clearCustomDraft();
    await loadCustomJobs();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function getCustomFields() {
  return [...customStringList.querySelectorAll(".custom-string-row")]
    .map((row, index) => ({
      label:
        row.querySelector(".custom-string-label")?.value.trim() ||
        `String ${index + 1}`,
      value: row.querySelector(".custom-string-value")?.value || "",
    }))
    .filter((field) => field.value.trim());
}

async function loadCustomJobs() {
  customJobList.innerHTML =
    '<div class="empty-state">Loading custom jobs...</div>';

  try {
    const response = await apiFetch("/api/custom-translation-requests");
    renderCustomJobs(response.requests || []);
  } catch (error) {
    customJobList.innerHTML = `<div class="empty-state">Could not load custom jobs: ${escapeHtml(
      error.message,
    )}</div>`;
  }
}

function renderCustomJobs(requests) {
  if (!requests.length) {
    customJobList.innerHTML =
      '<div class="empty-state">No custom jobs submitted yet.</div>';
    return;
  }

  customJobList.innerHTML = requests
    .slice(0, 8)
    .map(renderCustomJobItem)
    .join("");
  customJobList
    .querySelectorAll('[data-action="check-custom-job"]')
    .forEach((button) => {
      button.addEventListener("click", () =>
        checkCustomJob(button.dataset.requestId),
      );
    });
}

function renderCustomJobItem(request) {
  return `
    <div class="custom-job-item">
      <div class="custom-job-main">
        <span class="status-pill ${escapeAttribute(getRequestStatusClass(request))}">${escapeHtml(
          getRequestStatusLabel(request),
        )}</span>
        <span class="custom-job-locale">${escapeHtml(request.targetLocale || "unknown")}</span>
      </div>
      <div class="custom-job-name">${escapeHtml(request.jobName || request.id)}</div>
      <div class="project-details">${escapeHtml(formatDate(request.createdAt))}${
        request.smartling?.translationJobUid
          ? ` | Job ${escapeHtml(request.smartling.translationJobUid)}`
          : ""
      }</div>
      ${renderCustomTranslations(request)}
      ${
        request.status === "submitted_to_smartling"
          ? `<button class="secondary custom-check-button" type="button" data-action="check-custom-job" data-request-id="${escapeAttribute(
              request.id,
            )}">Check translations</button>`
          : ""
      }
    </div>
  `;
}

function renderCustomTranslations(request) {
  const translations =
    request.status === "translations_available" ? request.fields || [] : [];
  if (!translations.length) {
    const message = request.import?.message;
    return message
      ? `<div class="custom-job-note">${escapeHtml(message)}</div>`
      : "";
  }

  return `
    <div class="custom-translation-list">
      ${translations
        .filter((field) => field.sentToSmartling)
        .map(
          (field) => `
            <div class="custom-translation-item">
              <div class="custom-translation-label">${escapeHtml(field.fieldLabel)}</div>
              <div class="custom-translation-value">${escapeHtml(field.translatedText || "Imported; refresh job if value is missing.")}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

async function checkCustomJob(requestId) {
  setStatus("Checking custom job translations...");

  try {
    const response = await apiFetch(
      `/api/translation-requests/${encodeURIComponent(requestId)}/import-translations`,
      {
        method: "POST",
      },
    );

    const request = {
      ...response.request,
      fields: mergeFieldTranslations(
        response.request.fields,
        response.translations,
      ),
    };
    await loadCustomJobs();

    if (request.status === "translations_available") {
      setStatus(
        `Imported ${response.translations.length} custom translation${
          response.translations.length === 1 ? "" : "s"
        }.`,
        "success",
      );
    } else if (request.import?.mode === "not_ready") {
      setStatus(
        `Custom translations are not ready yet. Progress: ${request.import.progressPercent ?? 0}%.`,
      );
    } else {
      setStatus(
        request.import?.message || "Custom translations were not imported yet.",
        "error",
      );
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function mergeFieldTranslations(fields = [], translations = []) {
  const byKey = new Map(
    translations.map((translation) => [translation.fieldKey, translation]),
  );
  return fields.map((field) => ({
    ...field,
    translatedText:
      byKey.get(field.fieldKey)?.translatedText || field.translatedText,
  }));
}

function renderSmartlingStatus(status) {
  const projects = status.projects || {};
  const rows = [
    renderProjectRow("US", projects.us),
    renderProjectRow("CA", projects.ca),
    renderProjectRow("EU", projects.eu),
  ].join("");

  smartlingSummary.innerHTML = `
    <div class="config-overview">
      <div>
        <div class="project-key">API calls</div>
        <div class="project-details">${escapeHtml(status.adapter || "unknown adapter")}</div>
      </div>
      <span class="status-pill ${status.enabled ? "is-success" : "is-warning"}">${
        status.enabled ? "Enabled" : "Disabled"
      }</span>
    </div>
    ${rows}
  `;
}

function renderProjectRow(label, project = {}) {
  const configured = Boolean(
    project.projectId && project.hasUserIdentifier && project.hasUserSecret,
  );
  const tokenText =
    project.hasUserIdentifier && project.hasUserSecret
      ? "token present"
      : "token incomplete";
  const workflowText = project.workflowId
    ? "workflow set"
    : "workflow optional";

  return `
    <div class="project-row">
      <div class="project-key">${escapeHtml(label)}</div>
      <div class="project-details">${escapeHtml(
        project.projectId
          ? `${project.projectId} | ${tokenText} | ${workflowText}`
          : "missing project id",
      )}</div>
      <span class="status-pill ${configured ? "is-success" : "is-error"}">${
        configured ? "Ready" : "Missing"
      }</span>
    </div>
  `;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Backend request failed: ${response.status}`,
    );
  }

  return data;
}

function getSelectedProject() {
  const project = customProject.value;
  if (project === "ca") {
    return {
      id: "ca",
      sourceLocale: "en-CA",
      targetLocales: ["fr-CA"],
    };
  }

  if (project === "eu") {
    return {
      id: "eu",
      sourceLocale: "en-IE",
      targetLocales: getSelectedEuTargetLocales(),
    };
  }

  return {
    id: "us",
    sourceLocale: "en-US",
    targetLocales: ["es-US"],
  };
}

function getSelectedCustomRoutes(project = getSelectedProject()) {
  return project.targetLocales.map((targetLocale) => ({
    sourceLocale: project.sourceLocale,
    targetLocale,
  }));
}

function getSelectedEuTargetLocales() {
  return [...document.querySelectorAll(".custom-target-check:checked")].map(
    (input) => input.value,
  );
}

function renderProjectTargetControls(project = getSelectedProject()) {
  const isEu = project.id === "eu";
  customEuTargets.hidden = !isEu;
  customEuTargets.classList.toggle("is-hidden", !isEu);
  customEuTargets.setAttribute("aria-hidden", String(!isEu));
}

function getMultiSubmitStatusMessage(requests) {
  const submitted = requests.filter(
    (request) => request.status === "submitted_to_smartling",
  );
  const failed = requests.filter(
    (request) => request.status === "smartling_error",
  );
  const stored = requests.length - submitted.length - failed.length;
  const targets = requests.map((request) => request.targetLocale).join(", ");
  const parts = [];

  if (submitted.length) parts.push(`${submitted.length} submitted`);
  if (failed.length) parts.push(`${failed.length} failed`);
  if (stored) parts.push(`${stored} stored locally`);

  return `${parts.join(", ")} for ${targets}.`;
}

function getRequestStatusLabel(request) {
  if (request.status === "translations_available") return "Ready";
  if (request.status === "submitted_to_smartling") return "Submitted";
  if (request.status === "smartling_error") return "Error";
  if (request.smartling?.mode === "not_configured") return "Local";
  return "Stored";
}

function getRequestStatusClass(request) {
  if (request.status === "translations_available") return "is-success";
  if (request.status === "submitted_to_smartling") return "is-success";
  if (request.status === "smartling_error") return "is-error";
  if (request.smartling?.mode === "not_configured") return "is-muted";
  return "is-warning";
}

function getApiBaseUrl() {
  return (input.value.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function setBackendState(state, label, detail) {
  backendState.className = `status-pill is-${state}`;
  backendState.textContent = label;
  backendDetails.textContent = detail;
}

function setStatus(message, state = "muted") {
  statusElement.textContent = message;
  statusElement.className =
    state === "error" ? "is-error" : state === "success" ? "is-success" : "";
}

function buildDefaultCustomJobName(date = new Date()) {
  return `${formatCompactDate(date)}-Custom`;
}

function setDefaultCustomJobNameParts(date = new Date()) {
  customJobPrefix.value = formatCompactDate(date);
  customJobName.value = "Custom";
  customJobSuffix.value = "";
}

function getDraftJobName(draft) {
  const draftJobName = String(draft.jobName || "").trim();
  return draftJobName.replace(/^\d{8}-/, "") || "Custom";
}

function buildCustomJobName(date = new Date()) {
  const submitDatePrefix = formatCompactDate(date);
  customJobPrefix.value = submitDatePrefix;
  return [submitDatePrefix, customJobName.value, customJobSuffix.value]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("-");
}

function getDefaultDueDateLocalValue(sourceLocale) {
  const dueDate = addBusinessDays(new Date(), sourceLocale === "en-IE" ? 5 : 3);
  dueDate.setHours(17, 0, 0, 0);
  return toDateTimeLocalValue(dueDate);
}

function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let remaining = businessDays;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      remaining -= 1;
    }
  }

  return date;
}

function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toSmartlingDueDateIso(localValue) {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatCompactDate(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "now";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
