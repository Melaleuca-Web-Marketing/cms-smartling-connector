const DEFAULT_API_BASE_URL = "https://usifhqtsagrqt01.melaleuca.net/cms-smartling";

const MANAGED_FIELDS = new Map([
  ["product name", "productName"],
  ["description (short)", "descriptionShort"]
]);

const ROUTES = [
  {
    id: "us-es",
    sourceCountry: "United States",
    sourceLocale: "en-US",
    targetCountry: "United States",
    targetLocale: "es-US"
  },
  {
    id: "ca-fr",
    sourceCountry: "Canada",
    sourceLocale: "en-CA",
    targetCountry: "Canada",
    targetLocale: "fr-CA"
  },
  {
    id: "eu-nl",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Netherlands",
    targetLocale: "nl-NL"
  },
  {
    id: "eu-de",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Germany",
    targetLocale: "de-DE"
  },
  {
    id: "eu-at",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Austria",
    targetLocale: "de-AT"
  },
  {
    id: "eu-pl",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Poland",
    targetLocale: "pl-PL"
  },
  {
    id: "eu-lt",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Lithuania",
    targetLocale: "lt-LT"
  },
  {
    id: "eu-it",
    sourceCountry: "Ireland",
    sourceLocale: "en-IE",
    targetCountry: "Italy",
    targetLocale: "it-IT"
  }
];

let currentScan = null;
let scanTimer = null;
let apiBaseUrl = DEFAULT_API_BASE_URL;
let ignoreMutationsUntil = 0;
let panelCollapsed = true;
let panelTheme = "light";
let recentRequestsCollapsed = true;
let activePanelSku = null;
let extensionUpdateInfo = null;
let updateCheckStarted = false;
let recentRequestsState = {
  sku: null,
  requests: [],
  loading: false,
  error: null
};

init();

async function init() {
  const settings = await getExtensionSettings();
  apiBaseUrl = settings.apiBaseUrl;
  panelCollapsed = true;
  panelTheme = settings.panelTheme;
  recentRequestsCollapsed = settings.recentRequestsCollapsed;
  checkForExtensionUpdates();
  scheduleScan();

  const observer = new MutationObserver(() => {
    if (Date.now() < ignoreMutationsUntil) {
      return;
    }
    scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function getExtensionSettings() {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve({
        apiBaseUrl: DEFAULT_API_BASE_URL,
        panelTheme: "light",
        recentRequestsCollapsed: true
      });
      return;
    }

    chrome.storage.local.get(
      {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        smartlingPanelTheme: "light",
        smartlingRecentRequestsCollapsed: true
      },
      (items) => {
        resolve({
          apiBaseUrl: items.apiBaseUrl || DEFAULT_API_BASE_URL,
          panelTheme: items.smartlingPanelTheme === "dark" ? "dark" : "light",
          recentRequestsCollapsed: items.smartlingRecentRequestsCollapsed !== false
        });
      }
    );
  });
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanPage, 300);
}

async function scanPage() {
  ignoreCmsMutations(() => {
    clearInlineControls();
  });

  const fields = getTranslatableFields();
  const context = getPageContext(fields);

  if (!isCmsProductPage(context, fields)) {
    ignoreCmsMutations(removePanel);
    return;
  }

  currentScan = {
    context,
    fields
  };

  if (context.sku && context.sku !== activePanelSku) {
    activePanelSku = context.sku;
    panelCollapsed = true;
  }

  ignoreCmsMutations(() => {
    ensurePanel();
    renderPanel(context, fields);
  });

  if (context.mode === "target") {
    await renderTargetTranslations(context, fields);
  }
}

function getPageContext(fields = []) {
  const sku = getSkuFromHeader();
  const country = getCountryFromHeader();
  const localized = getLocalizedProductContext();
  const fieldCulture = getCultureFromFields(fields);
  const activeCulture =
    parseCultureDisplay(localized?.source?.display, localized?.source?.value) ||
    parseCultureDisplay(null, fieldCulture);
  const sourceRoutes = ROUTES.filter(
    (route) =>
      route.sourceLocale === activeCulture?.locale &&
      (!activeCulture.country || route.sourceCountry === activeCulture.country)
  );
  const sourceRoute = sourceRoutes[0] || null;
  const targetRoute = ROUTES.find(
    (route) =>
      route.targetLocale === activeCulture?.locale &&
      (!activeCulture.country || route.targetCountry === activeCulture.country)
  );

  return {
    sku,
    country,
    activeCountry: activeCulture?.country || country,
    activeLocale: activeCulture?.locale || null,
    sourceDisplay: localized?.source?.display || null,
    sourceValue: localized?.source?.value || null,
    mode: sourceRoute ? "source" : targetRoute ? "target" : "unsupported",
    route: sourceRoute || targetRoute || null,
    sourceRoutes
  };
}

function getSkuFromHeader() {
  const header = document.querySelector("header.v-app-bar, header");
  const headingText = [...(header?.querySelectorAll("h1,h2,h3,h4") ?? [])]
    .map((element) => element.textContent.trim())
    .find((text) => /^SKU\s*-/i.test(text));

  const headingSku = headingText?.match(/^SKU\s*-\s*(.+)$/i)?.[1]?.trim();
  if (headingSku) {
    return headingSku;
  }

  const pageHeadingText = [...document.querySelectorAll("h1,h2,h3,h4")]
    .map((element) => element.textContent.trim())
    .find((text) => /\bSKU\s*-\s*\S+/i.test(text));

  return pageHeadingText?.match(/\bSKU\s*-\s*([^\s]+)/i)?.[1]?.trim() ?? null;
}

function getCountryFromHeader() {
  const header = document.querySelector("header.v-app-bar, header");
  const countryLabel = [...(header?.querySelectorAll("label") ?? [])].find(
    (label) => label.textContent.trim() === "Country"
  );

  const selectSlot = countryLabel?.closest(".v-select__slot");
  return (
    selectSlot?.querySelector(".v-select__selection")?.textContent?.trim() ||
    selectSlot?.querySelector('input[type="hidden"]')?.value?.trim() ||
    null
  );
}

function getLocalizedProductContext() {
  const panelHeader = [...document.querySelectorAll(".v-expansion-panel-header")].find(
    (element) => element.textContent.includes("Localized Product Information")
  );

  if (!panelHeader) {
    return null;
  }

  const panelRoot = panelHeader.closest(".v-expansion-panel") || panelHeader;

  return {
    source: getSelectValueByLabel(panelRoot, "Source"),
    destination: getSelectValueByLabel(panelRoot, "Destination")
  };
}

function getSelectValueByLabel(root, labelText) {
  const label = [...root.querySelectorAll("label")].find(
    (candidate) => candidate.textContent.trim() === labelText
  );
  const slot = label?.closest(".v-select__slot");

  return {
    value: slot?.querySelector('input[type="hidden"]')?.value?.trim() || null,
    display: slot?.querySelector(".v-select__selection")?.textContent?.trim() || null
  };
}

function parseCultureDisplay(display, hiddenValue) {
  const locale = hiddenValue || null;
  if (!display && !locale) {
    return null;
  }

  const parts = String(display || "").split("|").map((part) => part.trim());
  return {
    country: parts.length > 1 ? parts[0] : null,
    locale: locale || parts[parts.length - 1] || null
  };
}

function getTranslatableFields() {
  return [...document.querySelectorAll(".left-label-input")]
    .map((row) => {
      const label = normalizeFieldName(
        row.querySelector(".left-label p, #primaryLabel")?.textContent
      );
      const fieldKey = getManagedFieldKey(label);
      const control = row.querySelector(
        ".v-text-field__slot input:not([type='hidden']), .v-text-field__slot textarea"
      );
      const culture = row.querySelector(".v-text-field__slot label")?.textContent?.trim();

      if (!fieldKey || !control) {
        return null;
      }

      return {
        row,
        fieldKey,
        fieldLabel: label,
        culture,
        control,
        value: control.value || ""
      };
    })
    .filter(Boolean);
}

function normalizeFieldName(value) {
  return String(value || "")
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getManagedFieldKey(label) {
  return MANAGED_FIELDS.get(normalizeFieldName(label).toLowerCase()) || null;
}

function getCultureFromFields(fields) {
  const cultures = [...new Set(fields.map((field) => field.culture).filter(Boolean))];
  return cultures.length === 1 ? cultures[0] : null;
}

function ensurePanel() {
  if (document.getElementById("cms-smartling-panel")) {
    applyPanelShellState();
    return;
  }

  const panel = document.createElement("aside");
  panel.id = "cms-smartling-panel";
  panel.innerHTML = `
    <button
      type="button"
      class="cms-smartling-launcher"
      id="cms-smartling-launcher"
      aria-label="Open Smartling panel"
      title="Open Smartling"
    >
      <img class="cms-smartling-logo" src="${escapeAttribute(getLogoUrl())}" alt="">
    </button>
    <div class="cms-smartling-card">
      <div class="cms-smartling-title">
        <div class="cms-smartling-brand">
          <img class="cms-smartling-header-logo" src="${escapeAttribute(getLogoUrl())}" alt="">
          <span>Smartling</span>
        </div>
        <div class="cms-smartling-header-actions">
          <button
            type="button"
            class="cms-smartling-icon-button cms-smartling-theme-toggle"
            id="cms-smartling-theme-toggle"
            aria-label="Toggle dark theme"
            title="Toggle dark theme"
          ></button>
          <button
            type="button"
            class="cms-smartling-icon-button cms-smartling-collapse"
            id="cms-smartling-collapse"
            aria-label="Collapse Smartling panel"
            title="Collapse"
          ></button>
        </div>
      </div>
      <div class="cms-smartling-update-slot" id="cms-smartling-update-slot" hidden></div>
      <div class="cms-smartling-body">Scanning CMS fields...</div>
    </div>
  `;
  document.body.append(panel);
  panel
    .querySelector("#cms-smartling-launcher")
    ?.addEventListener("click", () => setPanelCollapsed(false));
  panel
    .querySelector("#cms-smartling-collapse")
    ?.addEventListener("click", () => setPanelCollapsed(true));
  panel
    .querySelector("#cms-smartling-theme-toggle")
    ?.addEventListener("click", togglePanelTheme);
  applyPanelShellState();
}

function removePanel() {
  document.getElementById("cms-smartling-panel")?.remove();
}

function setPanelCollapsed(collapsed) {
  panelCollapsed = collapsed;
  applyPanelShellState();
  renderExtensionUpdateBanner();
}

function togglePanelTheme() {
  panelTheme = panelTheme === "dark" ? "light" : "dark";
  applyPanelShellState();
  savePanelSetting({ smartlingPanelTheme: panelTheme });
}

function savePanelSetting(values) {
  if (!globalThis.chrome?.storage?.local) {
    return;
  }
  chrome.storage.local.set(values);
}

function applyPanelShellState() {
  const panel = document.getElementById("cms-smartling-panel");
  if (!panel) return;

  panel.dataset.theme = panelTheme;
  panel.classList.toggle("is-collapsed", panelCollapsed);

  const themeToggle = panel.querySelector("#cms-smartling-theme-toggle");
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(panelTheme === "dark"));
    themeToggle.title = panelTheme === "dark" ? "Use light theme" : "Use dark theme";
    themeToggle.setAttribute(
      "aria-label",
      panelTheme === "dark" ? "Use light theme" : "Use dark theme"
    );
  }
}

async function checkForExtensionUpdates() {
  if (updateCheckStarted || !globalThis.SmartlingVersionCheck) {
    return;
  }

  updateCheckStarted = true;

  try {
    extensionUpdateInfo = await SmartlingVersionCheck.check(apiBaseUrl);
  } catch {
    extensionUpdateInfo = null;
  }

  renderExtensionUpdateBanner();
}

function renderExtensionUpdateBanner() {
  const slot = document.getElementById("cms-smartling-update-slot");
  if (!slot) return;

  if (!extensionUpdateInfo?.isUpdateAvailable) {
    slot.hidden = true;
    slot.innerHTML = "";
    return;
  }

  slot.hidden = false;
  slot.innerHTML = `
    <div class="cms-smartling-update-banner">
      <div>
        <strong>Update available</strong>
        <span>Version ${escapeHtml(extensionUpdateInfo.latestVersion)} is available. You are using ${escapeHtml(
          extensionUpdateInfo.currentVersion
        )}.</span>
      </div>
      <a href="${escapeAttribute(
        extensionUpdateInfo.downloadPageUrl
      )}" target="_blank" rel="noopener noreferrer">Download update</a>
    </div>
  `;
}

function getLogoUrl() {
  if (globalThis.chrome?.runtime?.getURL) {
    return chrome.runtime.getURL("smartling_logo.png");
  }
  return "smartling_logo.png";
}

function isCmsProductPage(context, fields) {
  return Boolean(
    context.sku ||
      context.activeLocale ||
      fields.length ||
      document.body?.textContent?.includes("Localized Product Information")
  );
}

function renderPanel(context, fields) {
  const panel = document.getElementById("cms-smartling-panel");
  if (!panel) return;

  const body = panel.querySelector(".cms-smartling-body");
  const ready = Boolean(context.sku && context.activeLocale && fields.length);

  if (!ready) {
    const foundFields = fields.map((field) => `${field.fieldLabel} (${field.culture || "?"})`);
    body.innerHTML = `
      <div class="cms-smartling-status">Waiting for SKU, culture, and managed fields.</div>
      <dl class="cms-smartling-diagnostics">
        <div><dt>SKU</dt><dd>${context.sku ? escapeHtml(context.sku) : "missing"}</dd></div>
        <div><dt>Culture</dt><dd>${context.activeLocale ? escapeHtml(context.activeLocale) : "missing"}</dd></div>
        <div><dt>Fields</dt><dd>${
          foundFields.length ? escapeHtml(foundFields.join(", ")) : "missing"
        }</dd></div>
      </dl>
    `;
    return;
  }

  if (context.mode === "source") {
    const panelState = getSourcePanelState(context, fields);
    body.innerHTML = `
      <div class="cms-smartling-summary">
        <span>SKU ${escapeHtml(context.sku)}</span>
        <span>${escapeHtml(context.activeLocale)} to ${escapeHtml(
          getTargetSummary(context.sourceRoutes)
        )}</span>
      </div>
      ${renderTargetLocaleOptions(context, panelState)}
      <div class="cms-smartling-form-row">
        <label class="cms-smartling-label" for="cms-smartling-job-name">Job name</label>
        <input
          class="cms-smartling-input"
          id="cms-smartling-job-name"
          type="text"
          spellcheck="false"
          value="${escapeAttribute(panelState.jobName)}"
        >
      </div>
      <div class="cms-smartling-form-row">
        <label class="cms-smartling-label" for="cms-smartling-due-date">Job due date</label>
        <input
          class="cms-smartling-input"
          id="cms-smartling-due-date"
          type="datetime-local"
          value="${escapeAttribute(panelState.jobDueDateLocal)}"
          required
        >
      </div>
      <label class="cms-smartling-checkrow" for="cms-smartling-authorize-job">
        <input id="cms-smartling-authorize-job" type="checkbox" ${
          panelState.authorizeJob ? "checked" : ""
        }>
        <span>Authorize job after submission</span>
      </label>
      <div class="cms-smartling-field-list">
        ${fields
          .map((field) => renderSourceFieldOption(field, panelState.selectedFields))
          .join("")}
      </div>
      <div class="cms-smartling-recent" id="cms-smartling-recent">
        ${renderRecentRequests(context)}
      </div>
      <button type="button" class="cms-smartling-primary" id="cms-smartling-submit">
        Send to Smartling
      </button>
      <div class="cms-smartling-status" id="cms-smartling-status"></div>
    `;
    body.dataset.requestContext = getRequestContextKey(context);
    body.querySelector("#cms-smartling-submit")?.addEventListener("click", submitSourceFields);
    loadRecentRequests(context);
    return;
  }

  if (context.mode === "target") {
    body.innerHTML = `
      <div class="cms-smartling-meta">SKU ${escapeHtml(context.sku)} | ${escapeHtml(
        context.activeLocale
      )}</div>
      <button type="button" class="cms-smartling-secondary" id="cms-smartling-refresh">
        Refresh translations
      </button>
      <div class="cms-smartling-status" id="cms-smartling-status">Checking staged translations...</div>
    `;
    body.querySelector("#cms-smartling-refresh")?.addEventListener("click", () => {
      renderTargetTranslations(context, fields);
    });
    return;
  }

  body.innerHTML = `
    <div class="cms-smartling-meta">SKU ${escapeHtml(context.sku)} | ${escapeHtml(
      context.activeLocale || "unknown"
    )}</div>
    <div class="cms-smartling-status">This culture is not managed by the CMS Smartling workflow.</div>
  `;
}

async function submitSourceFields() {
  const status = document.getElementById("cms-smartling-status");
  const { context, fields } = currentScan || {};

  if (!context || !fields) {
    return;
  }

  const selectedFieldKeys = new Set(
    [...document.querySelectorAll(".cms-smartling-field-check:checked")].map(
      (input) => input.dataset.fieldKey
    )
  );
  const selectedFields = fields.filter((field) => selectedFieldKeys.has(field.fieldKey));

  if (!selectedFields.length) {
    setStatus(status, "Select at least one field before submitting.", true);
    return;
  }

  if (!selectedFields.some((field) => field.control.value.trim())) {
    setStatus(status, "At least one selected field must have source text.", true);
    return;
  }

  try {
    const jobName = document.getElementById("cms-smartling-job-name")?.value.trim();
    const jobDueDateLocal = document.getElementById("cms-smartling-due-date")?.value.trim();
    const jobDueDate = toSmartlingDueDateIso(jobDueDateLocal);
    const authorizeJob =
      document.getElementById("cms-smartling-authorize-job")?.checked === true;
    const selectedRoutes = getSelectedTargetRoutes(context);

    if (!jobDueDate) {
      setStatus(status, "Select a valid job due date before submitting.", true);
      return;
    }

    if (!selectedRoutes.length) {
      setStatus(status, "Select at least one target locale before submitting.", true);
      return;
    }

    const duplicateRoutes = getDuplicateSubmittedRoutes(context, selectedRoutes);
    if (duplicateRoutes.length) {
      const duplicateSummary = duplicateRoutes
        .map((route) => `${route.targetCountry} | ${route.targetLocale}`)
        .join(", ");
      const proceed = confirm(
        `This SKU already has submitted Smartling request(s) for: ${duplicateSummary}.\n\nSubmit again anyway?`
      );

      if (!proceed) {
        setStatus(status, "Submission cancelled. Existing request was left unchanged.");
        return;
      }
    }

    setStatus(status, "Submitting request...");

    const responses = [];
    for (const route of selectedRoutes) {
      responses.push(
        await apiFetch("/api/translation-requests", {
          method: "POST",
          body: JSON.stringify({
            sku: context.sku,
            country: route.sourceCountry,
            sourceLocale: route.sourceLocale,
            targetLocale: route.targetLocale,
            jobName,
            jobDueDate,
            authorizeJob,
            fields: selectedFields.map((field) => ({
              fieldKey: field.fieldKey,
              fieldLabel: field.fieldLabel,
              value: field.control.value || ""
            }))
          })
        })
      );
    }

    setStatus(
      status,
      responses.length === 1
        ? getSubmitStatusMessage(responses[0].request)
        : getMultiSubmitStatusMessage(responses.map((response) => response.request))
    );
    await refreshRecentRequests(context);
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

function getSubmitStatusMessage(request) {
  const mode = request.smartling?.mode;
  const target = request.targetLocale;

  if (mode === "not_configured") {
    return `Stored locally for ${target}. Smartling API calls are disabled in backend configuration.`;
  }

  if (mode === "not_implemented") {
    return `Stored locally for ${target}. Smartling API adapter is not wired yet.`;
  }

  if (mode === "config_error" || mode === "validation_error" || mode === "error") {
    return `Stored locally for ${target}. Smartling submission failed: ${request.smartling?.message || "check backend request details"}`;
  }

  if (request.status === "submitted_to_smartling") {
    const jobUid = request.smartling?.translationJobUid;
    const batchUid = request.smartling?.batchUid;
    const ids = jobUid || batchUid ? ` Job ${jobUid || "created"}${batchUid ? `, batch ${batchUid}` : ""}.` : "";
    return `Submitted to Smartling for ${target}.${ids}`;
  }

  return `Stored request ${request.id}. Target: ${target}.`;
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

function getDuplicateSubmittedRoutes(context, selectedRoutes) {
  const sourceLocale = context.route?.sourceLocale;
  const existingTargets = new Set(
    getRelevantRecentRequests(context)
      .filter((request) => request.status === "submitted_to_smartling")
      .filter((request) => request.sourceLocale === sourceLocale)
      .map((request) => request.targetLocale)
  );

  return selectedRoutes.filter((route) => existingTargets.has(route.targetLocale));
}

function getSelectedTargetRoutes(context) {
  const routes = context.sourceRoutes?.length ? context.sourceRoutes : [context.route];
  if (routes.length === 1) {
    return routes;
  }

  const selectedTargetLocales = new Set(
    [...document.querySelectorAll(".cms-smartling-target-check:checked")].map(
      (input) => input.dataset.targetLocale
    )
  );

  return routes.filter((route) => selectedTargetLocales.has(route.targetLocale));
}

function getSourcePanelState(context, fields) {
  const body = document.querySelector("#cms-smartling-panel .cms-smartling-body");
  const existingContext = body?.dataset.requestContext;
  const sameContext = existingContext === getRequestContextKey(context);
  const selectedFields = {};
  const selectedTargetLocales = {};

  for (const field of fields) {
    const existingCheck = document.querySelector(
      `.cms-smartling-field-check[data-field-key="${field.fieldKey}"]`
    );
    selectedFields[field.fieldKey] =
      sameContext && existingCheck ? existingCheck.checked : Boolean(field.control.value.trim());
  }

  const routes = context.sourceRoutes?.length ? context.sourceRoutes : [context.route];
  for (const route of routes) {
    const existingCheck = document.querySelector(
      `.cms-smartling-target-check[data-target-locale="${route.targetLocale}"]`
    );
    selectedTargetLocales[route.targetLocale] = sameContext && existingCheck
      ? existingCheck.checked
      : true;
  }

  return {
    jobName:
      sameContext && document.getElementById("cms-smartling-job-name")?.value.trim()
        ? document.getElementById("cms-smartling-job-name").value.trim()
        : buildDefaultJobName(context),
    jobDueDateLocal:
      sameContext && document.getElementById("cms-smartling-due-date")?.value
        ? document.getElementById("cms-smartling-due-date").value
        : getDefaultDueDateLocalValue(context),
    authorizeJob:
      sameContext && document.getElementById("cms-smartling-authorize-job")?.checked === true,
    selectedFields,
    selectedTargetLocales
  };
}

function renderTargetLocaleOptions(context, panelState) {
  const routes = context.sourceRoutes?.length ? context.sourceRoutes : [context.route];
  if (routes.length <= 1) {
    return "";
  }

  return `
    <div class="cms-smartling-targets">
      <div class="cms-smartling-section-label">Target locales</div>
      <div class="cms-smartling-target-grid">
        ${routes
          .map(
            (route) => `
              <label class="cms-smartling-target-option">
                <input
                  class="cms-smartling-target-check"
                  type="checkbox"
                  data-target-locale="${escapeAttribute(route.targetLocale)}"
                  ${panelState.selectedTargetLocales[route.targetLocale] ? "checked" : ""}
                >
                <span>${escapeHtml(route.targetCountry)} | ${escapeHtml(route.targetLocale)}</span>
              </label>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderSourceFieldOption(field, selectedFields) {
  const value = field.control.value || "";
  const hasText = Boolean(value.trim());
  const checked = selectedFields[field.fieldKey] && hasText;

  return `
    <label class="cms-smartling-field-option">
      <input
        class="cms-smartling-field-check"
        type="checkbox"
        data-field-key="${escapeAttribute(field.fieldKey)}"
        ${checked ? "checked" : ""}
        ${hasText ? "" : "disabled"}
      >
      <span class="cms-smartling-field-copy">
        <span class="cms-smartling-field-name">${escapeHtml(field.fieldLabel)}</span>
        <span class="cms-smartling-field-value ${
          hasText ? "" : "cms-smartling-empty"
        }">${escapeHtml(hasText ? value : "Blank; not sent")}</span>
      </span>
    </label>
  `;
}

function renderRecentRequests(context) {
  if (recentRequestsState.sku !== context.sku || recentRequestsState.loading) {
    return `
      ${renderRecentRequestsHeader(null)}
      ${recentRequestsCollapsed ? "" : '<div class="cms-smartling-recent-empty">Checking this SKU...</div>'}
    `;
  }

  if (recentRequestsState.error) {
    return `
      ${renderRecentRequestsHeader(null, "Retry")}
      ${
        recentRequestsCollapsed
          ? ""
          : `<div class="cms-smartling-recent-empty cms-smartling-error">${escapeHtml(
              recentRequestsState.error
            )}</div>`
      }
    `;
  }

  const allRequests = getRelevantRecentRequests(context);
  const requests = getVisibleRecentRequests(context, allRequests);
  const hiddenCount = allRequests.length - requests.length;
  const count = requests.length;

  if (!requests.length) {
    return `
      ${renderRecentRequestsHeader(count)}
      ${
        recentRequestsCollapsed
          ? ""
          : '<div class="cms-smartling-recent-empty">No requests found for this SKU and source culture.</div>'
      }
    `;
  }

  return `
    ${renderRecentRequestsHeader(count)}
    ${
      recentRequestsCollapsed
        ? ""
        : `<div class="cms-smartling-request-list">
            ${requests.slice(0, 5).map(renderRecentRequestItem).join("")}
            ${
              hiddenCount > 0
                ? `<div class="cms-smartling-recent-empty">${hiddenCount} older request${
                    hiddenCount === 1 ? "" : "s"
                  } hidden for this SKU and source culture.</div>`
                : ""
            }
          </div>`
    }
  `;
}

function renderRecentRequestsHeader(count, refreshText = "Refresh") {
  const countText = typeof count === "number" ? ` (${count})` : "";
  return `
    <div class="cms-smartling-section-header cms-smartling-recent-header">
      <button
        type="button"
        class="cms-smartling-disclosure"
        id="cms-smartling-toggle-recent"
        aria-expanded="${recentRequestsCollapsed ? "false" : "true"}"
      >
        <span class="cms-smartling-disclosure-icon"></span>
        <span>Recent requests${countText}</span>
      </button>
      ${
        recentRequestsCollapsed
          ? ""
          : `<button type="button" class="cms-smartling-text-button" id="cms-smartling-refresh-requests">${escapeHtml(
              refreshText
            )}</button>`
      }
    </div>
  `;
}

function renderRecentRequestItem(request) {
  return `
    <div class="cms-smartling-request-item">
      <div class="cms-smartling-request-main">
        <span class="cms-smartling-status-pill ${escapeAttribute(
          getRequestStatusClass(request)
        )}">${escapeHtml(getRequestStatusLabel(request))}</span>
        <span class="cms-smartling-request-locale">${escapeHtml(
          request.targetLocale || "unknown"
        )}</span>
      </div>
      <div class="cms-smartling-request-name">${escapeHtml(request.jobName || request.id)}</div>
      <div class="cms-smartling-request-meta">${escapeHtml(formatRequestDate(request.createdAt))}${
        request.smartling?.translationJobUid
          ? ` | Job ${escapeHtml(request.smartling.translationJobUid)}`
          : ""
      }</div>
      ${
        request.jobDueDate
          ? `<div class="cms-smartling-request-meta">Due ${escapeHtml(
              formatRequestDate(request.jobDueDate)
            )}</div>`
          : ""
      }
      ${renderRecentRequestFeedback(request)}
      ${renderRecentRequestActions(request)}
    </div>
  `;
}

function renderRecentRequestFeedback(request) {
  const feedback = getRecentRequestFeedback(request);

  if (!feedback) {
    return "";
  }

  return `<div class="cms-smartling-request-feedback ${escapeAttribute(
    feedback.className
  )}">
    <div class="cms-smartling-request-feedback-topline">
      <div class="cms-smartling-request-feedback-message">${escapeHtml(feedback.message)}</div>
      ${renderRequestProgressBadge(feedback.progressPercent)}
    </div>
    ${renderRequestFieldProgress(request, feedback)}
  </div>`;
}

function getRecentRequestFeedback(request) {
  const importState = request.import;

  if (!importState) {
    return null;
  }

  if (importState.mode === "not_ready") {
    const checkedText = request.updatedAt ? `Checked ${formatRequestDate(request.updatedAt)}. ` : "";
    const counts = getImportProgressCounts(importState.fileStatus);
    const countsText = counts ? ` ${counts.completed} of ${counts.total} strings complete.` : "";
    const progressPercent = getProgressPercent(importState.progressPercent);

    return {
      className: "is-info",
      message: `${checkedText}Not ready.${countsText}`,
      progressPercent
    };
  }

  if (importState.mode === "downloaded") {
    return {
      className: "is-success",
      message: importState.message || "Translations were staged for insertion.",
      progressPercent: 100
    };
  }

  if (
    request.status === "smartling_error" ||
    ["config_error", "validation_error", "error"].includes(importState.mode)
  ) {
    return {
      className: "is-error",
      message: importState.message || "Smartling check failed."
    };
  }

  if (importState.message && importState.mode !== "cleared_premature_import") {
    return {
      className: "is-info",
      message: importState.message
    };
  }

  return null;
}

function renderRequestProgressBadge(progressPercent) {
  if (!Number.isFinite(progressPercent)) {
    return "";
  }

  const percent = Math.max(0, Math.min(100, Math.round(progressPercent)));

  return `<span
    class="cms-smartling-request-progress-badge"
    role="progressbar"
    aria-label="Translation progress"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow="${percent}"
  >${percent}%</span>`;
}

function renderRequestFieldProgress(request, feedback) {
  const fields = (request.fields || []).filter((field) => field.sentToSmartling !== false);

  if (!fields.length) {
    return "";
  }

  return `
    <div class="cms-smartling-request-field-progress">
      ${fields
        .map((field) => {
          const state = getFieldProgressState(request, feedback);
          return `
            <span class="cms-smartling-field-progress-pill ${escapeAttribute(state.className)}">
              <span class="cms-smartling-field-progress-name">${escapeHtml(
                field.fieldLabel || field.fieldKey
              )}</span>
              <span class="cms-smartling-field-progress-state">${escapeHtml(state.label)}</span>
            </span>
          `;
        })
        .join("")}
    </div>
  `;
}

function getFieldProgressState(request, feedback) {
  if (request.status === "translations_available" || feedback.progressPercent >= 100) {
    return {
      className: "is-ready",
      label: "Ready"
    };
  }

  if (request.status === "smartling_error" || feedback.className === "is-error") {
    return {
      className: "is-error",
      label: "Check failed"
    };
  }

  if (feedback.progressPercent > 0) {
    return {
      className: "is-progress",
      label: "In progress"
    };
  }

  return {
    className: "is-pending",
    label: "Pending"
  };
}

function getProgressPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getImportProgressCounts(fileStatus) {
  const completed = Number(fileStatus?.completedStringCount);
  const total = Number(fileStatus?.totalStringCount);

  if (!Number.isFinite(completed) || !Number.isFinite(total)) {
    return null;
  }

  return {
    completed,
    total
  };
}

function renderRecentRequestActions(request) {
  if (request.status === "submitted_to_smartling") {
    return `
      <div class="cms-smartling-request-actions">
        <button
          type="button"
          class="cms-smartling-small-button"
          data-action="import-translations"
          data-request-id="${escapeAttribute(request.id)}"
        >
          Check translations
        </button>
      </div>
    `;
  }

  if (request.status === "translations_available") {
    return `
      <div class="cms-smartling-request-actions">
        <span class="cms-smartling-request-hint">Translations staged for insertion.</span>
      </div>
    `;
  }

  return "";
}

function getRelevantRecentRequests(context) {
  const routeTargets = new Set(
    (context.sourceRoutes?.length ? context.sourceRoutes : [context.route])
      .filter(Boolean)
      .map((route) => route.targetLocale)
  );

  return recentRequestsState.requests
    .filter((request) => request.sourceLocale === context.route?.sourceLocale)
    .filter((request) => routeTargets.has(request.targetLocale))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getVisibleRecentRequests(context, requests = getRelevantRecentRequests(context)) {
  const byLocale = new Map();

  for (const request of requests) {
    const key = request.targetLocale || "unknown";
    const current = byLocale.get(key);

    if (!current || compareRequestVisibility(request, current) < 0) {
      byLocale.set(key, request);
    }
  }

  return Array.from(byLocale.values()).sort(compareRequestVisibility);
}

function compareRequestVisibility(a, b) {
  const priorityDelta = getRequestVisibilityPriority(b) - getRequestVisibilityPriority(a);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function getRequestVisibilityPriority(request) {
  if (request.status === "translations_available") return 5;
  if (request.status === "submitted_to_smartling") return 4;
  if (request.status === "smartling_error") return 3;
  if (request.smartling?.mode === "not_configured") return 1;
  return 2;
}

function getRequestStatusLabel(request) {
  if (request.status === "translations_available") return "Ready";
  if (request.status === "submitted_to_smartling") return "Submitted";
  if (request.status === "smartling_error") return "Error";
  if (request.smartling?.mode === "not_configured") return "Local";
  return "Stored";
}

function getRequestStatusClass(request) {
  if (request.status === "translations_available") return "is-ready";
  if (request.status === "submitted_to_smartling") return "is-success";
  if (request.status === "smartling_error") return "is-error";
  if (request.smartling?.mode === "not_configured") return "is-muted";
  return "is-warning";
}

function formatRequestDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadRecentRequests(context) {
  if (!context.sku) {
    return;
  }

  if (recentRequestsState.sku === context.sku && recentRequestsState.requests.length) {
    wireRecentRequestActions(context);
    return;
  }

  await refreshRecentRequests(context);
}

async function refreshRecentRequests(context) {
  const recentElement = document.getElementById("cms-smartling-recent");
  recentRequestsState = {
    sku: context.sku,
    requests: recentRequestsState.sku === context.sku ? recentRequestsState.requests : [],
    loading: true,
    error: null
  };
  if (recentElement) {
    recentElement.innerHTML = renderRecentRequests(context);
  }

  try {
    const response = await apiFetch(
      `/api/translation-requests?sku=${encodeURIComponent(context.sku)}`
    );
    recentRequestsState = {
      sku: context.sku,
      requests: response.requests || [],
      loading: false,
      error: null
    };
  } catch (error) {
    recentRequestsState = {
      sku: context.sku,
      requests: [],
      loading: false,
      error: error.message
    };
  }

  const nextRecentElement = document.getElementById("cms-smartling-recent");
  if (nextRecentElement) {
    nextRecentElement.innerHTML = renderRecentRequests(context);
    wireRecentRequestActions(context);
  }
}

function wireRecentRequestActions(context) {
  document.getElementById("cms-smartling-toggle-recent")?.addEventListener("click", () => {
    recentRequestsCollapsed = !recentRequestsCollapsed;
    savePanelSetting({ smartlingRecentRequestsCollapsed: recentRequestsCollapsed });
    const recentElement = document.getElementById("cms-smartling-recent");
    if (recentElement) {
      recentElement.innerHTML = renderRecentRequests(context);
      wireRecentRequestActions(context);
    }

    if (!recentRequestsCollapsed && recentRequestsState.sku !== context.sku) {
      refreshRecentRequests(context);
    }
  });

  document.getElementById("cms-smartling-refresh-requests")?.addEventListener("click", () => {
    refreshRecentRequests(context);
  });

  document.querySelectorAll('[data-action="import-translations"]').forEach((button) => {
    button.addEventListener("click", () => importTranslationsForRequest(context, button));
  });
}

async function importTranslationsForRequest(context, button) {
  const requestId = button.dataset.requestId;
  const status = document.getElementById("cms-smartling-status");
  const requestItem = button.closest(".cms-smartling-request-item");
  if (!requestId) return;

  button.disabled = true;
  button.textContent = "Checking...";
  setRequestCardFeedback(requestItem, "Checking Smartling for published translations...");
  setStatus(status, "Checking Smartling for published translations...");

  try {
    const response = await apiFetch(
      `/api/translation-requests/${encodeURIComponent(requestId)}/import-translations`,
      {
        method: "POST"
      }
    );

    if (response.request.status === "translations_available") {
      setStatus(
        status,
        `Imported ${response.translations.length} translation${response.translations.length === 1 ? "" : "s"} for ${response.request.targetLocale}. Switch to that culture to insert.`
      );
    } else if (response.request.import?.mode === "not_ready") {
      setStatus(
        status,
        `Translations are not ready yet for ${response.request.targetLocale}. Progress: ${response.request.import.progressPercent ?? 0}%.`
      );
    } else {
      setStatus(
        status,
        response.request.import?.message ||
          response.request.smartling?.message ||
          "Translations were not imported yet.",
        true
      );
    }

    await refreshRecentRequests(context);
  } catch (error) {
    setRequestCardFeedback(requestItem, error.message, true);
    setStatus(status, error.message, true);
    button.disabled = false;
    button.textContent = "Check translations";
  }
}

function setRequestCardFeedback(requestItem, message, isError = false) {
  if (!requestItem) {
    return;
  }

  let feedback = requestItem.querySelector(".cms-smartling-request-feedback");
  if (!feedback) {
    feedback = document.createElement("div");
    const actions = requestItem.querySelector(".cms-smartling-request-actions");
    requestItem.insertBefore(feedback, actions || null);
  }

  feedback.className = `cms-smartling-request-feedback ${isError ? "is-error" : "is-info"}`;
  feedback.textContent = message;
}

function buildDefaultJobName(context) {
  return `${formatCompactDate()}-${formatSkuForJobName(context.sku)}-skutranslations`;
}

function getDefaultDueDateLocalValue(context) {
  const dueDate = addBusinessDays(new Date(), getDueDateBusinessDays(context));
  dueDate.setHours(17, 0, 0, 0);
  return toDateTimeLocalValue(dueDate);
}

function getDueDateBusinessDays(context) {
  const sourceLocale = context.sourceRoutes?.[0]?.sourceLocale || context.route?.sourceLocale;
  return sourceLocale === "en-IE" ? 5 : 3;
}

function addBusinessDays(startDate, businessDays) {
  const date = new Date(startDate);
  let remaining = businessDays;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (isBusinessDay(date)) {
      remaining -= 1;
    }
  }

  return date;
}

function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
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
  if (!localValue) {
    return null;
  }

  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getTargetSummary(routes = []) {
  if (!routes.length) {
    return "unknown";
  }

  if (routes.length === 1) {
    return routes[0].targetLocale;
  }

  return `${routes.length} locales`;
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

function getRequestContextKey(context) {
  return [context.sku, context.activeLocale, context.route?.targetLocale].join("|");
}

async function renderTargetTranslations(context, fields) {
  const status = document.getElementById("cms-smartling-status");
  clearInlineControls();

  try {
    const response = await apiFetch(
      `/api/translations?sku=${encodeURIComponent(context.sku)}&targetLocale=${encodeURIComponent(
        context.activeLocale
      )}`
    );
    const translationsByField = new Map(
      response.translations.map((translation) => [translation.fieldKey, translation])
    );

    let count = 0;
    for (const field of fields) {
      const translation = translationsByField.get(field.fieldKey);
      if (!translation) continue;
      addInlineInsertControl(field, translation, context);
      count += 1;
    }

    setStatus(
      status,
      count
        ? `${count} staged translation${count === 1 ? "" : "s"} available.`
        : "No staged translations found for this SKU and culture."
    );
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

function addInlineInsertControl(field, translation, context) {
  const host = field.row.querySelector(".right-input") || field.row;
  const container = document.createElement("div");
  container.className = "cms-smartling-inline";
  container.innerHTML = `
    <div class="cms-smartling-preview">${escapeHtml(translation.translatedText)}</div>
    <button type="button" class="cms-smartling-insert">Insert translation</button>
  `;

  container.querySelector(".cms-smartling-insert").addEventListener("click", async () => {
    const existingValue = field.control.value.trim();
    if (
      existingValue &&
      existingValue !== translation.translatedText.trim() &&
      !confirm("This field already has content. Replace it with the Smartling translation?")
    ) {
      return;
    }

    setCmsFieldValue(field.control, translation.translatedText);
    await apiFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({
        type: "translation_inserted",
        sku: context.sku,
        targetLocale: context.activeLocale,
        fieldKey: field.fieldKey,
        translationId: translation.id
      })
    }).catch(() => {});
  });

  ignoreCmsMutations(() => {
    host.append(container);
  });
}

function ignoreCmsMutations(callback) {
  ignoreMutationsUntil = Date.now() + 500;
  return callback();
}

function clearInlineControls() {
  document.querySelectorAll(".cms-smartling-inline").forEach((element) => element.remove());
}

function getFieldByKey(fields, fieldKey) {
  return fields.find((field) => field.fieldKey === fieldKey);
}

function setCmsFieldValue(control, value) {
  const proto =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if (setter) {
    setter.call(control, value);
  } else {
    control.value = value;
  }

  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new Event("blur", { bubbles: true }));
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || `Backend request failed: ${response.status}`);
  }

  return data;
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("cms-smartling-error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
