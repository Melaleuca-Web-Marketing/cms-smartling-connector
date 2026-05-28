import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const docsDir = join(rootDir, "docs");
const packageJsonPath = join(rootDir, "package.json");
const releaseInfoPath = join(docsDir, "release-info.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const recentChanges = readRecentChanges();

const payload = {
  name: packageJson.name,
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  downloads: {
    chromium: `downloads/cms-smartling-connector-chromium-v${packageJson.version}.zip`,
    firefox: `downloads/cms-smartling-connector-firefox-v${packageJson.version}.zip`
  },
  changes: recentChanges
};

await writeFile(releaseInfoPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Generated release info at ${relative(rootDir, releaseInfoPath)}`);

function readRecentChanges() {
  const result = spawnSync(
    "git",
    [
      "-C",
      rootDir,
      "log",
      "--max-count=6",
      "--date=short",
      "--pretty=format:%H%x1f%h%x1f%ad%x1f%s"
    ],
    {
      encoding: "utf8"
    }
  );

  if (result.error || result.status !== 0) {
    throw result.error || new Error("Failed to read recent Git history.");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, shortCommit, date, summary] = line.split("\u001f");
      return {
        commit,
        shortCommit,
        date,
        summary
      };
    });
}
