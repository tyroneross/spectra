// macos/Spectra/DaemonCore/SessionOps.swift
// M3.G1 — session control-plane ops (STUB to be implemented by the session group):
// listSessions, getSession, getRun, closeSession, closeAllSessions, recordLlmUsage.
// Registering here plugs into HandlerRegistry. Until implemented, these ops are
// unregistered → not_found (routing table keeps them on the TS daemon).
// SPDX-License-Identifier: Apache-2.0
import Foundation

func registerSessionOps(_ registry: HandlerRegistry) {
    // TODO(session-group): register the 6 ops against DaemonContext.sessions,
    // mirroring core-api.ts result shapes (SessionSummary/SessionDetail/GetRunResult).
    // Honor DaemonContext.conformanceSeedEnabled to seed a deterministic session.
}
