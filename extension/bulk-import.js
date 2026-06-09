const DEFAULT_API_BASE_URL = "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";
const BULK_DRAFT_STORAGE_KEY = "smartlingBulkImportDraft";

let rows = [];
let draftSaveTimer = null;
let restoringDraft = false;
let isSubmittingBulkJob = false;
let submittedPayloadSignature = null;

const bulkJobName = document.getElementById("bulkJobName");
const bulkProject = document.getElementById("bulkProject");
const bulkDueDate = document.getElementById("bulkDueDate");
const bulkJobDescription = document.getElementById("bulkJobDescription");
const bulkAuthorize = document.getElementById("bulkAuthorize");
const bulkNorthAmericaPair = document.getElementById("bulkNorthAmericaPair");
const bulkNorthAmericaPairRow = document.getElementById("bulkNorthAmericaPairRow");
const bulkEuTargets = document.getElementById("bulkEuTargets");
const bulkFile = document.getElementById("bulkFile");
const bulkRows = document.getElementById("bulkRows");
const rowSummary = document.getElementById("rowSummary");
const statusElement = document.getElementById("status");
const submitBanner = document.getElementById("submitBanner");
const submitBannerTitle = document.getElementById("submitBannerTitle");
const submitBannerMessage = document.getElementById("submitBannerMessage");
const submitBulkJob = document.getElementById("submitBulkJob");
const startNewBulkJob = document.getElementById("startNewBulkJob");
const updateBanner = document.getElementById("updateBanner");
const downloadTemplate = document.getElementById("downloadTemplate");

if (downloadTemplate && globalThis.chrome?.runtime?.getURL) {
  downloadTemplate.href = chrome.runtime.getURL("templates/custom-job-template.xlsx");
}

if (globalThis.chrome?.storage?.local) {
  chrome.storage.local.get(
    {
      apiBaseUrl: DEFAULT_API_BASE_URL,
      apiToken: "",
      [BULK_DRAFT_STORAGE_KEY]: null
    },
    (items) => {
      initBulkPage(items[BULK_DRAFT_STORAGE_KEY]);
      checkForExtensionUpdates(items.apiBaseUrl || DEFAULT_API_BASE_URL);
    }
  );
} else {
  initBulkPage(null);
  checkForExtensionUpdates(DEFAULT_API_BASE_URL);
}

bulkProject.addEventListener("change", () => {
  bulkDueDate.value = getDefaultDueDateLocalValue(getSelectedProject().sourceLocale);
  renderProjectTargetControls();
  scheduleDraftSave();
});
bulkJobName.addEventListener("input", scheduleDraftSave);
bulkDueDate.addEventListener("input", scheduleDraftSave);
bulkJobDescription.addEventListener("input", scheduleDraftSave);
bulkAuthorize.addEventListener("change", scheduleDraftSave);
bulkNorthAmericaPair.addEventListener("change", scheduleDraftSave);
document.querySelectorAll(".bulk-target-check").forEach((input) => {
  input.addEventListener("change", scheduleDraftSave);
});
bulkFile.addEventListener("change", importWorkbook);
document.getElementById("addRow").addEventListener("click", () => {
  rows.push({ label: "", value: "" });
  renderRows();
  scheduleDraftSave();
});
document.getElementById("removeBlankRows").addEventListener("click", () => {
  rows = rows.filter((row) => row.label.trim() || row.value.trim());
  renderRows();
  scheduleDraftSave();
});
document.getElementById("clearRows").addEventListener("click", () => {
  if (!rows.length || confirm("Clear all imported rows?")) {
    rows = [];
    renderRows();
    scheduleDraftSave();
  }
});
submitBulkJob.addEventListener("click", submitBulkImport);
startNewBulkJob.addEventListener("click", startNewImport);
bulkRows.addEventListener("input", (event) => {
  const rowIndex = Number.parseInt(event.target.closest("tr")?.dataset.index, 10);
  if (!Number.isFinite(rowIndex) || !rows[rowIndex]) {
    return;
  }

  if (event.target.classList.contains("label-input")) {
    rows[rowIndex].label = event.target.value;
  }

  if (event.target.classList.contains("source-input")) {
    rows[rowIndex].value = event.target.value;
  }

  updateRowSummary();
  scheduleDraftSave();
});
bulkRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='remove-row']");
  if (!button) {
    return;
  }

  const rowIndex = Number.parseInt(button.closest("tr")?.dataset.index, 10);
  if (!Number.isFinite(rowIndex)) {
    return;
  }

  rows.splice(rowIndex, 1);
  renderRows();
  scheduleDraftSave();
});

function initBulkPage(draft) {
  restoringDraft = true;
  bulkJobName.value = buildDefaultCustomJobName();
  bulkProject.value = "us";
  bulkDueDate.value = getDefaultDueDateLocalValue(getSelectedProject().sourceLocale);
  bulkJobDescription.value = "";
  bulkAuthorize.checked = true;
  bulkNorthAmericaPair.checked = false;

  if (draft) {
    restoreDraft(draft);
  }

  renderProjectTargetControls();
  renderRows();
  restoringDraft = false;
}

function restoreDraft(draft) {
  bulkJobName.value = draft.jobName || buildDefaultCustomJobName();
  bulkProject.value = draft.project || "us";
  bulkDueDate.value =
    draft.jobDueDateLocal || getDefaultDueDateLocalValue(getSelectedProject().sourceLocale);
  bulkJobDescription.value = draft.jobDescription || "";
  bulkAuthorize.checked = draft.authorizeJob !== false;
  bulkNorthAmericaPair.checked = draft.northAmericaPair === true;
  rows = Array.isArray(draft.rows) ? draft.rows : [];

  const selectedTargets = new Set(Array.isArray(draft.euTargets) ? draft.euTargets : []);
  document.querySelectorAll(".bulk-target-check").forEach((input) => {
    input.checked = selectedTargets.size ? selectedTargets.has(input.value) : true;
  });
}

async function importWorkbook() {
  const file = bulkFile.files?.[0];
  if (!file) {
    return;
  }

  try {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Choose an .xlsx file created from the custom job template.");
    }

    setStatus("Importing workbook...");
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${await getApiBaseUrl()}/api/custom-translation-requests/import-xlsx`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type":
          file.type ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error?.message || `Workbook import failed: ${response.status}`);
    }

    const importedRows = Array.isArray(data.fields) ? data.fields : [];
    if (!importedRows.length) {
      throw new Error("No source strings were found in the workbook.");
    }

    rows = importedRows.map((row) => ({
      label: row.label || "",
      value: row.value || ""
    }));
    renderRows();
    scheduleDraftSave();
    setStatus(
      `Imported ${rows.length} string${rows.length === 1 ? "" : "s"} from ${file.name}.`,
      "success"
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    bulkFile.value = "";
  }
}

function renderRows() {
  if (!rows.length) {
    bulkRows.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">Import a workbook or add rows manually.</td>
      </tr>
    `;
    updateRowSummary();
    return;
  }

  bulkRows.innerHTML = rows
    .map(
      (row, index) => `
        <tr data-index="${index}">
          <td class="row-num">${index + 1}</td>
          <td>
            <input class="label-input" type="text" value="${escapeAttribute(row.label)}" placeholder="Custom label">
          </td>
          <td>
            <textarea class="source-input" rows="2" placeholder="Source string">${escapeHtml(
              row.value
            )}</textarea>
          </td>
          <td>
            <button type="button" class="remove-row" data-action="remove-row">Remove</button>
          </td>
        </tr>
      `
    )
    .join("");
  updateRowSummary();
}

async function submitBulkImport() {
  if (isSubmittingBulkJob || submittedPayloadSignature) {
    setStatus("This bulk job has already been submitted. Change the data or start a new import to submit again.", "error");
    showSubmitBanner(
      "Submission already sent",
      "The current rows are locked to prevent an accidental duplicate job.",
      "error"
    );
    return;
  }

  const project = getSelectedProject();
  const routes = getSelectedRoutes(project);
  const jobName = bulkJobName.value.trim() || buildDefaultCustomJobName();
  const jobDueDate = toSmartlingDueDateIso(bulkDueDate.value);
  const fields = getFieldsForSubmission();

  if (!jobDueDate) {
    setStatus("Select a valid job due date.", "error");
    return;
  }

  if (!fields.length) {
    setStatus("Import or add at least one source string before submitting.", "error");
    return;
  }

  if (!routes.length) {
    setStatus("Select at least one target language before submitting.", "error");
    return;
  }

  const payloadSignature = getBulkSubmissionSignature({ fields, jobDueDate, jobName, routes });
  setSubmitButtonState("submitting");
  setStatus(routes.length === 1 ? "Submitting bulk job..." : `Submitting ${routes.length} bulk jobs...`);
  showSubmitBanner(
    "Submitting bulk job",
    routes.length === 1 ? "Sending one Smartling request..." : `Sending ${routes.length} Smartling requests...`,
    "muted"
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
            jobDescription: bulkJobDescription.value.trim(),
            authorizeJob: bulkAuthorize.checked,
            fields
          })
        })
      );
    }

    const message = getMultiSubmitStatusMessage(responses.map((response) => response.request));
    submittedPayloadSignature = payloadSignature;
    setSubmitButtonState("submitted");
    setStatus(message, "success");
    showSubmitBanner(
      "Bulk job submitted",
      `${message} The submit button is locked until you change the data or start a new import.`,
      "success"
    );
    submitBanner.scrollIntoView({ block: "nearest", behavior: "smooth" });
    globalThis.chrome?.storage?.local?.remove?.(BULK_DRAFT_STORAGE_KEY);
  } catch (error) {
    setSubmitButtonState("idle");
    setStatus(error.message, "error");
    showSubmitBanner("Bulk job was not submitted", error.message, "error");
  }
}

function getFieldsForSubmission() {
  return rows
    .map((row, index) => ({
      label: row.label.trim() || `String ${index + 1}`,
      value: row.value || ""
    }))
    .filter((row) => row.value.trim());
}

function updateRowSummary() {
  const populated = rows.filter((row) => row.value.trim()).length;
  rowSummary.textContent = rows.length
    ? `${populated} of ${rows.length} row${rows.length === 1 ? "" : "s"} ready to submit.`
    : "No strings imported yet.";
}

function renderProjectTargetControls() {
  const isEu = getSelectedProject().id === "eu";
  bulkEuTargets.hidden = !isEu;
  bulkNorthAmericaPairRow.hidden = isEu;
  if (isEu) {
    bulkNorthAmericaPair.checked = false;
  }
}

function getSelectedProject() {
  if (bulkProject.value === "ca") {
    return {
      id: "ca",
      sourceLocale: "en-CA",
      targetLocales: ["fr-CA"]
    };
  }

  if (bulkProject.value === "eu") {
    return {
      id: "eu",
      sourceLocale: "en-IE",
      targetLocales: getSelectedEuTargetLocales()
    };
  }

  return {
    id: "us",
    sourceLocale: "en-US",
    targetLocales: ["es-US"]
  };
}

function getSelectedRoutes(project) {
  if (bulkNorthAmericaPair.checked && (project.id === "us" || project.id === "ca")) {
    return getNorthAmericaRoutes();
  }

  return project.targetLocales.map((targetLocale) => ({
    sourceLocale: project.sourceLocale,
    targetLocale
  }));
}

function getNorthAmericaRoutes() {
  return [
    {
      sourceLocale: "en-US",
      targetLocale: "es-US"
    },
    {
      sourceLocale: "en-CA",
      targetLocale: "fr-CA"
    }
  ];
}

function getSelectedEuTargetLocales() {
  return [...document.querySelectorAll(".bulk-target-check:checked")].map((input) => input.value);
}

async function apiFetch(path, options = {}) {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${await getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || `Backend request failed: ${response.status}`);
  }

  return data;
}

function getApiBaseUrl() {
  return getBackendSettings().then((settings) => settings.apiBaseUrl);
}

function getAuthHeaders() {
  return getBackendSettings().then((settings) =>
    settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {}
  );
}

function getBackendSettings() {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiToken: ""
      });
      return;
    }

    chrome.storage.local.get(
      {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        apiToken: ""
      },
      (items) =>
        resolve({
          apiBaseUrl: (items.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
          apiToken: items.apiToken || ""
        })
    );
  });
}

async function checkForExtensionUpdates(apiBaseUrl) {
  if (!globalThis.SmartlingVersionCheck) {
    return;
  }

  try {
    renderUpdateBanner(await SmartlingVersionCheck.check(apiBaseUrl));
  } catch {
    renderUpdateBanner(null);
  }
}

function renderUpdateBanner(updateInfo) {
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
        updateInfo.currentVersion
      )}.</span>
    </div>
    <a href="${escapeAttribute(
      updateInfo.downloadPageUrl
    )}" target="_blank" rel="noopener noreferrer">Download update</a>
  `;
}

function scheduleDraftSave() {
  if (restoringDraft) {
    return;
  }

  markBulkDataChanged();
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 150);
}

function saveDraft() {
  if (!globalThis.chrome?.storage?.local) {
    return;
  }

  chrome.storage.local.set({
    [BULK_DRAFT_STORAGE_KEY]: {
      authorizeJob: bulkAuthorize.checked,
      euTargets: getSelectedEuTargetLocales(),
      jobDueDateLocal: bulkDueDate.value,
      jobName: bulkJobName.value,
      northAmericaPair: bulkNorthAmericaPair.checked,
      jobDescription: bulkJobDescription.value,
      project: bulkProject.value,
      rows,
      savedAt: new Date().toISOString()
    }
  });
}

function startNewImport() {
  if (
    rows.length &&
    !confirm("Clear the current bulk import and start a new one?")
  ) {
    return;
  }

  restoringDraft = true;
  rows = [];
  bulkJobName.value = buildDefaultCustomJobName();
  bulkProject.value = "us";
  bulkDueDate.value = getDefaultDueDateLocalValue(getSelectedProject().sourceLocale);
  bulkJobDescription.value = "";
  bulkAuthorize.checked = true;
  bulkNorthAmericaPair.checked = false;
  document.querySelectorAll(".bulk-target-check").forEach((input) => {
    input.checked = true;
  });
  restoringDraft = false;

  submittedPayloadSignature = null;
  renderProjectTargetControls();
  renderRows();
  setSubmitButtonState("idle");
  hideSubmitBanner();
  setStatus("Ready for a new bulk import.");
  globalThis.chrome?.storage?.local?.remove?.(BULK_DRAFT_STORAGE_KEY);
}

function markBulkDataChanged() {
  if (restoringDraft || isSubmittingBulkJob) {
    return;
  }

  if (submittedPayloadSignature) {
    submittedPayloadSignature = null;
    setSubmitButtonState("idle");
    showSubmitBanner(
      "Bulk job data changed",
      "Submission is available again because the rows or job settings changed.",
      "muted"
    );
    setStatus("Data changed. Review before submitting again.");
  }
}

function setSubmitButtonState(state) {
  isSubmittingBulkJob = state === "submitting";
  submitBulkJob.disabled = state === "submitting" || state === "submitted";
  submitBulkJob.textContent =
    state === "submitting"
      ? "Sending..."
      : state === "submitted"
        ? "Submitted"
        : "Send Bulk Job";
}

function showSubmitBanner(title, message, state = "muted") {
  submitBanner.hidden = false;
  submitBanner.className = `submit-banner is-${state}`;
  submitBannerTitle.textContent = title;
  submitBannerMessage.textContent = message;
}

function hideSubmitBanner() {
  submitBanner.hidden = true;
  submitBanner.className = "submit-banner";
  submitBannerTitle.textContent = "";
  submitBannerMessage.textContent = "";
}

function getBulkSubmissionSignature({ fields, jobDueDate, jobName, routes }) {
  return JSON.stringify({
    authorizeJob: bulkAuthorize.checked,
    fields,
    jobDescription: bulkJobDescription.value.trim(),
    jobDueDate,
    jobName,
    routes
  });
}

function getMultiSubmitStatusMessage(requests) {
  const submitted = requests.filter((request) => request.status === "submitted_to_smartling");
  const failed = requests.filter((request) => request.status === "smartling_error");
  const stored = requests.length - submitted.length - failed.length;
  const targets = requests.map((request) => request.targetLocale).join(", ");
  const parts = [];

  if (submitted.length) parts.push(`${submitted.length} submitted`);
  if (failed.length) parts.push(`${failed.length} failed`);
  if (stored) parts.push(`${stored} stored locally`);

  return `${parts.join(", ")} for ${targets}.`;
}

function buildDefaultCustomJobName(date = new Date()) {
  return `${formatCompactDate(date)}-Custom`;
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

function setStatus(message, state = "muted") {
  statusElement.textContent = message;
  statusElement.className = state === "error" ? "is-error" : state === "success" ? "is-success" : "";
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
