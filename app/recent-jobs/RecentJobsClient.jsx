"use client";

import { Copy, RefreshCw, RotateCcw, Search, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSmartlingSettings } from "../lib/clientSettings";
import { formatDisplayDate } from "../lib/customJobUtils";

const FAVORITES_STORAGE_KEY = "smartlingRecentJobFavorites";
const FILTERS_STORAGE_KEY = "smartlingRecentJobFilters";
const DEFAULT_LIMIT = 10;
const READY_STATUS_VALUES = new Set(["translations_available", "published"]);
const TARGET_LOCALE_OPTIONS = ["es-US", "fr-CA", "nl-NL", "de-DE", "de-AT", "pl-PL", "lt-LT", "it-IT"];
const STATUS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "submitted_to_smartling", label: "Submitted" },
  { value: "smartling_error", label: "Error" },
  { value: "stored_waiting_for_smartling", label: "Stored" },
  { value: "cancelled", label: "Cancelled" },
  { value: "published", label: "Published" }
];

const DEFAULT_FILTERS = {
  favoritesOnly: false,
  locale: "all",
  query: "",
  sort: "newest",
  status: "ready",
  type: "custom"
};

export function RecentJobsClient() {
  const { apiFetch } = useSmartlingSettings();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [favorites, setFavorites] = useState(new Set());
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState({ tone: "muted", message: "Loading cached jobs..." });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setFavorites(readFavorites());
    setFilters(readFilters());
  }, []);

  const loadJobs = useCallback(
    async ({ forceSync = false, append = false, offsetOverride = 0 } = {}) => {
      setIsLoading(true);
      const offset = append ? offsetOverride : 0;
      setStatus({ tone: "muted", message: forceSync ? "Syncing active Smartling jobs..." : "Loading cached jobs..." });

      try {
        if (forceSync) {
          await apiFetch("/api/translation-requests/sync", {
            method: "POST",
            body: JSON.stringify({
              force: true,
              reason: "dashboard"
            })
          });
        }

        const params = buildQueryParams(filters, favorites, offset);
        if (!params) {
          setJobs([]);
          setTotal(0);
          setHasMore(false);
          setStatus({ tone: "success", message: "No favorite jobs selected yet." });
          return;
        }

        const data = await apiFetch(`/api/jobs?${params.toString()}`);
        const pageJobs = (data.requests || []).map(normalizeJob);
        setJobs((currentJobs) => (append ? [...currentJobs, ...pageJobs] : pageJobs));
        setTotal(Number(data.total) || pageJobs.length);
        setHasMore(data.hasMore === true);
        setStatus({
          tone: "success",
          message: forceSync ? "Smartling sync completed and cached jobs loaded." : "Cached results loaded."
        });
      } catch (error) {
        setJobs([]);
        setHasMore(false);
        setStatus({ tone: "error", message: error.message });
      } finally {
        setIsLoading(false);
      }
    },
    [apiFetch, favorites, filters]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      writeFilters(filters);
      loadJobs();
    }, filters.query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filters, loadJobs]);

  const stats = useMemo(() => {
    const readyCount = filters.status === "ready" ? total : jobs.filter((job) => READY_STATUS_VALUES.has(job.status)).length;
    const customCount = filters.type === "custom" ? total : jobs.filter((job) => job.displayType === "custom").length;
    return {
      total,
      custom: customCount,
      ready: readyCount,
      favorites: favorites.size
    };
  }, [favorites.size, filters.status, filters.type, jobs, total]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  function toggleFavorite(requestId) {
    setFavorites((currentFavorites) => {
      const nextFavorites = new Set(currentFavorites);
      if (nextFavorites.has(requestId)) {
        nextFavorites.delete(requestId);
      } else {
        nextFavorites.add(requestId);
      }
      writeFavorites(nextFavorites);
      return nextFavorites;
    });
  }

  async function syncJob(requestId) {
    setStatus({ tone: "muted", message: "Refreshing Smartling status..." });
    try {
      await apiFetch(`/api/translation-requests/${encodeURIComponent(requestId)}/sync`, {
        method: "POST",
        body: JSON.stringify({ force: true, reason: "manual" })
      });
      await loadJobs();
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    }
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
    setStatus({ tone: "success", message: "Copied translation text." });
  }

  return (
    <main className="grid">
      <section className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4 overflow-auto border-b border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-16 lg:max-h-[calc(100vh-4rem)] lg:min-h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-950">Filters</h2>
            <p className="text-sm font-medium text-slate-500">Defaults prioritize ready custom jobs.</p>
          </div>
          <label className="field-label">
            Search
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={17} />
              <input
                className="field-control w-full pl-9"
                value={filters.query}
                placeholder="Job name, label, locale, Smartling ID"
                type="search"
                onChange={(event) => updateFilter("query", event.target.value)}
              />
            </span>
          </label>
          <SelectFilter label="Type" value={filters.type} onChange={(value) => updateFilter("type", value)}>
            <option value="all">All jobs</option>
            <option value="custom">Custom jobs</option>
            <option value="sku">SKU jobs</option>
          </SelectFilter>
          <SelectFilter label="Status" value={filters.status} onChange={(value) => updateFilter("status", value)}>
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectFilter>
          <SelectFilter label="Target" value={filters.locale} onChange={(value) => updateFilter("locale", value)}>
            <option value="all">All targets</option>
            {TARGET_LOCALE_OPTIONS.map((locale) => (
              <option key={locale} value={locale}>{locale}</option>
            ))}
          </SelectFilter>
          <SelectFilter label="Sort" value={filters.sort} onChange={(value) => updateFilter("sort", value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Job name</option>
            <option value="status">Status</option>
          </SelectFilter>
          <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
            <input
              className="size-4 accent-sky-600"
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(event) => updateFilter("favoritesOnly", event.target.checked)}
            />
            Favorites only
          </label>
          <button type="button" className="btn-secondary" onClick={resetFilters}>
            <RotateCcw className="mr-2" size={16} />
            Reset filters
          </button>
        </aside>

        <section className="grid min-w-0 content-start gap-5 px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-sky-700">Translation dashboard</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-slate-950">Recent Jobs</h1>
              <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">
                Filter, favorite, refresh, and copy translations from submitted Smartling jobs.
              </p>
            </div>
            <button type="button" className="btn-primary" disabled={isLoading} onClick={() => loadJobs({ forceSync: true })}>
              <RefreshCw className="mr-2" size={17} />
              {isLoading ? "Working..." : "Refresh & Sync"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total jobs" value={stats.total} />
            <MetricCard label="Custom jobs" value={stats.custom} />
            <MetricCard label="Ready" value={stats.ready} />
            <MetricCard label="Favorites" value={stats.favorites} />
          </div>
          <StatusLine tone={status.tone} message={status.message} shown={jobs.length} total={total} />
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-950">Jobs</h2>
                <p className="text-sm font-medium text-slate-500">
                  Showing {jobs.length} of {total} {getJobDescription(filters)}.
                </p>
              </div>
            </div>
            <div className="grid gap-3 p-4">
              {jobs.length ? (
                jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    isFavorite={favorites.has(job.id)}
                    onCopy={copyText}
                    onSync={syncJob}
                    onToggleFavorite={toggleFavorite}
                  />
                ))
              ) : (
                <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-500">
                  {isLoading ? "Loading jobs..." : "No jobs match the current filters."}
                </div>
              )}
            </div>
            {hasMore ? (
              <div className="border-t border-slate-200 p-4 text-center">
                <button type="button" className="btn-secondary" disabled={isLoading} onClick={() => loadJobs({ append: true, offsetOverride: jobs.length })}>
                  Load more
                </button>
              </div>
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}

function JobCard({ job, isFavorite, onCopy, onSync, onToggleFavorite }) {
  const translatedFields = (job.fields || []).filter((field) => String(field.translatedText || "").trim());
  const isReady = READY_STATUS_VALUES.has(job.status);

  return (
    <article className={`rounded-xl border p-4 ${isFavorite ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`status-pill ${getStatusClass(job.status)}`}>{getStatusLabel(job.status)}</span>
            <span className="status-pill bg-violet-100 text-violet-800">{job.displayType === "custom" ? "Custom" : "SKU"}</span>
            {job.targetLocale ? <span className="status-pill status-muted">{job.targetLocale}</span> : null}
          </div>
          <h3 className="mt-2 overflow-wrap-anywhere font-display text-base font-bold text-slate-950">{job.jobName || job.id}</h3>
          <p className="mt-1 text-sm font-medium text-slate-500">{getJobSubtitle(job)}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`inline-flex size-10 items-center justify-center rounded-lg border transition ${
              isFavorite ? "border-amber-300 bg-amber-100 text-amber-800" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
            aria-label={isFavorite ? "Remove favorite" : "Favorite job"}
            onClick={() => onToggleFavorite(job.id)}
          >
            <Star size={17} fill={isFavorite ? "currentColor" : "none"} />
          </button>
          {job.status === "submitted_to_smartling" ? (
            <button type="button" className="btn-secondary" onClick={() => onSync(job.id)}>
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 md:grid-cols-4">
        <Info label="Route" value={[job.sourceLocale, job.targetLocale].filter(Boolean).join(" to ") || "Unknown"} />
        <Info label="Created" value={formatDisplayDate(job.createdAt) || "Unknown"} />
        <Info label="Smartling" value={job.smartlingJobUid || "Not submitted"} />
        <Info label="Fields" value={`${job.translatedFieldCount} of ${job.sentFieldCount || job.fieldCount} ready`} />
      </div>

      {job.jobDescription ? (
        <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">
          <span className="font-extrabold">Additional details: </span>
          {job.jobDescription}
        </div>
      ) : null}

      {job.import?.message ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
          {job.import.message}
        </div>
      ) : null}

      {isReady && translatedFields.length ? (
        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-slate-800">
            View translations ({translatedFields.length})
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-3">
            <button
              type="button"
              className="btn-secondary justify-self-start"
              onClick={() => onCopy(translatedFields.map((field) => `${field.fieldLabel || field.label || field.fieldKey}: ${field.translatedText}`).join("\n\n"))}
            >
              <Copy className="mr-2" size={16} />
              Copy all
            </button>
            {translatedFields.map((field) => (
              <div key={field.fieldKey} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-2">
                <TranslationValue label={`${field.fieldLabel || field.label || field.fieldKey} source`} value={field.sourceText} />
                <TranslationValue
                  label="Translation"
                  value={field.translatedText}
                  action={<button type="button" className="text-xs font-extrabold text-sky-700" onClick={() => onCopy(field.translatedText)}>Copy</button>}
                />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function SelectFilter({ children, label, onChange, value }) {
  return (
    <label className="field-label">
      {label}
      <select className="field-control" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-extrabold uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-slate-950">{value}</p>
    </div>
  );
}

function StatusLine({ message, shown, tone, total }) {
  const toneClass = tone === "error" ? "text-red-700" : tone === "success" ? "text-emerald-700" : "text-slate-600";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className={`text-sm font-bold ${toneClass}`}>{message}</span>
      <span className="text-sm font-bold text-slate-500">{shown} loaded / {total} total</span>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="block text-xs font-extrabold uppercase text-slate-400">{label}</span>
      <span className="mt-1 block truncate text-slate-800">{value}</span>
    </div>
  );
}

function TranslationValue({ action, label, value }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-extrabold uppercase text-slate-500">{label}</span>
        {action}
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-sans text-sm font-medium leading-relaxed text-slate-800">{value}</pre>
    </div>
  );
}

function buildQueryParams(filters, favorites, offset) {
  if (filters.favoritesOnly && favorites.size === 0) {
    return null;
  }

  const params = new URLSearchParams({
    limit: String(DEFAULT_LIMIT),
    offset: String(offset),
    sort: filters.sort,
    type: filters.type
  });

  if (filters.status !== "all") params.set("statuses", filters.status);
  if (filters.locale !== "all") params.set("targetLocale", filters.locale);
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.favoritesOnly) params.set("ids", [...favorites].join(","));

  return params;
}

function normalizeJob(request) {
  const fields = Array.isArray(request.fields) ? request.fields : [];
  const type = request.requestType === "custom" ? "custom" : "sku";
  const sentFields = fields.filter((field) => field.sentToSmartling !== false && field.emptySource !== true);
  const translatedFields = fields.filter((field) => String(field.translatedText || "").trim());

  return {
    ...request,
    displayType: type,
    fieldCount: fields.length,
    sentFieldCount: sentFields.length,
    smartlingJobUid: request.smartling?.translationJobUid || "",
    translatedFieldCount: translatedFields.length
  };
}

function getStatusLabel(status) {
  if (READY_STATUS_VALUES.has(status)) return "Ready";
  if (status === "submitted_to_smartling") return "Submitted";
  if (status === "smartling_error") return "Error";
  if (status === "stored_waiting_for_smartling") return "Stored";
  if (status === "cancelled") return "Cancelled";
  return status || "Unknown";
}

function getStatusClass(status) {
  if (READY_STATUS_VALUES.has(status)) return "status-ready";
  if (status === "submitted_to_smartling") return "status-submitted";
  if (status === "smartling_error") return "status-error";
  if (status === "stored_waiting_for_smartling") return "status-stored";
  return "status-muted";
}

function getJobSubtitle(job) {
  if (job.displayType === "custom") {
    return `${job.fieldCount} custom string${job.fieldCount === 1 ? "" : "s"}`;
  }
  return job.sku ? `Product SKU ${job.sku}` : "SKU job";
}

function getJobDescription(filters) {
  const type = filters.type === "custom" ? "custom jobs" : filters.type === "sku" ? "SKU jobs" : "jobs";
  if (filters.status === "ready") return `ready ${type}`;
  if (filters.status !== "all") return `${getStatusLabel(filters.status).toLowerCase()} ${type}`;
  return type;
}

function readFavorites() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeFavorites(favorites) {
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
}

function readFilters() {
  try {
    return normalizeFilters(JSON.parse(window.localStorage.getItem(FILTERS_STORAGE_KEY) || "{}"));
  } catch {
    return DEFAULT_FILTERS;
  }
}

function writeFilters(filters) {
  window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(normalizeFilters(filters)));
}

function normalizeFilters(filters = {}) {
  return {
    favoritesOnly: filters.favoritesOnly === true,
    locale: ["all", ...TARGET_LOCALE_OPTIONS].includes(filters.locale) ? filters.locale : DEFAULT_FILTERS.locale,
    query: String(filters.query || "").slice(0, 250),
    sort: ["newest", "oldest", "name", "status"].includes(filters.sort) ? filters.sort : DEFAULT_FILTERS.sort,
    status: ["all", ...STATUS_OPTIONS.map((option) => option.value)].includes(filters.status) ? filters.status : DEFAULT_FILTERS.status,
    type: ["all", "custom", "sku"].includes(filters.type) ? filters.type : DEFAULT_FILTERS.type
  };
}
