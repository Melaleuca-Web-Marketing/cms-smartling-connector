# Attack Path Analysis: XLSX import can synchronously inflate oversized XML before row limits apply

Candidate id: CAND-XLSX-DOS-004
Final policy decision: report
Severity: medium
Confidence: high

## Attack Path

1. An attacker posts a crafted XLSX to /api/custom-translation-requests/import-xlsx.
2. The server accepts up to 5 MB of compressed upload bytes.
3. The parser locates ZIP entries, slices compressed data, and calls inflateRawSync without an output cap.
4. The event loop spends CPU/memory inflating and regex-parsing XML before the 500-row import cap applies.

## Facts

- In-scope component: backend parser and custom bulk import workflow are in scope.
- Vector: same backend exposure as the API, amplified by missing auth.
- Auth scope: public if the backend API is reachable.
- Attacker input control: yes: attacker controls workbook bytes.
- Cross-boundary behavior: verified from HTTP upload to synchronous Node parser.
- Existing controls: 5 MB compressed upload cap and 500 imported row cap.
- Counterevidence: row cap exists but applies after inflation/parsing; no uncompressed cap found.
- Blindspots: no crash/DoS PoC executed; exact resource ceiling depends on host memory and Node zlib behavior.

## Severity Calibration

Medium because this is an availability issue on an internal service, but it is reachable through an unauthenticated upload path and can block the single-threaded Node event loop.

## Remediation

Require API auth, cap ZIP entry count and uncompressed byte totals, use zlib maxOutputLength or streaming with hard limits, reject suspicious central directory sizes, and parse XML with bounded input.
