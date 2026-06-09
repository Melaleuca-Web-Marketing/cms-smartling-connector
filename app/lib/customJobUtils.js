export const PROJECTS = {
  us: {
    id: "us",
    label: "US",
    detail: "en-US to Spanish",
    dueBusinessDays: 3,
    sourceLocale: "en-US",
    targetLocales: ["es-US"]
  },
  ca: {
    id: "ca",
    label: "Canada",
    detail: "en-CA to French",
    dueBusinessDays: 3,
    sourceLocale: "en-CA",
    targetLocales: ["fr-CA"]
  },
  eu: {
    id: "eu",
    label: "EU",
    detail: "en-IE to selected languages",
    dueBusinessDays: 5,
    sourceLocale: "en-IE",
    targetLocales: ["nl-NL", "de-DE", "de-AT", "pl-PL", "lt-LT", "it-IT"]
  }
};

export const EU_TARGET_LABELS = {
  "nl-NL": "Netherlands",
  "de-DE": "Germany",
  "de-AT": "Austria",
  "pl-PL": "Poland",
  "lt-LT": "Lithuania",
  "it-IT": "Italy"
};

export function formatCompactDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildDefaultCustomJobName(date = new Date()) {
  return `${formatCompactDate(date)}-Custom`;
}

export function addBusinessDays(date, days) {
  const nextDate = new Date(date);
  let remaining = days;

  while (remaining > 0) {
    nextDate.setDate(nextDate.getDate() + 1);
    const day = nextDate.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return nextDate;
}

export function getDefaultDueDateLocalValue(sourceLocale) {
  const project = Object.values(PROJECTS).find((item) => item.sourceLocale === sourceLocale) || PROJECTS.us;
  const dueDate = addBusinessDays(new Date(), project.dueBusinessDays);
  dueDate.setHours(17, 0, 0, 0);
  return toDatetimeLocalValue(dueDate);
}

export function toDatetimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function toSmartlingDueDateIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function formatDisplayDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function getRoutesForProject({ project, northAmericaPair, selectedEuTargets }) {
  if (northAmericaPair && (project.id === "us" || project.id === "ca")) {
    return [
      { sourceLocale: "en-US", targetLocale: "es-US" },
      { sourceLocale: "en-CA", targetLocale: "fr-CA" }
    ];
  }

  const targetLocales = project.id === "eu" ? selectedEuTargets : project.targetLocales;
  return targetLocales.map((targetLocale) => ({
    sourceLocale: project.sourceLocale,
    targetLocale
  }));
}
