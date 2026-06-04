const DEFAULT_API_BASE_URL = "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";
const FAVORITES_STORAGE_KEY = "smartlingRecentJobFavorites";
const FILTERS_STORAGE_KEY = "smartlingRecentJobFilters";
const DEFAULT_JOBS_LIMIT = 10;
const DEFAULT_TYPE_FILTER = "custom";
const DEFAULT_STATUS_FILTER = "ready";
const READY_STATUS_VALUES = new Set(["translations_available", "published"]);
const STATUS_FILTER_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "submitted_to_smartling", label: "Submitted" },
  { value: "smartling_error", label: "Error" },
  { value: "stored_waiting_for_smartling", label: "Stored" },
  { value: "cancelled", label: "Cancelled" },
  { value: "published", label: "Published" }
];
const TARGET_LOCALE_OPTIONS = ["es-US", "fr-CA", "nl-NL", "de-DE", "de-AT", "pl-PL", "lt-LT", "it-IT"];

let apiBaseUrl = DEFAULT_API_BASE_URL;
let apiToken = "";
let favoriteIds = new Set();
let allJobs = [];
let filteredJobs = [];
let jobsTotal = 0;
let jobsHasMore = false;
let filterReloadTimer = null;

const elements = {
  clearFilters: document.getElementById("clearFilters"),
  customJobs: document.getElementById("customJobs"),
  favoriteJobs: document.getElementById("favoriteJobs"),
  favoritesOnly: document.getElementById("favoritesOnly"),
  jobsCount: document.getElementById("jobsCount"),
  jobsList: document.getElementById("jobsList"),
  loadMoreJobs: document.getElementById("loadMoreJobs"),
  jobsPagination: document.querySelector(".jobs-pagination"),
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

  renderFilterOptions();
  restoreFilters();
  wireEvents();
  checkForExtensionUpdates();
  await loadJobs();
}

function wireEvents() {
  elements.refreshJobs.addEventListener("click", () => loadJobs({ forceSync: true }));
  elements.loadMoreJobs.addEventListener("click", () => loadJobs({ append: true }));
  elements.searchJobs.addEventListener("input", scheduleFilterReload);
  elements.typeFilter.addEventListener("change", handleFilterChange);
  elements.statusFilter.addEventListener("change", handleFilterChange);
  elements.localeFilter.addEventListener("change", handleFilterChange);
  elements.sortJobs.addEventListener("change", handleFilterChange);
  elements.favoritesOnly.addEventListener("change", handleFilterChange);
  elements.clearFilters.addEventListener("click", clearFilters);
  elements.jobsList.addEventListener("click", handleJobAction);
}

async function loadJobs({ forceSync = false, append = false } = {}) {
  clearTimeout(filterReloadTimer);
  setStatus(forceSync ? "Syncing active Smartling jobs..." : "Loading cached jobs...");
  elements.refreshJobs.disabled = true;
  elements.loadMoreJobs.disabled = true;
  let syncSummary = null;
  let syncError = null;
  const offset = append ? allJobs.length : 0;

  try {
    if (forceSync) {
      try {
        syncSummary = await syncActiveJobs(forceSync);
      } catch (error) {
        syncError = error;
      }
    }

    const response = await loadJobPage(offset);
    const pageJobs = (response.requests || []).map((request) => normalizeJob(request, request.requestType));

    allJobs = append ? [...allJobs, ...pageJobs] : pageJobs;
    jobsTotal = Number(response.total) || allJobs.length;
    jobsHasMore = response.hasMore === true;

    renderLoadedJobs();
    setStatus(buildLoadStatusMessage(syncSummary, syncError), syncError ? "error" : "success");
  } catch (error) {
    elements.jobsList.innerHTML = `<div class="empty-state">Could not load recent jobs: ${escapeHtml(error.message)}</div>`;
    elements.jobsPagination.hidden = true;
    elements.jobsCount.textContent = "Recent jobs are unavailable.";
    setStatus(error.message, "error");
  } finally {
    elements.refreshJobs.disabled = false;
    elements.loadMoreJobs.disabled = false;
  }
}

async function loadJobPage(offset) {
  const params = buildJobsQueryParams(offset);

  if (!params) {
    return {
      requests: [],
      total: 0,
      limit: DEFAULT_JOBS_LIMIT,
      offset,
      hasMore: false
    };
  }

  return await apiFetch(`/api/jobs?${params.toString()}`);
}

function buildJobsQueryParams(offset) {
  if (elements.favoritesOnly.checked && favoriteIds.size === 0) {
    return null;
  }

  const params = new URLSearchParams({
    limit: String(DEFAULT_JOBS_LIMIT),
    offset: String(offset),
    sort: elements.sortJobs.value || "newest",
    type: elements.typeFilter.value || "all"
  });
  const status = elements.statusFilter.value || "all";
  const targetLocale = elements.localeFilter.value || "all";
  const query = elements.searchJobs.value.trim();

  if (status !== "all") {
    params.set("statuses", status);
  }

  if (targetLocale !== "all") {
    params.set("targetLocale", targetLocale);
  }

  if (query) {
    params.set("q", query);
  }

  if (elements.favoritesOnly.checked) {
    params.set("ids", [...favoriteIds].join(","));
  }

  return params;
}

function scheduleFilterReload() {
  clearTimeout(filterReloadTimer);
  saveFilters();
  filterReloadTimer = setTimeout(() => loadJobs(), 250);
}

function handleFilterChange() {
  saveFilters();
  loadJobs();
}

function restoreFilters() {
  applyFilterState(getSavedFilters() || getDefaultFilterState());
}

function getDefaultFilterState() {
  return {
    favoritesOnly: false,
    locale: "all",
    query: "",
    sort: "newest",
    status: DEFAULT_STATUS_FILTER,
    type: DEFAULT_TYPE_FILTER
  };
}

function setDefaultFilters() {
  applyFilterState(getDefaultFilterState());
}

function applyFilterState(filters) {
  const normalized = normalizeFilterState(filters);
  elements.searchJobs.value = normalized.query;
  elements.typeFilter.value = normalized.type;
  elements.statusFilter.value = normalized.status;
  elements.localeFilter.value = normalized.locale;
  elements.sortJobs.value = normalized.sort;
  elements.favoritesOnly.checked = normalized.favoritesOnly;
}

function getCurrentFilterState() {
  return normalizeFilterState({
    favoritesOnly: elements.favoritesOnly.checked,
    locale: elements.localeFilter.value,
    query: elements.searchJobs.value,
    sort: elements.sortJobs.value,
    status: elements.statusFilter.value,
    type: elements.typeFilter.value
  });
}

function normalizeFilterState(filters = {}) {
  return {
    favoritesOnly: filters.favoritesOnly === true,
    locale: getAllowedFilterValue(filters.locale, ["all", ...TARGET_LOCALE_OPTIONS], "all"),
    query: String(filters.query || "").slice(0, 250),
    sort: getAllowedFilterValue(filters.sort, ["newest", "oldest", "name", "status"], "newest"),
    status: getAllowedFilterValue(
      filters.status,
      ["all", ...STATUS_FILTER_OPTIONS.map((option) => option.value)],
      DEFAULT_STATUS_FILTER
    ),
    type: getAllowedFilterValue(filters.type, ["all", "custom", "sku"], DEFAULT_TYPE_FILTER)
  };
}

function getAllowedFilterValue(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function getSavedFilters() {
  try {
    const raw = globalThis.localStorage?.getItem(FILTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveFilters() {
  try {
    globalThis.localStorage?.setItem(FILTERS_STORAGE_KEY, JSON.stringify(getCurrentFilterState()));
  } catch {
    // Filter persistence is a convenience; ignore localStorage failures.
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

function buildLoadStatusMessage(syncSummary, syncError) {
  const shown = allJobs.length;
  const descriptor = getCurrentFilterDescription();
  const loaded = `Showing ${shown} of ${jobsTotal} ${descriptor}.`;

  if (syncError) {
    return `${loaded} Sync failed: ${syncError.message}`;
  }

  if (!syncSummary) {
    return `${loaded} Cached results loaded.`;
  }

  return `${loaded} ${syncSummary.message || "Smartling sync checked active jobs."}`;
}

function normalizeJob(request, fallbackType) {
  const fields = Array.isArray(request.fields) ? request.fields : [];
  const type = request.requestType === "custom" || fallbackType === "custom" ? "custom" : "sku";
  const sentFields = fields.filter((field) => field.sentToSmartling !== false && field.emptySource !== true);
  const translatedFields = fields.filter((field) => String(field.translatedText || "").trim());
  const labelText = fields.map((field) => field.fieldLabel || field.label || field.fieldKey).filter(Boolean).join(" ");
  const translatedText = translatedFields.map((field) => field.translatedText).join(" ");
  const sourceText = fields.map((field) => field.sourceText).filter(Boolean).join(" ");
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
      labelText,
      sourceText,
      translatedText
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
    STATUS_FILTER_OPTIONS
  );
  renderSelectOptions(
    elements.localeFilter,
    "all",
    "All targets",
    TARGET_LOCALE_OPTIONS.map((locale) => ({
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

function renderLoadedJobs() {
  filteredJobs = allJobs.slice();
  renderStats();
  renderJobs();
}

function renderStats() {
  const typeFilter = elements.typeFilter.value;
  const statusFilter = elements.statusFilter.value;

  elements.totalJobs.textContent = String(jobsTotal);
  elements.customJobs.textContent = String(
    typeFilter === "custom" ? jobsTotal : allJobs.filter((job) => job.displayType === "custom").length
  );
  elements.readyJobs.textContent = String(
    statusFilter === "ready"
      ? jobsTotal
      : allJobs.filter((job) => READY_STATUS_VALUES.has(job.status)).length
  );
  elements.favoriteJobs.textContent = String(favoriteIds.size);
  elements.jobsCount.textContent = `Showing ${filteredJobs.length} of ${jobsTotal} ${getCurrentFilterDescription()}.`;
}

function renderJobs() {
  if (!filteredJobs.length) {
    elements.jobsList.innerHTML = '<div class="empty-state">No jobs match the current filters.</div>';
    elements.jobsPagination.hidden = true;
    return;
  }

  elements.jobsList.innerHTML = filteredJobs.map(renderJobCard).join("");
  elements.jobsPagination.hidden = !jobsHasMore;
}

function getCurrentFilterDescription() {
  const type = elements.typeFilter.value;
  const status = elements.statusFilter.value;
  const typeLabel =
    type === "custom" ? "custom jobs" : type === "sku" ? "SKU jobs" : "jobs";

  if (status === "ready") {
    return `ready ${typeLabel}`;
  }

  if (status !== "all") {
    return `${getStatusLabel({ status }).toLowerCase()} ${typeLabel}`;
  }

  return typeLabel;
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

      ${renderCustomTranslations(job)}
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

  if (button.dataset.action === "copy-translation") {
    await copyTranslation(requestId, button.dataset.fieldKey || "", button);
    return;
  }

  if (button.dataset.action === "copy-all-translations") {
    await copyAllTranslations(requestId, button);
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

  if (elements.favoritesOnly.checked) {
    await loadJobs();
    return;
  }

  renderLoadedJobs();
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

    await loadJobs();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function clearFilters() {
  setDefaultFilters();
  saveFilters();
  loadJobs();
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

function renderCustomTranslations(job) {
  if (job.displayType !== "custom" || !["translations_available", "published"].includes(job.status)) {
    return "";
  }

  const translatedFields = (job.fields || []).filter((field) =>
    String(field.translatedText || "").trim()
  );

  if (!translatedFields.length) {
    return "";
  }

  const count = translatedFields.length;

  return `
    <details class="translation-review">
      <summary>
        <span>View translations (${count})</span>
        <span class="translation-review-hint">Source and translated strings</span>
      </summary>
      <div class="translation-review-toolbar">
        <button
          type="button"
          class="secondary-button"
          data-action="copy-all-translations"
          data-request-id="${escapeAttribute(job.id)}"
        >Copy all translations</button>
      </div>
      <div class="translation-list">
        ${translatedFields.map((field) => renderTranslationRow(job, field)).join("")}
      </div>
    </details>
  `;
}

function renderTranslationRow(job, field) {
  const label = field.fieldLabel || field.label || field.fieldKey || "Custom string";

  return `
    <section class="translation-row">
      <div class="translation-row-header">
        <h3>${escapeHtml(label)}</h3>
        <button
          type="button"
          class="secondary-button translation-copy-button"
          data-action="copy-translation"
          data-request-id="${escapeAttribute(job.id)}"
          data-field-key="${escapeAttribute(field.fieldKey)}"
        >Copy translation</button>
      </div>
      <div class="translation-columns">
        <div class="translation-value">
          <strong>Source</strong>
          <pre>${escapeHtml(field.sourceText || "")}</pre>
        </div>
        <div class="translation-value is-translated">
          <strong>Translation</strong>
          <pre>${escapeHtml(field.translatedText || "")}</pre>
        </div>
      </div>
    </section>
  `;
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

async function copyTranslation(requestId, fieldKey, button) {
  const job = findJob(requestId);
  const field = (job?.fields || []).find((candidate) => candidate.fieldKey === fieldKey);
  const translatedText = String(field?.translatedText || "");

  if (!translatedText.trim()) {
    setStatus("No translated text is available to copy.", "error");
    return;
  }

  try {
    await copyText(translatedText);
    flashButtonLabel(button, "Copied");
    setStatus(`Copied ${field.fieldLabel || field.label || field.fieldKey || "translation"}.`, "success");
  } catch (error) {
    setStatus(error.message || "Could not copy translated text.", "error");
  }
}

async function copyAllTranslations(requestId, button) {
  const job = findJob(requestId);
  const translatedFields = (job?.fields || []).filter((field) =>
    String(field.translatedText || "").trim()
  );

  if (!translatedFields.length) {
    setStatus("No translated text is available to copy.", "error");
    return;
  }

  try {
    await copyText(
      translatedFields
        .map((field) => {
          const label = field.fieldLabel || field.label || field.fieldKey || "Custom string";
          return `${label}\n${field.translatedText}`;
        })
        .join("\n\n")
    );
    flashButtonLabel(button, "Copied");
    setStatus(
      `Copied ${translatedFields.length} translated string${translatedFields.length === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    setStatus(error.message || "Could not copy translated strings.", "error");
  }
}

function findJob(requestId) {
  return allJobs.find((job) => job.id === requestId);
}

async function copyText(value) {
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the textarea path for browsers that reject clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Could not copy translated text.");
  }
}

function flashButtonLabel(button, label) {
  if (!button) {
    return;
  }

  const originalLabel = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = originalLabel;
  }, 1400);
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
