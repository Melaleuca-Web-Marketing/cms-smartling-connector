import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const packageDir = join(rootDir, "dist", "packages");
const landingDownloadDir = join(rootDir, "docs", "downloads");
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
  const zipPath = join(packageDir, `cms-smartling-connector-${target}.zip`);
  const landingZipPath = join(landingDownloadDir, `cms-smartling-connector-${target}.zip`);

  await rm(zipPath, {
    force: true
  });
  await rm(landingZipPath, {
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
  await copyFile(zipPath, landingZipPath);
  console.log(`Updated landing page download at ${relative(rootDir, landingZipPath)}`);
}

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
