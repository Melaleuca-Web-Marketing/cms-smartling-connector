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
RELEASE_INFO_SRC="${DOCS_SRC_DIR}/release-info.json"

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

build_web() {
  printf 'Building Next standalone app...\n'
  su - brand -c "cd '${REPO_DIR}' && npm run web:build"
}

deploy_docs() {
  printf 'Deploying docs to %s...\n' "${DOCS_DST_DIR}"
  install -d -m 0755 \
    "${DOCS_DST_DIR}" \
    "${DOCS_DST_DIR}/assets" \
    "${DOCS_DST_DIR}/downloads" \
    "${DOCS_DST_DIR}/templates"

  install -m 0644 "${DOCS_SRC_DIR}/index.html" "${DOCS_DST_DIR}/index.html"
  install -m 0644 "${DOCS_SRC_DIR}/styles.css" "${DOCS_DST_DIR}/styles.css"
  install -m 0644 "${RELEASE_INFO_SRC}" "${DOCS_DST_DIR}/release-info.json"
  install -m 0644 "${DOCS_SRC_DIR}/assets/smartling_logo.png" "${DOCS_DST_DIR}/assets/smartling_logo.png"
  install -m 0644 "${DOCS_SRC_DIR}/templates/custom-job-template.xlsx" "${DOCS_DST_DIR}/templates/custom-job-template.xlsx"
  find "${DOCS_DST_DIR}/downloads" -maxdepth 1 -type f -name 'cms-smartling-connector-*.zip' -delete
  find "${DOWNLOADS_SRC_DIR}" -maxdepth 1 -type f -name 'cms-smartling-connector-*.zip' -exec install -m 0644 {} "${DOCS_DST_DIR}/downloads/" \;
}

deploy_nginx_config() {
  printf 'Installing Nginx config...\n'
  install -m 0644 "${NGINX_CONF_SRC}" "${NGINX_CONF_DST}"
  nginx -t
  systemctl reload nginx
}

restart_services() {
  printf 'Restarting PM2 services...\n'
  su - brand -c "cd '${REPO_DIR}' && pm2 startOrReload ecosystem.config.cjs --update-env"
}

require_file "${DOCS_SRC_DIR}/index.html"
require_file "${DOCS_SRC_DIR}/styles.css"
require_file "${DOCS_SRC_DIR}/assets/smartling_logo.png"
require_file "${NGINX_CONF_SRC}"
require_command zip
require_command npm
require_command pm2

build_extensions
build_web
deploy_docs
deploy_nginx_config
restart_services

printf 'CMS Smartling docs and Nginx config deployed successfully.\n'
