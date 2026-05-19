import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const extensionDir = join(rootDir, "extension");
const distDir = join(rootDir, "dist");

const targets = {
  chromium: {
    manifest: "manifest.json"
  },
  firefox: {
    manifest: "manifest.firefox.json"
  }
};

const requestedTarget = process.argv[2] || "all";
const selectedTargets =
  requestedTarget === "all" ? Object.keys(targets) : [requestedTarget.toLowerCase()];

for (const target of selectedTargets) {
  if (!targets[target]) {
    throw new Error(`Unknown extension build target: ${target}`);
  }
}

for (const target of selectedTargets) {
  await buildTarget(target);
}

async function buildTarget(target) {
  const outputDir = join(distDir, target);
  await rm(outputDir, {
    recursive: true,
    force: true
  });
  await mkdir(outputDir, {
    recursive: true
  });

  await copySharedExtensionFiles(extensionDir, outputDir);
  await writeTargetManifest(target, outputDir);

  console.log(`Built ${target} extension at ${relative(rootDir, outputDir)}`);
}

async function copySharedExtensionFiles(sourceDir, outputDir) {
  const entries = await readdir(sourceDir, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (isSourceManifest(entry.name)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const outputPath = join(outputDir, entry.name);

    if (entry.isDirectory()) {
      await copySharedExtensionFiles(sourcePath, outputPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await mkdir(dirname(outputPath), {
      recursive: true
    });
    await writeFile(outputPath, await readFile(sourcePath));
  }
}

function isSourceManifest(fileName) {
  return fileName === "manifest.json" || /^manifest\.[^.]+\.json$/.test(fileName);
}

async function writeTargetManifest(target, outputDir) {
  const manifestPath = join(extensionDir, targets[target].manifest);
  const manifestText = await readFile(manifestPath, "utf8");
  JSON.parse(manifestText);
  await writeFile(join(outputDir, "manifest.json"), manifestText);

  const outputManifest = await stat(join(outputDir, "manifest.json"));
  if (!outputManifest.isFile()) {
    throw new Error(`Failed to write manifest for ${target}.`);
  }
}
