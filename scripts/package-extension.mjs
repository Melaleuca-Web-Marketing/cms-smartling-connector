import { mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const packageDir = join(rootDir, "dist", "packages");
const targets = ["chromium", "firefox"];

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

await mkdir(packageDir, {
  recursive: true
});

for (const target of targets) {
  const sourceDir = join(rootDir, "dist", target);
  const zipPath = join(packageDir, `cms-smartling-connector-${target}.zip`);

  await rm(zipPath, {
    force: true
  });

  const result = spawnSync(
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
  );

  if (result.error || result.status !== 0) {
    throw result.error || new Error(`Failed to package ${target} extension.`);
  }

  console.log(`Packaged ${target} extension at ${relative(rootDir, zipPath)}`);
}
