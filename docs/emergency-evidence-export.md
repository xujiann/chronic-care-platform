# Emergency evidence export and verification

`GET /api/emergency/events/:id/evidence-package/export?format=json` downloads a role-scoped operational evidence package in JSON. Use `format=markdown` for a human-readable Markdown copy.

Each download contains an `integrity` section:

- `algorithm`: SHA-256
- `digest`: the SHA-256 of the package's `stable-json-v1` canonical payload
- `redactionProfile`: `response-role-scope-v1`, proving the digest applies to the package delivered after role-based redaction

The integrity digest detects an altered export. It is not a legal electronic signature, and the package does not replace signed site evidence, external-interface acceptance, or formal production cutover approval.

The emergency workbench exposes both formats after an authorized user opens an event evidence package. The `npm.cmd run emergency:demo` command exercises the resident call, dispatch, vehicle updates, clinical record, hospital acceptance, WS/T 621 handover, quality closure, and final evidence digest without changing operational data.

`npm.cmd run emergency:test` also runs an isolated HTTP contract test. It proves that an unaffiliated resident cannot see unlinked dispatch events, can see only the call they created, cannot open another event's evidence package, and can download the completed package in both formats.
