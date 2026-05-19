const DEFAULT_API_BASE_URL = "http://127.0.0.1:17817";

const input = document.getElementById("apiBaseUrl");
const statusElement = document.getElementById("status");
const backendState = document.getElementById("backendState");
const backendDetails = document.getElementById("backendDetails");
const smartlingSummary = document.getElementById("smartlingSummary");

chrome.storage.local.get({ apiBaseUrl: DEFAULT_API_BASE_URL }, (items) => {
  input.value = items.apiBaseUrl || DEFAULT_API_BASE_URL;
});

document.getElementById("save").addEventListener("click", () => {
  const apiBaseUrl = getApiBaseUrl();
  chrome.storage.local.set({ apiBaseUrl }, () => {
    input.value = apiBaseUrl;
    setBackendState("muted", "Not tested", "Backend URL saved. Test the connection when ready.");
    setStatus("Saved backend URL.", "success");
  });
});

document.getElementById("test").addEventListener("click", testBackend);
document.getElementById("checkSmartling").addEventListener("click", checkSmartlingConfig);
document.getElementById("resetPanel").addEventListener("click", resetPanelState);

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
      `${body.service || "Backend"} responded at ${formatTime(body.time)}.`
    );
    setStatus("Backend is reachable.", "success");
  } catch (error) {
    setBackendState("error", "Offline", `Backend test failed: ${error.message}`);
    setStatus(`Backend test failed: ${error.message}`, "error");
  }
}

async function checkSmartlingConfig() {
  const apiBaseUrl = getApiBaseUrl();
  smartlingSummary.innerHTML = '<div class="empty-state">Checking Smartling configuration...</div>';
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
      error.message
    )}</div>`;
    setStatus(`Smartling config check failed: ${error.message}`, "error");
  }
}

function resetPanelState() {
  chrome.storage.local.set(
    {
      smartlingPanelCollapsed: true,
      smartlingPanelTheme: "light",
      smartlingRecentRequestsCollapsed: true
    },
    () => {
      setStatus("Panel state reset. Refresh the CMS page if it is already open.", "success");
    }
  );
}

function renderSmartlingStatus(status) {
  const projects = status.projects || {};
  const rows = [
    renderProjectRow("US", projects.us),
    renderProjectRow("CA", projects.ca),
    renderProjectRow("EU", projects.eu)
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
  const configured = Boolean(project.projectId && project.hasUserIdentifier && project.hasUserSecret);
  const tokenText =
    project.hasUserIdentifier && project.hasUserSecret
      ? "token present"
      : "token incomplete";
  const workflowText = project.workflowId ? "workflow set" : "workflow optional";

  return `
    <div class="project-row">
      <div class="project-key">${escapeHtml(label)}</div>
      <div class="project-details">${escapeHtml(
        project.projectId ? `${project.projectId} | ${tokenText} | ${workflowText}` : "missing project id"
      )}</div>
      <span class="status-pill ${configured ? "is-success" : "is-error"}">${
        configured ? "Ready" : "Missing"
      }</span>
    </div>
  `;
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
  statusElement.className = state === "error" ? "is-error" : state === "success" ? "is-success" : "";
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "now";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
