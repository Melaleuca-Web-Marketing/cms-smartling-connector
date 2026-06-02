const DEFAULT_API_BASE_URL = "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";
const FAVORITES_STORAGE_KEY = "smartlingRecentJobFavorites";

let apiBaseUrl = DEFAULT_API_BASE_URL;
let apiToken = "";
let favoriteIds = new Set();
let allJobs = [];
let filteredJobs = [];

const elements = {
  clearFilters: document.getElementById("clearFilters"),
  customJobs: document.getElementById("customJobs"),
  favoriteJobs: document.getElementById("favoriteJobs"),
  favoritesOnly: document.getElementById("favoritesOnly"),
  jobsCount: document.getElementById("jobsCount"),
  jobsList: document.getElementById("jobsList"),
  localeFilter: document.getElementById("localeFilter"),
  readyJobs: document.getElementById("readyJobs"),
  refreshJobs: document.getElementById("refreshJobs"),
  searchJobs: document.getElementById("searchJobs"),
  sortJobs: document.getElementById("sortJobs"),
  status: document.getElementById("status"),
  statusFilter: document.getElementById("statusFilter"),
  totalJobs: document.getElementById("totalJobs"),
  typeFilter: document.getElementById("typeFilter"),
  updateBanner: document.getElementById("updateBanner")
};

init();

async function init() {
  const stored = await getExtensionStorage({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiToken: "",
    [FAVORITES_STORAGE_KEY]: []
  });
  apiBaseUrl = String(stored.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  apiToken = String(stored.apiToken || "");
  favoriteIds = new Set(Array.isArray(stored[FAVORITES_STORAGE_KEY]) ? stored[FAVORITES_STORAGE_KEY] : []);

  wireEvents();
  checkForExtensionUpdates();
  await loadJobs();
}

function wireEvents() {
  elements.refreshJobs.addEventListener("click", () => loadJobs({ forceSync: true }));
  elements.searchJobs.addEventListener("input", applyFilters);
  elements.typeFilter.addEventListener("change", applyFilters);
  elements.statusFilter.addEventListener("change", applyFilters);
  elements.localeFilter.addEventListener("change", applyFilters);
  elements.sortJobs.addEventListener("change", applyFilters);
  elements.favoritesOnly.addEventListener("change", applyFilters);
  elements.clearFilters.addEventListener("click", clearFilters);
  elements.jobsList.addEventListener("click", handleJobAction);
}

async function loadJobs({ forceSync = false, skipSync = false } = {}) {
  setStatus(skipSync ? "Loading recent jobs..." : "Syncing active Smartling jobs...");
  elements.refreshJobs.disabled = true;
  let syncSummary = null;
  let syncError = null;

  try {
    if (!skipSync) {
      try {
        syncSummary = await syncActiveJobs(forceSync);
      } catch (error) {
        syncError = error;
      }
    }

    const [customResponse, skuResponse] = await Promise.all([
      apiFetch("/api/custom-translation-requests"),
      apiFetch("/api/translation-requests")
    ]);

    allJobs = [
      ...(customResponse.requests || []).map((request) => normalizeJob(request, "custom")),
      ...(skuResponse.requests || []).map((request) => normalizeJob(request, "sku"))
    ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    renderFilterOptions();
    applyFilters();
    setStatus(buildLoadStatusMessage(allJobs.length, syncSummary, syncError), syncError ? "error" : "success");
  } catch (error) {
    elements.jobsList.innerHTML = `<div class="empty-state">Could not load recent jobs: ${escapeHtml(error.message)}</div>`;
    elements.jobsCount.textContent = "Recent jobs are unavailable.";
    setStatus(error.message, "error");
  } finally {
    elements.refreshJobs.disabled = false;
  }
}

async function syncActiveJobs(force) {
  const response = await apiFetch("/api/translation-requests/sync", {
    method: "POST",
    body: JSON.stringify({
      force,
      reason: force ? "manual" : "dashboard"
    })
  });

  return response.summary || null;
}

function buildLoadStatusMessage(jobCount, syncSummary, syncError) {
  const loaded = `Loaded ${jobCount} job${jobCount === 1 ? "" : "s"}.`;

  if (syncError) {
    return `${loaded} Sync failed: ${syncError.message}`;
  }

  if (!syncSummary) {
    return loaded;
  }

  return `${loaded} ${syncSummary.message || "Smartling sync checked active jobs."}`;
}

function normalizeJob(request, fallbackType) {
  const fields = Array.isArray(request.fields) ? request.fields : [];
  const type = request.requestType === "custom" || fallbackType === "custom" ? "custom" : "sku";
  const sentFields = fields.filter((field) => field.sentToSmartling !== false && field.emptySource !== true);
  const translatedFields = fields.filter((field) => String(field.translatedText || "").trim());
  const labelText = fields.map((field) => field.fieldLabel || field.label || field.fieldKey).filter(Boolean).join(" ");
  const smartlingJobUid = request.smartling?.translationJobUid || "";
  const sourceLocale = request.sourceLocale || "";
  const targetLocale = request.targetLocale || "";

  return {
    ...request,
    displayType: type,
    fieldCount: fields.length,
    labelText,
    sentFieldCount: sentFields.length,
    smartlingJobUid,
    targetLocale,
    translatedFieldCount: translatedFields.length,
    searchText: [
      request.id,
      request.jobName,
      request.jobDescription,
      request.referenceNumber,
      request.sku,
      sourceLocale,
      targetLocale,
      smartlingJobUid,
      request.smartlingJobStatus?.jobStatus,
      labelText
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}

function renderFilterOptions() {
  renderSelectOptions(
    elements.statusFilter,
    "all",
    "All statuses",
    uniqueValues(allJobs.map((job) => job.status)).map((status) => ({
      value: status,
      label: getStatusLabel({ status })
    }))
  );
  renderSelectOptions(
    elements.localeFilter,
    "all",
    "All targets",
    uniqueValues(allJobs.map((job) => job.targetLocale)).map((locale) => ({
      value: locale,
      label: locale
    }))
  );
}

function renderSelectOptions(select, allValue, allLabel, options) {
  const previousValue = select.value || allValue;
  select.innerHTML = [
    `<option value="${escapeAttribute(allValue)}">${escapeHtml(allLabel)}</option>`,
    ...options.map(
      (option) =>
        `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`
    )
  ].join("");
  select.value = [...select.options].some((option) => option.value === previousValue)
    ? previousValue
    : allValue;
}

function applyFilters() {
  const query = elements.searchJobs.value.trim().toLowerCase();
  const type = elements.typeFilter.value;
  const status = elements.statusFilter.value;
  const locale = elements.localeFilter.value;
  const favoritesOnly = elements.favoritesOnly.checked;

  filteredJobs = allJobs
    .filter((job) => !query || job.searchText.includes(query))
    .filter((job) => type === "all" || job.displayType === type)
    .filter((job) => status === "all" || job.status === status)
    .filter((job) => locale === "all" || job.targetLocale === locale)
    .filter((job) => !favoritesOnly || favoriteIds.has(job.id));

  sortJobs();
  renderStats();
  renderJobs();
}

function sortJobs() {
  const sortMode = elements.sortJobs.value;
  const compareDate = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

  filteredJobs.sort((a, b) => {
    if (sortMode === "oldest") return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (sortMode === "name") return String(a.jobName || a.id).localeCompare(String(b.jobName || b.id));
    if (sortMode === "status") return getStatusLabel(a).localeCompare(getStatusLabel(b)) || compareDate(a, b);
    return compareDate(a, b);
  });
}

function renderStats() {
  const favoriteCount = allJobs.filter((job) => favoriteIds.has(job.id)).length;
  elements.totalJobs.textContent = String(allJobs.length);
  elements.customJobs.textContent = String(allJobs.filter((job) => job.displayType === "custom").length);
  elements.readyJobs.textContent = String(
    allJobs.filter((job) => job.status === "translations_available" || job.status === "published").length
  );
  elements.favoriteJobs.textContent = String(favoriteCount);
  elements.jobsCount.textContent = `${filteredJobs.length} of ${allJobs.length} job${
    allJobs.length === 1 ? "" : "s"
  } shown.`;
}

function renderJobs() {
  if (!filteredJobs.length) {
    elements.jobsList.innerHTML = '<div class="empty-state">No jobs match the current filters.</div>';
    return;
  }

  elements.jobsList.innerHTML = filteredJobs.map(renderJobCard).join("");
}

function renderJobCard(job) {
  const isFavorite = favoriteIds.has(job.id);
  const typeLabel = job.displayType === "custom" ? "Custom" : "SKU";
  const sourceTarget = [job.sourceLocale, job.targetLocale].filter(Boolean).join(" to ");
  const fieldSummary = getFieldSummary(job);

  return `
    <article class="job-card ${isFavorite ? "is-favorite" : ""}">
      <div class="job-card-header">
        <div class="job-title-group">
          <div class="job-card-actions">
            <span class="status-pill ${escapeAttribute(getStatusClass(job))}">${escapeHtml(getStatusLabel(job))}</span>
            <span class="status-pill type-pill">${escapeHtml(typeLabel)}</span>
            ${job.targetLocale ? `<span class="job-meta">${escapeHtml(job.targetLocale)}</span>` : ""}
          </div>
          <div class="job-title">${escapeHtml(job.jobName || job.id)}</div>
          <div class="job-subtitle">${escapeHtml(getJobSubtitle(job))}</div>
        </div>
        <button
          type="button"
          class="favorite-button ${isFavorite ? "is-active" : ""}"
          data-action="toggle-favorite"
          data-request-id="${escapeAttribute(job.id)}"
        >${isFavorite ? "Favorited" : "Favorite"}</button>
      </div>

      <div class="job-meta-grid">
        ${sourceTarget ? `<span class="job-meta">${escapeHtml(sourceTarget)}</span>` : ""}
        ${job.sku ? `<span class="job-meta">SKU ${escapeHtml(job.sku)}</span>` : ""}
        ${job.referenceNumber ? `<span class="job-meta">Ref ${escapeHtml(job.referenceNumber)}</span>` : ""}
        ${job.smartlingJobUid ? `<span class="job-meta">Smartling ${escapeHtml(job.smartlingJobUid)}</span>` : ""}
        <span class="job-meta">${escapeHtml(formatDate(job.createdAt))}</span>
      </div>

      <div class="field-summary">
        <strong>${escapeHtml(fieldSummary)}</strong>
        <span class="field-labels">${escapeHtml(getFieldLabels(job))}</span>
      </div>

      ${job.jobDescription ? `<div class="job-note"><strong>Additional details</strong><span>${escapeHtml(job.jobDescription)}</span></div>` : ""}
      ${job.import?.message ? `<div class="job-note">${escapeHtml(job.import.message)}</div>` : ""}

      <div class="job-card-actions">
        ${
          job.status === "submitted_to_smartling"
            ? `<button type="button" class="secondary-button" data-action="sync-job" data-request-id="${escapeAttribute(job.id)}">Refresh now</button>`
            : ""
        }
      </div>
    </article>
  `;
}

async function handleJobAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const requestId = button.dataset.requestId;
  if (!requestId) {
    return;
  }

  if (button.dataset.action === "toggle-favorite") {
    await toggleFavorite(requestId);
    return;
  }

  if (button.dataset.action === "sync-job") {
    await syncJob(requestId, button);
  }
}

async function toggleFavorite(requestId) {
  if (favoriteIds.has(requestId)) {
    favoriteIds.delete(requestId);
  } else {
    favoriteIds.add(requestId);
  }

  await setExtensionStorage({
    [FAVORITES_STORAGE_KEY]: [...favoriteIds]
  });
  applyFilters();
}

async function syncJob(requestId, button) {
  button.disabled = true;
  setStatus("Refreshing Smartling status...");

  try {
    const response = await apiFetch(
      `/api/translation-requests/${encodeURIComponent(requestId)}/sync`,
      {
        method: "POST",
        body: JSON.stringify({
          force: true,
          reason: "manual"
        })
      }
    );
    const request = response.request || {};

    if (request.status === "translations_available") {
      setStatus(
        `Imported ${response.translations?.length || 0} translation${
          response.translations?.length === 1 ? "" : "s"
        }.`,
        "success"
      );
    } else if (request.status === "cancelled") {
      setStatus(request.import?.message || "Smartling job was cancelled.", "error");
    } else if (request.import?.mode === "not_ready") {
      setStatus(`Translations are not ready yet. Progress: ${request.import.progressPercent ?? 0}%.`);
    } else {
      setStatus(request.import?.message || "Translations were not imported yet.", "error");
    }

    await loadJobs({ skipSync: true });
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function clearFilters() {
  elements.searchJobs.value = "";
  elements.typeFilter.value = "all";
  elements.statusFilter.value = "all";
  elements.localeFilter.value = "all";
  elements.sortJobs.value = "newest";
  elements.favoritesOnly.checked = false;
  applyFilters();
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || `Backend request failed: ${response.status}`);
  }

  return data;
}

function getAuthHeaders() {
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
}

async function checkForExtensionUpdates() {
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
    elements.updateBanner.hidden = true;
    elements.updateBanner.innerHTML = "";
    return;
  }

  elements.updateBanner.hidden = false;
  elements.updateBanner.innerHTML = `
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

function getFieldSummary(job) {
  if (job.fieldCount === 0) {
    return "No field detail available.";
  }

  if (job.status === "translations_available" || job.status === "published") {
    return `${job.translatedFieldCount} of ${job.sentFieldCount || job.fieldCount} translated fields available.`;
  }

  if (job.status === "cancelled") {
    return "Smartling job was cancelled.";
  }

  return `${job.sentFieldCount || job.fieldCount} string${
    (job.sentFieldCount || job.fieldCount) === 1 ? "" : "s"
  } submitted.`;
}

function getFieldLabels(job) {
  return (
    (job.fields || [])
      .map((field) => field.fieldLabel || field.label || field.fieldKey)
      .filter(Boolean)
      .join(", ") || "Field labels unavailable."
  );
}

function getJobSubtitle(job) {
  if (job.displayType === "sku") {
    return job.sku ? `Product SKU ${job.sku}` : "Product translation request";
  }

  return `${job.fieldCount} custom string${job.fieldCount === 1 ? "" : "s"}`;
}

function getStatusLabel(job) {
  if (job.status === "translations_available") return "Ready";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "submitted_to_smartling") return "Submitted";
  if (job.status === "smartling_error") return "Error";
  if (job.status === "stored_waiting_for_smartling") return "Stored";
  if (job.status === "published") return "Published";
  return "Local";
}

function getStatusClass(job) {
  if (job.status === "translations_available") return "is-ready";
  if (job.status === "published") return "is-published";
  if (job.status === "cancelled") return "is-cancelled";
  if (job.status === "submitted_to_smartling") return "is-submitted";
  if (job.status === "smartling_error") return "is-error";
  if (job.status === "stored_waiting_for_smartling") return "is-stored";
  return "is-muted";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "Unknown date";
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function setStatus(message, state = "muted") {
  elements.status.textContent = message;
  elements.status.className = state === "error" ? "is-error" : state === "success" ? "is-success" : "";
}

function getExtensionStorage(defaults) {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve(defaults);
      return;
    }

    chrome.storage.local.get(defaults, resolve);
  });
}

function setExtensionStorage(values) {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve();
      return;
    }

    chrome.storage.local.set(values, resolve);
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
