# Spectra M4 CDP Swift Port Notes

## Scope

This folder ports the actively-used TypeScript CDP surface under `src/cdp/**` to Swift without changing the TypeScript reference implementation.

Ported domains and behavior:

- Chrome launch/discovery: `CDPBrowserManager`
- WebSocket request/response dispatch with pending request timeouts: `CDPConnection`
- Target create/attach/close/list: `CDPTargetDomain`
- Page navigate/screenshot/lifecycle enable: `CDPPageDomain`
- Accessibility full tree/query conversion into Spectra-style elements: `CDPAccessibilityDomain`
- DOM box-model center lookup: `CDPDOMDomain`
- Input click/type/scroll: `CDPInputDomain`
- Runtime evaluate and console event collection: `CDPRuntimeDomain`, `CDPConsoleDomain`
- Driver-level connect/snapshot/act/screenshot/navigate/close: `CDPDriver`

## Guardrails

- Chrome launches with `--password-store=basic` and `--use-mock-keychain`.
- The conditional smoke entrypoint uses a temporary Chrome profile under `/tmp`.
- No `.spectra/` data is touched by the smoke entrypoint.
- `CDPSmokeMain` is compiled only with `-D SPECTRA_CDP_SMOKE`; it is inert inside the app target.

## Reference

Read-only TypeScript references:

- `src/cdp/browser.ts`
- `src/cdp/connection.ts`
- `src/cdp/driver.ts`
- `src/cdp/accessibility.ts`
- `src/cdp/console.ts`
- `src/cdp/dom.ts`
- `src/cdp/input.ts`
- `src/cdp/page.ts`
- `src/cdp/runtime.ts`
- `src/cdp/target.ts`
- `src/cdp/wait.ts`
