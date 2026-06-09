"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, ChevronDown, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSmartlingSettings } from "../lib/clientSettings";

const NAV_ITEMS = [
  { href: "/custom-jobs", label: "Custom Job" },
  { href: "/recent-jobs", label: "Recent Jobs" }
];

export function AppShell({ children }) {
  const pathname = usePathname();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!settingsRef.current?.contains(event.target)) {
        setIsSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-5 px-5">
          <Link href="/custom-jobs" className="flex min-w-0 items-center gap-3 no-underline">
            <span className="grid size-10 place-items-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
              <BriefcaseBusiness size={21} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold leading-tight text-slate-950">
                Smartling Jobs
              </span>
              <span className="block text-xs font-medium text-slate-500">Translation operations</span>
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1" aria-label="Smartling app">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-bold no-underline transition ${
                    isActive
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div ref={settingsRef} className="relative">
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-2 pr-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50"
              aria-expanded={isSettingsOpen}
              onClick={() => setIsSettingsOpen((value) => !value)}
            >
              <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600">
                <UserRound size={17} />
              </span>
              Profile
              <ChevronDown size={15} />
            </button>
            {isSettingsOpen ? <SettingsPanel /> : null}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function SettingsPanel() {
  const { settings, saveSettings, testBackend } = useSmartlingSettings();
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [apiToken, setApiToken] = useState(settings.apiToken);
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    setApiBaseUrl(settings.apiBaseUrl);
    setApiToken(settings.apiToken);
  }, [settings.apiBaseUrl, settings.apiToken]);

  function handleSave() {
    saveSettings({ apiBaseUrl, apiToken });
    setStatus("Settings saved in this browser.");
  }

  async function handleCheck() {
    setIsChecking(true);
    setStatus("Checking connection...");
    try {
      const result = await testBackend({ apiBaseUrl, apiToken });
      setStatus(`${result.service || "Backend"} is reachable.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className="absolute right-0 top-12 w-[390px] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-slate-950 text-white">
          <Settings size={17} />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-slate-950">Backend Settings</h2>
          <p className="text-xs text-slate-500">Saved locally for this browser profile.</p>
        </div>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs font-bold text-slate-700">
          Backend URL
          <input
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            value={apiBaseUrl}
            type="url"
            spellCheck="false"
            onChange={(event) => setApiBaseUrl(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-bold text-slate-700">
          API token
          <input
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            value={apiToken}
            type="password"
            autoComplete="off"
            spellCheck="false"
            onChange={(event) => setApiToken(event.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" onClick={handleSave}>
            Save settings
          </button>
          <button type="button" className="btn-secondary flex-1" disabled={isChecking} onClick={handleCheck}>
            {isChecking ? "Checking..." : "Check"}
          </button>
        </div>
        {status ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{status}</p> : null}
      </div>
    </div>
  );
}
