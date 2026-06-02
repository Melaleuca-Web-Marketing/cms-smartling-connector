# Validation Report: XLSX import can synchronously inflate oversized XML before row limits apply

Candidate id: CAND-XLSX-DOS-004
Disposition: reportable
Confidence: high

## Rubric

- [x] Attacker-controlled file parser input identified.
- [x] Compressed request cap identified.
- [x] Unbounded synchronous inflate and XML parse identified.
- [x] Row cap shown to apply after parse.
- [ ] No live DoS PoC was executed against the backend.

## Method

Validation used source tracing and the repository syntax check. `npm run check` completed successfully. Live CMS/Smartling interaction was intentionally not performed, and Python-based validator tooling was unavailable in this environment.

## Evidence

- Source: Uploaded XLSX bytes to /api/custom-translation-requests/import-xlsx.
- Sink/control: inflateRawSync and whole-document XML parsing run without uncompressed-size or aggregate ZIP-entry limits.
- Impact: A compressed workbook under the request cap can exhaust CPU or memory and block the Node event loop.
- Affected locations: backend/server.mjs:219, backend/server.mjs:651-652, backend/xlsxImport.mjs:42-76, backend/xlsxImport.mjs:109-116

## Notes

The upload body is capped by compressed byte count. The ZIP central directory records compressed size, and selected entries are synchronously inflated without a max output length. The 500-row cap is applied after workbook XML is already inflated and parsed.

## Closure

Survives validation: yes
