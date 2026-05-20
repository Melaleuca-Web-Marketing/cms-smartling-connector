#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "${SCRIPT_DIR}/.." && pwd)

DOCS_SRC_DIR="${REPO_DIR}/docs"
DOCS_DST_DIR="/usr/share/nginx/cms-smartling-docs"
DIST_DIR="${REPO_DIR}/dist"
DOWNLOADS_SRC_DIR="${DOCS_SRC_DIR}/downloads"
NGINX_CONF_SRC="${SCRIPT_DIR}/newrequestform.conf"
NGINX_CONF_DST="/etc/nginx/conf.d/newrequestform.conf"

if [[ ${EUID} -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

require_file() {
  local file_path=$1
  if [[ ! -f "${file_path}" ]]; then
    printf 'Missing required file: %s\n' "${file_path}" >&2
    exit 1
  fi
}

require_command() {
  local command_name=$1
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  fi
}

build_extensions() {
  printf 'Building extension bundles...\n'
  su - brand -c "cd '${REPO_DIR}' && npm run build:extension"
}

package_extensions() {
  local chromium_dir="${DIST_DIR}/chromium"
  local firefox_dir="${DIST_DIR}/firefox"

  require_command zip
  require_file "${chromium_dir}/manifest.json"
  require_file "${firefox_dir}/manifest.json"

  mkdir -p "${DOWNLOADS_SRC_DIR}"

  printf 'Packaging extension ZIP files...\n'
  rm -f \
    "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-chromium.zip" \
    "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-firefox.zip"

  (
    cd "${chromium_dir}"
    zip -rq "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-chromium.zip" .
  )

  (
    cd "${firefox_dir}"
    zip -rq "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-firefox.zip" .
  )
}

deploy_docs() {
  printf 'Deploying docs to %s...\n' "${DOCS_DST_DIR}"
  install -d -m 0755 \
    "${DOCS_DST_DIR}" \
    "${DOCS_DST_DIR}/assets" \
    "${DOCS_DST_DIR}/downloads"

  install -m 0644 "${DOCS_SRC_DIR}/index.html" "${DOCS_DST_DIR}/index.html"
  install -m 0644 "${DOCS_SRC_DIR}/styles.css" "${DOCS_DST_DIR}/styles.css"
  install -m 0644 "${DOCS_SRC_DIR}/assets/smartling_logo.png" "${DOCS_DST_DIR}/assets/smartling_logo.png"
  install -m 0644 \
    "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-chromium.zip" \
    "${DOCS_DST_DIR}/downloads/cms-smartling-connector-chromium.zip"
  install -m 0644 \
    "${DOWNLOADS_SRC_DIR}/cms-smartling-connector-firefox.zip" \
    "${DOCS_DST_DIR}/downloads/cms-smartling-connector-firefox.zip"
}

deploy_nginx_config() {
  printf 'Installing Nginx config...\n'
  install -m 0644 "${NGINX_CONF_SRC}" "${NGINX_CONF_DST}"
  nginx -t
  systemctl reload nginx
}

require_file "${DOCS_SRC_DIR}/index.html"
require_file "${DOCS_SRC_DIR}/styles.css"
require_file "${DOCS_SRC_DIR}/assets/smartling_logo.png"
require_file "${NGINX_CONF_SRC}"
require_command npm

build_extensions
package_extensions
deploy_docs
deploy_nginx_config

printf 'CMS Smartling docs and Nginx config deployed successfully.\n'
