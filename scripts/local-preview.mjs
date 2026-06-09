import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const docsDir = join(rootDir, "docs");
const host = process.env.PREVIEW_HOST || "127.0.0.1";
const port = Number(process.env.PREVIEW_PORT || 17818);
const backendTarget = String(process.env.BACKEND_TARGET || "http://127.0.0.1:17817").replace(
  /\/+$/,
  ""
);
const webTarget = String(process.env.SMARTLING_WEB_TARGET || "http://127.0.0.1:17819").replace(
  /\/+$/,
  ""
);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".zip", "application/zip"]
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname;

  try {
    if (pathname === "/") {
      return redirect(res, "/cms-smartling/");
    }

    if (pathname === "/cms-smartling") {
      return redirect(res, "/cms-smartling/");
    }

    if (pathname === "/cms-smartling/health") {
      return proxyRequest(req, res, "/health");
    }

    if (pathname.startsWith("/cms-smartling/api/")) {
      return proxyRequest(req, res, pathname.replace(/^\/cms-smartling/, "") + url.search);
    }

    if (pathname === "/cms-smartling/custom-jobs.html") {
      return redirect(res, "/cms-smartling/custom-jobs");
    }

    if (pathname === "/cms-smartling/recent-jobs.html") {
      return redirect(res, "/cms-smartling/recent-jobs");
    }

    if (
      pathname.startsWith("/cms-smartling/_next/") ||
      pathname.startsWith("/cms-smartling/custom-jobs") ||
      pathname.startsWith("/cms-smartling/recent-jobs")
    ) {
      return proxyRequest(req, res, pathname + url.search, webTarget);
    }

    if (pathname === "/cms-smartling/") {
      return serveStatic(res, "index.html");
    }

    if (pathname.startsWith("/cms-smartling/")) {
      return serveStatic(res, decodeURIComponent(pathname.replace(/^\/cms-smartling\//, "")));
    }

    return sendText(res, 404, "Not found");
  } catch (error) {
    return sendText(res, 500, `Preview server error: ${error.message}`);
  }
});

server.listen(port, host, () => {
  console.log(`CMS Smartling local preview: http://${host}:${port}/cms-smartling/`);
  console.log(`Proxying API requests to ${backendTarget}`);
  console.log(`Proxying Next app requests to ${webTarget}`);
});

async function serveStatic(res, requestedPath) {
  const safePath = normalize(requestedPath).replace(/^(\.\.(?:\/|\\|$))+/, "");
  const filePath = join(docsDir, safePath);
  const relativePath = relative(docsDir, filePath);

  if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
    return sendText(res, 403, "Forbidden");
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return sendText(res, 404, "Not found");
  }

  res.writeHead(200, {
    "Content-Type": contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

async function proxyRequest(req, res, proxyPath, target = backendTarget) {
  const body = ["GET", "HEAD"].includes(req.method || "")
    ? undefined
    : await readRequestBody(req);
  const upstream = await fetch(`${target}${proxyPath}`, {
    method: req.method,
    headers: filterProxyHeaders(req.headers),
    body
  });
  const headers = Object.fromEntries(upstream.headers.entries());
  delete headers["content-encoding"];
  delete headers["content-length"];
  res.writeHead(upstream.status, headers);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function filterProxyHeaders(headers) {
  const nextHeaders = {
    ...headers
  };
  delete nextHeaders.host;
  delete nextHeaders.origin;
  delete nextHeaders.referer;
  return nextHeaders;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location
  });
  res.end();
}

function sendText(res, status, message) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(message);
}
