# Security policy

Slidewise runs entirely in the browser: there is no server, no account system, and no data leaves the device.
That removes whole classes of risk, but not all of them. The relevant risks are **hostile files** (PPTX, JSON, images,
pasted HTML) and **supply-chain** issues in dependencies.

## Reporting a vulnerability

Please report privately using GitHub's **Security → Report a vulnerability** form on this repository
(or contact the maintainers privately). Do not open a public issue for an unpatched vulnerability.
Include the file or steps that trigger it and the browser/version. We aim to acknowledge reports within 7 days.

## What is in scope

- Script execution or CSP bypass from an imported file or pasted content (XSS)
- Zip bombs, path traversal, XML entity expansion, or crashes from crafted PPTX/JSON/image files
- Weaknesses in the password lock implementation (see README for what it does and does not protect)
- Data leaving the device without the user's action

## Built-in defences (see `src/model/validate.js`, `src/import/`, `index.html`)

Allow-list rebuild of every imported deck, image sniffing by magic bytes (no SVG), DOMPurify for pasted HTML,
strict size/count caps, no `eval`, strict Content-Security-Policy, and `npm audit --omit=dev` in CI.

## Supported versions

Only the latest release on the default branch is supported.
