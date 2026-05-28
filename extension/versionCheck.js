globalThis.SmartlingVersionCheck = (() => {
  function getCurrentVersion() {
    return globalThis.chrome?.runtime?.getManifest?.().version || "0.0.0";
  }

  function getReleaseInfoUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/release-info.json`;
  }

  function getDownloadPageUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/`;
  }

  async function check(baseUrl) {
    const currentVersion = getCurrentVersion();
    const releaseInfoUrl = getReleaseInfoUrl(baseUrl);
    const response = await fetch(releaseInfoUrl, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Update check failed: HTTP ${response.status}`);
    }

    const releaseInfo = await response.json();
    const latestVersion = String(releaseInfo.version || "").trim();

    return {
      currentVersion,
      downloadPageUrl: getDownloadPageUrl(baseUrl),
      isUpdateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      releaseInfo,
      releaseInfoUrl
    };
  }

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function compareVersions(left, right) {
    const leftParts = toVersionParts(left);
    const rightParts = toVersionParts(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] || 0;
      const rightPart = rightParts[index] || 0;

      if (leftPart > rightPart) return 1;
      if (leftPart < rightPart) return -1;
    }

    return 0;
  }

  function toVersionParts(version) {
    return String(version || "")
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  }

  return {
    check,
    compareVersions,
    getCurrentVersion,
    getDownloadPageUrl,
    getReleaseInfoUrl
  };
})();
