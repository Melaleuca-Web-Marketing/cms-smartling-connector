"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export const SETTINGS_STORAGE_KEY = "smartlingStandaloneSettings";
export const SETTINGS_CHANGED_EVENT = "smartling-settings-changed";

export function getDefaultApiBaseUrl() {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:17817";
  }

  if (window.location.pathname.startsWith("/cms-smartling")) {
    return `${window.location.origin}/cms-smartling`;
  }

  return window.location.origin;
}

export function normalizeApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function readSmartlingSettings() {
  if (typeof window === "undefined") {
    return {
      apiBaseUrl: getDefaultApiBaseUrl(),
      apiToken: ""
    };
  }

  try {
    const settings = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}") || {};
    return {
      apiBaseUrl: normalizeApiBaseUrl(settings.apiBaseUrl) || getDefaultApiBaseUrl(),
      apiToken: String(settings.apiToken || "")
    };
  } catch {
    return {
      apiBaseUrl: getDefaultApiBaseUrl(),
      apiToken: ""
    };
  }
}

export function writeSmartlingSettings(settings) {
  const nextSettings = {
    apiBaseUrl: normalizeApiBaseUrl(settings.apiBaseUrl) || getDefaultApiBaseUrl(),
    apiToken: String(settings.apiToken || "").trim()
  };
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: nextSettings }));
  return nextSettings;
}

export function useSmartlingSettings() {
  const [settings, setSettings] = useState(() => readSmartlingSettings());

  useEffect(() => {
    function handleSettingsChanged(event) {
      setSettings(event.detail || readSmartlingSettings());
    }

    function handleStorage(event) {
      if (event.key === SETTINGS_STORAGE_KEY) {
        setSettings(readSmartlingSettings());
      }
    }

    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    window.addEventListener("storage", handleStorage);
    setSettings(readSmartlingSettings());
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const getAuthHeaders = useCallback(
    (override = settings) => {
      const token = String(override.apiToken || "").trim();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    [settings]
  );

  const apiFetch = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${settings.apiBaseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
          ...(options.headers || {})
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(data.error?.message || `Backend request failed: ${response.status}`);
        error.status = response.status;
        error.details = data.error?.details || null;
        throw error;
      }

      return data;
    },
    [getAuthHeaders, settings.apiBaseUrl]
  );

  const testBackend = useCallback(
    async (override = settings) => {
      const normalized = {
        apiBaseUrl: normalizeApiBaseUrl(override.apiBaseUrl) || getDefaultApiBaseUrl(),
        apiToken: String(override.apiToken || "").trim()
      };
      const response = await fetch(`${normalized.apiBaseUrl}/health`, {
        headers: getAuthHeaders(normalized)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error?.message || `Backend check failed: ${response.status}`);
      }

      return data;
    },
    [getAuthHeaders, settings]
  );

  return useMemo(
    () => ({
      apiFetch,
      getAuthHeaders,
      saveSettings: (nextSettings) => setSettings(writeSmartlingSettings(nextSettings)),
      settings,
      testBackend
    }),
    [apiFetch, getAuthHeaders, settings, testBackend]
  );
}
