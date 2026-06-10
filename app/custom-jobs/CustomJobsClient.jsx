"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSmartlingSettings } from "../lib/clientSettings";
import {
  EU_TARGET_LABELS,
  PROJECTS,
  buildDefaultCustomJobName,
  getDefaultDueDateLocalValue,
  getRoutesForProject,
  toSmartlingDueDateIso
} from "../lib/customJobUtils";

const CUSTOM_DRAFT_STORAGE_KEY = "smartlingStandaloneCustomJobDraft";
const INITIAL_ROW = { label: "", value: "" };
const PROJECT_NAV_LABELS = {
  ca: "Canada",
  eu: "EU",
  us: "US"
};

export function CustomJobsClient() {
  const { apiFetch, getAuthHeaders, settings } = useSmartlingSettings();
  const [projectId, setProjectId] = useState("us");
  const [jobName, setJobName] = useState("");
  const [jobDueDate, setJobDueDate] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [authorizeJob, setAuthorizeJob] = useState(true);
  const [northAmericaPair, setNorthAmericaPair] = useState(false);
  const [selectedEuTargets, setSelectedEuTargets] = useState(PROJECTS.eu.targetLocales);
  const [rows, setRows] = useState([INITIAL_ROW]);
  const [status, setStatus] = useState({ tone: "muted", message: "" });
  const [submittedSignature, setSubmittedSignature] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const project = PROJECTS[projectId] || PROJECTS.us;

  useEffect(() => {
    const draft = readDraft();
    const nextProject = PROJECTS[draft.project] || PROJECTS.us;
    setProjectId(nextProject.id);
    setJobName(draft.jobName || buildDefaultCustomJobName());
    setJobDueDate(draft.jobDueDateLocal || getDefaultDueDateLocalValue(nextProject.sourceLocale));
    setJobDescription(draft.jobDescription || "");
    setAuthorizeJob(typeof draft.authorizeJob === "boolean" ? draft.authorizeJob : getDefaultAuthorizeJob(nextProject.id));
    setNorthAmericaPair(draft.northAmericaPair === true);
    setSelectedEuTargets(Array.isArray(draft.euTargets) && draft.euTargets.length ? draft.euTargets : PROJECTS.eu.targetLocales);
    setRows(Array.isArray(draft.rows) && draft.rows.length ? draft.rows : [INITIAL_ROW]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(
        CUSTOM_DRAFT_STORAGE_KEY,
        JSON.stringify({
          authorizeJob,
          euTargets: selectedEuTargets,
          jobDescription,
          jobDueDateLocal: jobDueDate,
          jobName,
          northAmericaPair,
          project: projectId,
          rows,
          savedAt: new Date().toISOString()
        })
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [authorizeJob, jobDescription, jobDueDate, jobName, northAmericaPair, projectId, rows, selectedEuTargets]);

  const populatedRows = useMemo(() => rows.filter((row) => String(row.value || "").trim()), [rows]);
  const routes = useMemo(
    () => getRoutesForProject({ project, northAmericaPair, selectedEuTargets }),
    [northAmericaPair, project, selectedEuTargets]
  );
  const submitSignature = useMemo(
    () =>
      JSON.stringify({
        authorizeJob,
        fields: getFieldsForSubmission(rows),
        jobDescription: jobDescription.trim(),
        jobDueDate,
        jobName: jobName.trim() || buildDefaultCustomJobName(),
        routes
      }),
    [authorizeJob, jobDescription, jobDueDate, jobName, routes, rows]
  );
  const isSubmittedAndUnchanged = submittedSignature && submittedSignature === submitSignature;

  function updateProject(nextProjectId) {
    const nextProject = PROJECTS[nextProjectId] || PROJECTS.us;
    setProjectId(nextProject.id);
    setJobDueDate(getDefaultDueDateLocalValue(nextProject.sourceLocale));
    setAuthorizeJob(getDefaultAuthorizeJob(nextProject.id));
    if (nextProject.id === "eu") {
      setNorthAmericaPair(false);
    }
    markChanged();
  }

  function updateRow(index, patch) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    );
    markChanged();
  }

  function addRow() {
    setRows((currentRows) => [...currentRows, { label: "", value: "" }]);
    markChanged();
  }

  function removeRow(index) {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((_, rowIndex) => rowIndex !== index);
      return nextRows.length ? nextRows : [INITIAL_ROW];
    });
    markChanged();
  }

  function removeBlankRows() {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((row) => row.label.trim() || row.value.trim());
      return nextRows.length ? nextRows : [INITIAL_ROW];
    });
    markChanged();
  }

  function clearRows() {
    setRows([INITIAL_ROW]);
    markChanged();
  }

  function startNewJob() {
    setProjectId("us");
    setJobName(buildDefaultCustomJobName());
    setJobDueDate(getDefaultDueDateLocalValue(PROJECTS.us.sourceLocale));
    setJobDescription("");
    setAuthorizeJob(getDefaultAuthorizeJob("us"));
    setNorthAmericaPair(false);
    setSelectedEuTargets(PROJECTS.eu.targetLocales);
    setRows([INITIAL_ROW]);
    setSubmittedSignature("");
    window.localStorage.removeItem(CUSTOM_DRAFT_STORAGE_KEY);
    setStatus({ tone: "success", message: "Ready for a new custom job." });
  }

  function markChanged() {
    if (submittedSignature) {
      setSubmittedSignature("");
      setStatus({ tone: "muted", message: "Job data changed. Review before submitting again." });
    }
  }

  async function importWorkbook(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setStatus({ tone: "error", message: "Choose an .xlsx file created from the custom job template." });
      return;
    }

    setIsImporting(true);
    setStatus({ tone: "muted", message: "Importing workbook..." });
    try {
      const response = await fetch(`${settings.apiBaseUrl}/api/custom-translation-requests/import-xlsx`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

      setRows(importedRows.map((row) => ({ label: row.label || "", value: row.value || "" })));
      markChanged();
      setStatus({ tone: "success", message: `Imported ${importedRows.length} string${importedRows.length === 1 ? "" : "s"} from ${file.name}.` });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    } finally {
      setIsImporting(false);
    }
  }

  async function submitCustomJob() {
    if (isSubmitting || isSubmittedAndUnchanged) {
      setStatus({
        tone: "error",
        message: "This job has already been submitted. Change the data or start a new job to submit again."
      });
      return;
    }

    const fields = getFieldsForSubmission(rows);
    const dueDate = toSmartlingDueDateIso(jobDueDate);
    const resolvedJobName = jobName.trim() || buildDefaultCustomJobName();

    if (!dueDate) {
      setStatus({ tone: "error", message: "Select a valid job due date." });
      return;
    }

    if (!fields.length) {
      setStatus({ tone: "error", message: "Add at least one source string before submitting." });
      return;
    }

    if (!routes.length) {
      setStatus({ tone: "error", message: "Select at least one target language before submitting." });
      return;
    }

    setIsSubmitting(true);
    setStatus({
      tone: "muted",
      message: routes.length === 1 ? "Submitting one Smartling request..." : `Submitting ${routes.length} Smartling requests...`
    });

    try {
      const responses = [];
      for (const route of routes) {
        responses.push(
          await apiFetch("/api/custom-translation-requests", {
            method: "POST",
            body: JSON.stringify({
              authorizeJob,
              fields,
              jobDescription: jobDescription.trim(),
              jobDueDate: dueDate,
              jobName: resolvedJobName,
              sourceLocale: route.sourceLocale,
              targetLocale: route.targetLocale
            })
          })
        );
      }

      setSubmittedSignature(submitSignature);
      window.localStorage.removeItem(CUSTOM_DRAFT_STORAGE_KEY);
      setStatus({
        tone: "success",
        message: `${buildSubmitStatusMessage(responses.map((response) => response.request))} The send button is locked until data changes.`
      });
    } catch (error) {
      setStatus({ tone: "error", message: error.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid">
      <section className="grid min-w-0 content-start gap-5 px-6 py-6 lg:pl-[344px]">
          <section className="grid gap-2">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-bold text-slate-950">Custom Jobs</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">
                  Submit requests for Smartling Translations.
                </p>
              </div>
              <a className="btn-secondary" href="/cms-smartling/templates/custom-job-template.xlsx" download>
                Download Excel Template
              </a>
            </div>
          </section>

          <StatusBanner tone={status.tone} message={status.message} />

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-5">
              <section className="panel p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-950">Job details</h2>
                <p className="text-sm font-medium text-slate-500">Settings are reused for every selected target.</p>
              </div>
              <button type="button" className="btn-secondary" onClick={startNewJob}>
                Start new job
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(280px,1.2fr)_minmax(320px,1fr)_220px]">
              <label className="field-label">
                <span className="inline-flex items-center gap-2">
                  Job name
                  <HelpTip text="Use a searchable name for the overall request, such as the campaign, page, component, or content type." />
                </span>
                <input className="field-control" value={jobName} onChange={(event) => { setJobName(event.target.value); markChanged(); }} />
              </label>
              <div className="field-label">
                <span className="inline-flex items-center gap-2">
                  Project
                  <HelpTip text="Choose the market and source language for this request. US sends to Spanish, Canada sends to French, and EU sends from en-IE to selected languages." />
                </span>
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
                  {Object.values(PROJECTS).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`rounded-lg px-3 py-2 text-left text-sm font-extrabold transition ${
                        projectId === item.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                      }`}
                      onClick={() => updateProject(item.id)}
                    >
                      <span className="block text-center">{PROJECT_NAV_LABELS[item.id] || item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="field-label">
                <span className="inline-flex items-center gap-2">
                  Due date
                  <HelpTip text="Requested Smartling due date. The default is 3 business days for US/Canada and 5 business days for EU." />
                </span>
                <input
                  className="field-control"
                  type="datetime-local"
                  value={jobDueDate}
                  onChange={(event) => { setJobDueDate(event.target.value); markChanged(); }}
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
              <label className="field-label">
                <span className="inline-flex items-center gap-2">
                  Additional details
                  <HelpTip text="Optional job-level context for translators. Use this for a component name, page, campaign, design reference link, audience note, or usage guidance." />
                </span>
                <textarea
                  className="field-control min-h-28 py-3"
                  value={jobDescription}
                  maxLength={8000}
                  placeholder="Optional notes or design reference link for translators"
                  onChange={(event) => { setJobDescription(event.target.value); markChanged(); }}
                />
              </label>
              <div className="grid content-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
                  <input
                    className="size-4 accent-sky-600"
                    type="checkbox"
                    checked={authorizeJob}
                    onChange={(event) => { setAuthorizeJob(event.target.checked); markChanged(); }}
                  />
                  <span className="inline-flex items-center gap-2">
                    Authorize Job
                    <HelpTip text="When checked, the job is submitted into the Smartling workflow immediately. Leave unchecked if the translation team should review the job setup first." />
                  </span>
                </label>
                {project.id !== "eu" ? (
                  <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
                    <input
                      className="size-4 accent-sky-600"
                      type="checkbox"
                      checked={northAmericaPair}
                      onChange={(event) => { setNorthAmericaPair(event.target.checked); markChanged(); }}
                    />
                    Also submit US Spanish and CA French
                  </label>
                ) : (
                  <EuTargetPicker selected={selectedEuTargets} setSelected={(targets) => { setSelectedEuTargets(targets); markChanged(); }} />
                )}
              </div>
            </div>
              </section>

              <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-950">Strings</h2>
                <p className="text-sm font-medium text-slate-500">
                  {populatedRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"} ready to submit.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="btn-secondary cursor-pointer">
                  <FileSpreadsheet className="mr-2" size={17} />
                  {isImporting ? "Importing..." : "Import Excel"}
                  <input className="sr-only" type="file" accept=".xlsx" disabled={isImporting} onChange={importWorkbook} />
                </label>
                <button type="button" className="btn-secondary" onClick={addRow}>
                  <Plus className="mr-2" size={17} />
                  Add row
                </button>
                <button type="button" className="btn-secondary" onClick={removeBlankRows}>
                  Remove blanks
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-extrabold uppercase text-slate-500">
                    <th className="w-16 px-4 py-3 text-right">#</th>
                    <th className="w-[34%] px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        Custom label
                        <HelpTip text="Describe where this string belongs, such as a page heading, button label, image description, or facet label." />
                      </span>
                    </th>
                    <th className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        Source string
                        <HelpTip text="Enter the exact English text to translate. Include only the source copy that should come back translated." />
                      </span>
                    </th>
                    <th className="w-24 px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-400">{index + 1}</td>
                      <td className="px-4 py-3">
                        <input
                          className="field-control w-full"
                          value={row.label}
                          placeholder="Custom label"
                          onChange={(event) => updateRow(index, { label: event.target.value })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          className="field-control min-h-20 w-full py-3"
                          value={row.value}
                          placeholder="Source string"
                          onChange={(event) => updateRow(index, { value: event.target.value })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="inline-flex size-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:bg-red-100"
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() => removeRow(index)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              </section>
            </div>

            <aside className="grid content-start gap-4">
              <section className="panel p-5">
            <h2 className="font-display text-lg font-bold text-slate-950">Submission summary</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <SummaryRow label="Project" value={`${project.label} | ${project.detail}`} />
              <SummaryRow label="Targets" value={routes.map((route) => route.targetLocale).join(", ") || "None selected"} />
              <SummaryRow label="Strings" value={`${populatedRows.length} ready`} />
              <SummaryRow label="Authorize" value={authorizeJob ? "Yes" : "No"} />
            </div>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="btn-primary min-h-12"
                disabled={isSubmitting || isSubmittedAndUnchanged}
                onClick={submitCustomJob}
              >
                <Send className="mr-2" size={17} />
                {isSubmitting ? "Sending..." : isSubmittedAndUnchanged ? "Submitted" : "Send Custom Job"}
              </button>
              <button type="button" className="btn-secondary" onClick={clearRows}>
                Clear rows
              </button>
            </div>
              </section>
            </aside>
          </section>
      </section>
    </main>
  );
}

function EuTargetPicker({ selected, setSelected }) {
  const selectedSet = new Set(selected);

  function toggleTarget(locale) {
    const nextSet = new Set(selectedSet);
    if (nextSet.has(locale)) {
      nextSet.delete(locale);
    } else {
      nextSet.add(locale);
    }
    setSelected([...nextSet]);
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-extrabold text-slate-700">EU target languages</span>
        <button type="button" className="text-xs font-extrabold text-sky-700" onClick={() => setSelected(PROJECTS.eu.targetLocales)}>
          Select all
        </button>
      </div>
      <div className="grid gap-2">
        {PROJECTS.eu.targetLocales.map((locale) => (
          <label key={locale} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
            <span>{EU_TARGET_LABELS[locale]} | {locale}</span>
            <input
              className="size-4 accent-sky-600"
              type="checkbox"
              checked={selectedSet.has(locale)}
              onChange={() => toggleTarget(locale)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2">
      <span className="font-bold text-slate-500">{label}</span>
      <span className="text-right font-extrabold text-slate-900">{value}</span>
    </div>
  );
}

function HelpTip({ text }) {
  return (
    <span
      className="inline-flex size-4 items-center justify-center rounded-full border border-slate-300 bg-sky-50 text-[10px] font-black leading-none text-sky-700"
      title={text}
      aria-label={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}

function StatusBanner({ tone, message }) {
  if (!message) return null;
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : AlertCircle;
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${className}`} role="status">
      <Icon className="mt-0.5 shrink-0" size={18} />
      <span>{message}</span>
    </div>
  );
}

function readDraft() {
  try {
    return JSON.parse(window.localStorage.getItem(CUSTOM_DRAFT_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function getFieldsForSubmission(rows) {
  return rows
    .map((row, index) => ({
      label: row.label.trim() || `String ${index + 1}`,
      value: row.value || ""
    }))
    .filter((row) => row.value.trim());
}

function getDefaultAuthorizeJob(projectId) {
  return projectId !== "eu";
}

function buildSubmitStatusMessage(requests) {
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
