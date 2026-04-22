/**
 * Spectra library — persistent asset archive living alongside sessions.
 *
 * Sessions (.spectra/sessions/<id>/) are ephemeral step sequences from
 * spectra_connect / spectra_step / spectra_capture. The library
 * (.spectra/library/) is a long-lived flat catalog of captures tagged
 * with feature / component / tags so they can be found, grouped, and
 * exported for blog posts, docs, or marketing.
 *
 * Schema is forward-compatible with the showcase plugin's CaptureEntry
 * so captures can migrate in with spectra_library action="migrate-from-showcase".
 */
export const LIBRARY_VERSION = 1;
//# sourceMappingURL=types.js.map