// src/computer-use/port.ts
//
// The injectable seam between the computer-use orchestration and the native AX
// bridge. ComputerUse depends ONLY on AxBridgePort, never on the child-process
// bridge directly — so unit tests inject a fake AX snapshot (no GUI session
// needed) and the daemon injects the real NativeAxBridgePort (./native-port.ts).
//
// SPDX-License-Identifier: Apache-2.0
/** Thrown when the OS denies Accessibility access — surfaced as a clear,
 * actionable error rather than an opaque bridge failure or a crash. */
export class AxPermissionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AxPermissionError';
    }
}
/** Heuristic: does a native bridge error indicate missing AX permission? */
export function isPermissionMessage(message) {
    const m = message.toLowerCase();
    return m.includes('accessibility permission') || m.includes('apidisabled') || m.includes('api disabled');
}
//# sourceMappingURL=port.js.map