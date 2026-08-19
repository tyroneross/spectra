// src/launcher/types.ts
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
export class LauncherError extends Error {
    reason;
    hint;
    constructor(reason, hint) {
        super(reason);
        this.reason = reason;
        this.hint = hint;
        this.name = 'LauncherError';
    }
}
//# sourceMappingURL=types.js.map