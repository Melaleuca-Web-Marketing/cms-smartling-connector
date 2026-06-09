const DEFAULT_API_BASE_URL =
  "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";
const CUSTOM_DRAFT_STORAGE_KEY = "smartlingCustomJobDraft";
const DEFAULT_PANEL_LAYOUT = "overlay";
let draftSaveTimer = null;
let restoringDraft = false;

const input = document.getElementById("apiBaseUrl");
const apiTokenInput = document.getElementById("apiToken");
const statusElement = document.getElementById("status");
const backendState = document.getElementById("backendState");
const backendDetails = document.getElementById("backendDetails");
const smartlingSummary = document.getElementById("smartlingSummary");
const updateBanner = document.getElementById("updateBanner");
const settingsButton = document.getElementById("openSettings");
const panelLayout = document.getElementById("panelLayout");
const customJobPrefix = document.getElementById("customJobPrefix");
const customJobName = document.getElementById("customJobName");
const customJobSuffix = document.getElementById("customJobSuffix");
const customJobDescription = document.getElementById("customJobDescription");
const customProject = document.getElementById("customProject");
const customEuTargets = document.getElementById("customEuTargets");
const customDueDate = document.getElementById("customDueDate");
const customAuthorize = document.getElementById("customAuthorize");
const customNorthAmericaPair = document.getElementById("customNorthAmericaPair");
const customNorthAmericaPairRow = document.getElementById("customNorthAmericaPairRow");
const customStringList = document.getElementById("customStringList");

chrome.storage.local.get(
  {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiToken: "",
    smartlingPanelLayout: DEFAULT_PANEL_LAYOUT,
    [CUSTOM_DRAFT_STORAGE_KEY]: null,
  },
  (items) => {
    input.value = items.apiBaseUrl || DEFAULT_API_BASE_URL;
    apiTokenInput.value = items.apiToken || "";
    panelLayout.value = normalizePanelLayout(items.smartlingPanelLayout);
    initCustomJobForm(items[CUSTOM_DRAFT_STORAGE_KEY]);
    checkForExtensionUpdates();
  },
);

wireTabs();

document.getElementById("save").addEventListener("click", () => {
  const apiBaseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  chrome.storage.local.set({ apiBaseUrl, apiToken }, () => {
    input.value = apiBaseUrl;
    apiTokenInput.value = apiToken;
    setBackendState(
      "muted",
      "Not tested",
      "Backend settings saved. Test the connection when ready.",
    );
    setStatus("Saved backend settings.", "success");
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
panelLayout.addEventListener("change", savePanelLayout);
document
  .getElementById("addCustomString")
  .addEventListener("click", () => addCustomStringRow());
document
  .getElementById("submitCustomJob")
  .addEventListener("click", submitCustomJob);
document
  .getElementById("openBulkImport")
  .addEventListener("click", openBulkImportPage);
document
  .getElementById("openRecentJobs")
  .addEventListener("click", openRecentJobsPage);
settingsButton.addEventListener("click", () => activatePopupSection("settings"));
chrome.storage?.onChanged?.addListener(handleSettingsChanged);
customProject.addEventListener("change", () => {
  const project = getSelectedProject();
  customDueDate.value = getDefaultDueDateLocalValue(project.sourceLocale);
  renderProjectTargetControls(project);
  scheduleCustomDraftSave();
});
customJobName.addEventListener("input", scheduleCustomDraftSave);
customJobSuffix.addEventListener("input", scheduleCustomDraftSave);
customJobDescription.addEventListener("input", scheduleCustomDraftSave);
customDueDate.addEventListener("input", scheduleCustomDraftSave);
customAuthorize.addEventListener("change", scheduleCustomDraftSave);
customNorthAmericaPair.addEventListener("change", scheduleCustomDraftSave);
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
  smartlingSummary.innerHTML =
    '<div class="empty-state">Checking Smartling configuration...</div>';
  setStatus("Checking Smartling configuration...");

  try {
    const status = await apiFetch("/api/smartling/status");
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
      smartlingPanelLayout: DEFAULT_PANEL_LAYOUT,
      smartlingRecentRequestsCollapsed: true,
    },
    () => {
      panelLayout.value = DEFAULT_PANEL_LAYOUT;
      setStatus(
        "Panel state reset. Refresh the CMS page if it does not update.",
        "success",
      );
    },
  );
}

function savePanelLayout() {
  const layout = normalizePanelLayout(panelLayout.value);
  chrome.storage.local.set({ smartlingPanelLayout: layout }, () => {
    panelLayout.value = layout;
    setStatus("Panel layout saved.", "success");
  });
}

function normalizePanelLayout(value) {
  return value === "split" ? "split" : DEFAULT_PANEL_LAYOUT;
}

function handleSettingsChanged(changes, areaName) {
  if (areaName !== "local" || !changes.smartlingPanelLayout) {
    return;
  }

  panelLayout.value = normalizePanelLayout(changes.smartlingPanelLayout.newValue);
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
  document.querySelectorAll(".tab-button[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activatePopupSection(button.dataset.tab);
    });
  });
}

function activatePopupSection(tab) {
  document.querySelectorAll(".tab-button").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.tab === tab);
  });

  settingsButton.classList.toggle("is-active", tab === "settings");
  settingsButton.setAttribute("aria-pressed", String(tab === "settings"));

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${tab}`);
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

function openRecentJobsPage() {
  const url = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL("recent-jobs.html")
    : "recent-jobs.html";
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
  customNorthAmericaPair.checked = false;
  customStringList.innerHTML = "";

  if (draft) {
    restoreCustomDraft(draft);
  } else {
    renderProjectTargetControls(getSelectedProject());
    addCustomStringRow("", "");
  }

  restoringDraft = false;
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
  customJobDescription.value = draft.jobDescription || "";
  customAuthorize.checked = draft.authorizeJob !== false;
  customNorthAmericaPair.checked = draft.northAmericaPair === true;
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
    jobDescription: customJobDescription.value,
    jobDueDateLocal: customDueDate.value,
    authorizeJob: customAuthorize.checked,
    northAmericaPair: customNorthAmericaPair.checked,
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
            jobDescription: customJobDescription.value.trim(),
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
    customJobDescription.value = "";
    customDueDate.value = getDefaultDueDateLocalValue(project.sourceLocale);
    customNorthAmericaPair.checked = false;
    customStringList.innerHTML = "";
    addCustomStringRow("", "");
    clearCustomDraft();
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

function renderSmartlingStatus(status) {
  const projects = status.projects || {};
  const rows = [
    renderProjectRow("US", projects.us),
    renderProjectRow("CA", projects.ca),
    renderProjectRow("EU", projects.eu),
    renderSyncRow(status.sync),
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

function renderSyncRow(sync = {}) {
  return `
    <div class="project-row">
      <div class="project-key">Sync</div>
      <div class="project-details">${escapeHtml(
        sync.enabled
          ? `every ${sync.intervalMinutes || 60} min | lookback ${sync.lookbackDays ?? 30} days`
          : "disabled",
      )}</div>
      <span class="status-pill ${sync.enabled ? "is-success" : "is-muted"}">${
        sync.enabled ? "Enabled" : "Off"
      }</span>
    </div>
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
      ...getAuthHeaders(),
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
  if (customNorthAmericaPair.checked && (project.id === "us" || project.id === "ca")) {
    return getNorthAmericaCustomRoutes();
  }

  return project.targetLocales.map((targetLocale) => ({
    sourceLocale: project.sourceLocale,
    targetLocale,
  }));
}

function getNorthAmericaCustomRoutes() {
  return [
    {
      sourceLocale: "en-US",
      targetLocale: "es-US",
    },
    {
      sourceLocale: "en-CA",
      targetLocale: "fr-CA",
    },
  ];
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

  customNorthAmericaPairRow.hidden = isEu;
  customNorthAmericaPairRow.classList.toggle("is-hidden", isEu);
  customNorthAmericaPairRow.setAttribute("aria-hidden", String(isEu));

  if (isEu) {
    customNorthAmericaPair.checked = false;
  }
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

function getApiBaseUrl() {
  return (input.value.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function getApiToken() {
  return apiTokenInput.value.trim();
}

function getAuthHeaders() {
  const apiToken = getApiToken();
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
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
