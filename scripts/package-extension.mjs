import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const packageDir = join(rootDir, "dist", "packages");
const landingDownloadDir = join(rootDir, "docs", "downloads");
const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
const targets = {
  chromium: true,
  firefox: true
};
const requestedTarget = process.argv[2] || "all";
const selectedTargets =
  requestedTarget === "all" ? Object.keys(targets) : [requestedTarget.toLowerCase()];

for (const target of selectedTargets) {
  if (!targets[target]) {
    throw new Error(`Unknown extension package target: ${target}`);
  }
}

await mkdir(packageDir, {
  recursive: true
});
await mkdir(landingDownloadDir, {
  recursive: true
});

for (const target of selectedTargets) {
  const sourceDir = join(rootDir, "dist", target);
  const stableFileName = getStableFileName(target);
  const versionedFileName = getVersionedFileName(target);
  const zipPath = join(packageDir, versionedFileName);
  const stableZipPath = join(packageDir, stableFileName);
  const landingZipPath = join(landingDownloadDir, versionedFileName);
  const stableLandingZipPath = join(landingDownloadDir, stableFileName);

  await removeExistingTargetPackages(packageDir, target);
  await removeExistingTargetPackages(landingDownloadDir, target);
  await rm(zipPath, {
    force: true
  });
  await rm(stableZipPath, {
    force: true
  });
  await rm(landingZipPath, {
    force: true
  });
  await rm(stableLandingZipPath, {
    force: true
  });

  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            [
              "$ErrorActionPreference = 'Stop'",
              `Compress-Archive -Path ${psString(join(sourceDir, "*"))} -DestinationPath ${psString(zipPath)} -Force`
            ].join("; ")
          ],
          {
            cwd: rootDir,
            stdio: "inherit"
          }
        )
      : spawnSync("zip", ["-rq", zipPath, "."], {
          cwd: sourceDir,
          stdio: "inherit"
        });

  if (result.error || result.status !== 0) {
    throw result.error || new Error(`Failed to package ${target} extension.`);
  }

  console.log(`Packaged ${target} extension at ${relative(rootDir, zipPath)}`);
  await copyFile(zipPath, stableZipPath);
  console.log(`Updated stable package alias at ${relative(rootDir, stableZipPath)}`);
  await copyFile(zipPath, landingZipPath);
  console.log(`Updated landing page download at ${relative(rootDir, landingZipPath)}`);
  await copyFile(zipPath, stableLandingZipPath);
  console.log(`Updated stable landing page alias at ${relative(rootDir, stableLandingZipPath)}`);
}

function getStableFileName(target) {
  return `cms-smartling-connector-${target}.zip`;
}

function getVersionedFileName(target) {
  if (!version) {
    return getStableFileName(target);
  }
  return `cms-smartling-connector-${target}-v${version}.zip`;
}

async function removeExistingTargetPackages(directory, target) {
  const prefix = `cms-smartling-connector-${target}-v`;
  const entries = await readdir(directory, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".zip")) {
      await rm(join(directory, entry.name), {
        force: true
      });
    }
  }
}

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
