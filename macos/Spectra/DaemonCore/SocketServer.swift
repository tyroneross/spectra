// macos/Spectra/DaemonCore/SocketServer.swift
//
// M3.G1 flip — the unix-socket front door. A POSIX AF_UNIX/SOCK_STREAM listener
// (mode 0600, peer-credential auth by construction — single-user, no token/TCP),
// hand-rolled HTTP/1.1 framing (single request per connection, Connection: close
// on the native/local-response paths; raw pass-through framing for anything
// tunneled to the TS backend). Every request now goes through the Router
// (D-01/ADR-02) BEFORE dispatch: native ops hit the HandlerRegistry (mirrors
// src/daemon/server.ts's request lifecycle: envelope decode → capability check →
// param dispatch → success/error envelope); everything else — including
// unregistered-at-this-milestone ops and non-`/api/v1/` paths like SSE `/events`
// — byte-tunnels to the TS backend via ProxyClient (ADR-01).
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>

import Foundation

final class SocketServer: @unchecked Sendable {
    private let registry: HandlerRegistry
    private let context: DaemonContext
    private let router: Router
    private let proxyBackendSocket: String?
    private let dualRunEnabled: Bool
    private let dualRunRecorder: DualRunRecorder?
    private var listenFD: Int32 = -1
    private let acceptQueue = DispatchQueue(label: "spectra.daemon.accept")
    private let connQueue = DispatchQueue(label: "spectra.daemon.conn", attributes: .concurrent)

    /// W0 concurrency flag (DriverProtocol.swift `Driver` doc-comment):
    /// `connQueue` above is CONCURRENT — two requests for the SAME sessionId
    /// are not otherwise serialized at dispatch, unlike the TS daemon's
    /// single-threaded event loop. S2's driver access is already
    /// per-session-serialized one layer down (BridgeClient/NativeDriver); this
    /// closes the same race at the DISPATCH layer for every session-scoped
    /// affinity-native hit, so two concurrent calls against one sessionId
    /// (e.g. two overlapping `step` calls) queue behind each other instead of
    /// racing the driver/session-store concurrently, while unrelated sessions
    /// keep dispatching fully in parallel.
    private let sessionGate = SessionDispatchGate()

    /// TS body-limit parity (T-07): mirrors src/daemon/server.ts's MAX_JSON_BYTES
    /// (1 MiB) EXACTLY — oversized-body probes must get the identical
    /// status(413)/code(bad_request) pair from both daemons. Wire.maxBodyBytes
    /// (8 MiB, WireProtocol.swift, S2-owned) remains a coarser hard ceiling on
    /// the raw header-read phase only, purely for memory safety; this smaller
    /// constant is what actually fires for parity.
    private let tsBodyLimitBytes = 1024 * 1024

    init(
        registry: HandlerRegistry,
        context: DaemonContext,
        router: Router,
        proxyBackendSocket: String?,
        dualRunEnabled: Bool,
        dualRunRecorder: DualRunRecorder?
    ) {
        self.registry = registry
        self.context = context
        self.router = router
        self.proxyBackendSocket = proxyBackendSocket
        self.dualRunEnabled = dualRunEnabled
        self.dualRunRecorder = dualRunRecorder
    }

    /// Bind + listen on the unix socket, then accept connections until stopped.
    func start(socketPath: String) throws {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw POSIXError(errno: errno, ctx: "socket()") }

        // Remove any stale socket file, then bind.
        unlink(socketPath)
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8)
        guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd); throw DaemonApiError(.internalError, "socket path too long: \(socketPath)")
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count + 1) { dst in
                for (i, b) in pathBytes.enumerated() { dst[i] = CChar(bitPattern: b) }
                dst[pathBytes.count] = 0
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
        }
        guard bindRes == 0 else { close(fd); throw POSIXError(errno: errno, ctx: "bind(\(socketPath))") }
        chmod(socketPath, Wire.socketMode)
        guard listen(fd, 64) == 0 else { close(fd); throw POSIXError(errno: errno, ctx: "listen") }

        listenFD = fd
        FileHandle.standardError.write(Data("[spectra-daemon] listening on \(socketPath) (mode 0600)\n".utf8))
        if let backend = proxyBackendSocket, !backend.isEmpty {
            FileHandle.standardError.write(Data("[spectra-daemon] proxying non-native ops to \(backend)\n".utf8))
        } else {
            FileHandle.standardError.write(Data("[spectra-daemon] no proxy backend configured — non-native ops resolve not_found\n".utf8))
        }
        let nativeList = router.nativeOps.sorted().joined(separator: ", ")
        let affinityList = router.affinityOps.sorted().joined(separator: ", ")
        let mergeList = router.mergeOps.sorted().joined(separator: ", ")
        let fanoutList = router.fanoutOps.sorted().joined(separator: ", ")
        let routingLog = "[spectra-daemon] routing config: \(router.configSource) v\(router.version) "
            + "(native: \(nativeList); affinity: \(affinityList); merge: \(mergeList); fanout: \(fanoutList))\n"
        FileHandle.standardError.write(Data(routingLog.utf8))

        acceptQueue.sync {}  // ensure queue is live
        acceptLoop()
    }

    private func acceptLoop() {
        while true {
            let clientFD = accept(listenFD, nil, nil)
            if clientFD < 0 {
                if errno == EINTR { continue }
                break
            }
            connQueue.async { [weak self] in
                self?.handleConnection(clientFD)
                close(clientFD)
            }
        }
    }

    // ─── one HTTP/1.1 request/response per connection ────────────────────────
    private func handleConnection(_ fd: Int32) {
        let start = DispatchTime.now()
        switch readRawRequest(fd) {
        case .malformed:
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Malformed HTTP request", status: 400))
        case .oversized:
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Request body exceeds daemon limit", status: 413))
            logLine(op: "-", route: "-", status: 413, start: start)
        case .ok(let method, let path, let body, let rawBytes):
            dispatch(fd: fd, method: method, path: path, body: body, rawBytes: rawBytes, start: start)
        }
    }

    /// Mirrors `eventsRoute` in src/contract/wire.ts (`/api/v1/events`). SSE
    /// lives under the `/api/v1/` prefix by path shape but is GET-only and
    /// TS-owned streaming — it must never hit the POST-only API-op guard
    /// below. No Swift-side constant exists yet to import from wire.ts, so
    /// this literal is kept in exact lockstep with that string.
    private static let eventsRoute = "/api/v1/events"

    /// Route: `/api/v1/<op>` goes through the Router (native vs proxy); every
    /// other path (incl. SSE `/events`) tunnels to the backend wholesale,
    /// regardless of HTTP method — TS owns those semantics entirely (ADR-01).
    private func dispatch(fd: Int32, method: String, path: String, body: Data, rawBytes: Data, start: DispatchTime) {
        guard path.hasPrefix(Wire.apiRoutePrefix) else {
            dispatchNonApi(fd: fd, path: path, rawBytes: rawBytes, start: start)
            return
        }

        // SSE /events sits under the /api/v1/ prefix but is not a CoreApi op:
        // it's a GET-only streaming tunnel to the TS backend (ADR-01). Route
        // it through the same non-API byte-tunnel path BEFORE the POST-only
        // guard below, so it never gets bounced with 405. Every other
        // /api/v1/<op> path is unaffected and still requires POST.
        if path == Self.eventsRoute {
            dispatchNonApi(fd: fd, path: path, rawBytes: rawBytes, start: start)
            return
        }

        guard method == "POST" else {
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "CoreApi operations require POST", status: 405))
            logLine(op: path, route: "reject", status: 405, start: start)
            return
        }

        let operation = String(path.dropFirst(Wire.apiRoutePrefix.count))
        // D-03 v2 dispatch-plane classification (SG-1). A v1-loaded Router
        // (affinityOps/mergeOps/fanoutOps all empty) degrades this switch to
        // the original v1 native/proxy split automatically — no separate v1
        // code path needed here.
        switch router.bucket(for: operation) {
        case .native:
            dispatchNative(fd: fd, operation: operation, body: body, start: start)
        case .affinity:
            dispatchAffinity(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start)
        case .merge:
            dispatchMerge(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start)
        case .fanout:
            dispatchFanout(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start)
        case .proxy:
            dispatchProxy(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start)
        }
    }

    /// Non-`/api/v1/` paths (SSE `/events`, anything else) — pure byte tunnel
    /// when a backend is configured; otherwise the pre-flip not_found behavior,
    /// unchanged.
    private func dispatchNonApi(fd: Int32, path: String, rawBytes: Data, start: DispatchTime) {
        guard let backend = proxyBackendSocket, !backend.isEmpty else {
            writeError(fd, requestId: nil, error: DaemonApiError(.notFound, "Unknown route \(path)", status: 404))
            logLine(op: path, route: "proxy", status: 404, start: start)
            return
        }
        do {
            let status = try ProxyClient.tunnel(clientFD: fd, requestBytes: rawBytes, backendSocketPath: backend)
            logLine(op: path, route: "proxy", status: status ?? 0, start: start)
        } catch {
            writeError(fd, requestId: nil, error: DaemonApiError(.daemonUnhealthy, "Backend daemon unreachable: \(error)", status: 503))
            logLine(op: path, route: "proxy", status: 503, start: start)
        }
    }

    /// Native dispatch (plain `.native` bucket — sessionless ops): decodes its
    /// own envelope, then defers to `dispatchNativeDecoded` for the shared
    /// capability-gate → handler → response tail. Unchanged behavior from v1.
    private func dispatchNative(fd: Int32, operation: String, body: Data, start: DispatchTime) {
        var requestId: String?
        do {
            let (rid, params) = try JSON.decodeEnvelope(body)
            requestId = rid
            dispatchNativeDecoded(fd: fd, operation: operation, requestId: requestId, params: params, start: start, origin: nil)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "native", status: e.status, start: start)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "native", status: 500, start: start)
        }
    }

    /// Shared native-dispatch tail: capability gate (P1 —
    /// CapabilityPolicy.shared.assert, S2-owned) BEFORE the handler runs,
    /// mirroring src/daemon/security.ts's assertCapabilities-before-param-
    /// dispatch ordering, then optional dual-run shadow diff (D-02, log-only).
    /// Used by BOTH the plain `.native` bucket (`dispatchNative`, which
    /// decodes its own envelope above) and the `.affinity` bucket's native
    /// leg (`dispatchAffinity`, which already decoded the envelope to MAKE
    /// its routing decision and must never decode twice). `origin` carries
    /// the store-hit/miss log tag for affinity-routed requests (dispatch-plane
    /// consequence (c)) — `nil` for the plain-native path, unchanged from v1.
    ///
    /// Dispatch-plane consequence (f): a native `createSession` result's
    /// SessionStore insertion happens INSIDE `entry.handler(...)` (S1's
    /// ConnectOps, synchronously, before it returns) — so by construction
    /// `writeSuccess` below can never run before the session is in the store.
    /// This function does not need (and must not add) any separate insertion
    /// step; the ordering guarantee comes from calling the handler and only
    /// THEN writing the response, exactly as every other op here already does.
    private func dispatchNativeDecoded(
        fd: Int32, operation: String, requestId: String?, params: Any?, start: DispatchTime, origin: String?
    ) {
        do {
            guard let entry = registry.entry(for: operation) else {
                // Configured native but never registered by main.swift — defensive
                // fallback only; the compiled-in 5-op default always registers.
                throw DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404)
            }
            try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation: operation)
            let result = try entry.handler(params, context)
            writeSuccess(fd, requestId: requestId, result: result)
            logLine(op: operation, route: "native", origin: origin, status: 200, start: start)
            maybeDualRun(operation: operation, params: params, swiftResult: result)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "native", origin: origin, status: e.status, start: start)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "native", origin: origin, status: 500, start: start)
        }
    }

    /// Affinity dispatch (D-03 v2, dispatch-plane consequence (a)): DECODE THE
    /// REQUEST ENVELOPE FIRST — unlike native/proxy, an affinity op's route
    /// decision depends on decoded identity (`sessionId`/`recordingId`/
    /// `target`). A decode failure here is a deterministic `bad_request`,
    /// NEVER a silent tunnel of unparsed bytes: forwarding undecodable bytes
    /// to the backend would let a malformed affinity request slip past the
    /// ONE place that was supposed to inspect its identity before routing it
    /// anywhere.
    ///
    /// Advisor ruling (Item 4/fix-work-list 2b,2c): AFTER decode and BEFORE
    /// calling `router.resolveAffinity` (which now throws `bad_request` on a
    /// missing/malformed routing identity — see its doc comment), the
    /// capability gate runs HERE, mirroring src/daemon/security.ts's
    /// assertCapabilities-before-param-dispatch ordering (fda8626) — routing
    /// itself now depends on decoded identity, so the gate has to move up to
    /// this layer instead of waiting for `dispatchNativeDecoded`'s copy
    /// (which still runs its own — cheap, idempotent — assert on the native
    /// leg, unchanged). A missing-identity `bad_request` therefore always
    /// loses to a `capability_denied` on the SAME request, exactly like TS.
    ///
    /// Session-scoped hits are additionally run through `sessionGate` (W0
    /// concurrency flag) so two concurrent requests against the SAME
    /// sessionId never race the driver/session-store at dispatch —
    /// `createSession`/`getRecording` are exempt (no existing sessionId to
    /// serialize against: createSession is creating one, getRecording keys on
    /// recordingId).
    private func dispatchAffinity(fd: Int32, operation: String, body: Data, rawBytes: Data, start: DispatchTime) {
        let requestId: String?
        let params: Any?
        do {
            (requestId, params) = try JSON.decodeEnvelope(body)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: nil, error: e)
            logLine(op: operation, route: "reject", status: e.status, start: start)
            return
        } catch {
            writeError(fd, requestId: nil, error: DaemonApiError(.badRequest, "Malformed request envelope", status: 400))
            logLine(op: operation, route: "reject", status: 400, start: start)
            return
        }

        let paramsDict = (params as? [String: Any]) ?? [:]

        // Capability check BEFORE the affinity routing decision (fda8626
        // ordering, above). `entry == nil` (configured affinity but never
        // registered) is a defensive fallback only — the loader's
        // unregisteredAffinityOp invariant makes this unreachable for a v2
        // config that actually booted; falling through to resolveAffinity/
        // dispatchNativeDecoded below reproduces the same 404 not_found this
        // path has always produced for that case.
        if let entry = registry.entry(for: operation) {
            do {
                try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation: operation)
            } catch let e as DaemonApiError {
                writeError(fd, requestId: requestId, error: e)
                logLine(op: operation, route: "reject", status: e.status, start: start)
                return
            } catch {
                writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
                logLine(op: operation, route: "reject", status: 500, start: start)
                return
            }
        }

        let decision: RouteDecision
        do {
            decision = try router.resolveAffinity(operation: operation, params: paramsDict, ctx: context)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "reject", status: e.status, start: start)
            return
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "reject", status: 500, start: start)
            return
        }

        switch decision {
        case .native:
            dispatchAffinityNative(fd: fd, operation: operation, requestId: requestId, params: params, paramsDict: paramsDict, start: start, origin: "store-hit")
        case .proxy:
            // Advisor ruling (Item 4/fix-work-list 2c): in STANDALONE mode
            // (no proxy backend configured), Swift's own store IS the only
            // store — a store-MISS here does not mean "maybe the backend
            // owns it" (there is no backend to ask), so it must dispatch
            // NATIVE instead of falling through to dispatchProxy's
            // not_found (e.g. closeSession[full]: SessionOps' close is
            // idempotent-ok even for an unknown id, matching TS). This does
            // NOT apply to `createSession`: its `.proxy` decision is a
            // TARGET-based tunnel routing choice (web/sim must always
            // tunnel, ND-3), never a "store miss" — redirecting it to native
            // here would serve a web/sim target out of Swift's own driver,
            // which is exactly the ND-3 violation Item 5's adjacent finding
            // flags. A genuinely no-backend web/sim createSession correctly
            // stays a proxy 404 below, in every topology.
            let standaloneNoBackend = proxyBackendSocket == nil || proxyBackendSocket!.isEmpty
            if operation != "createSession", standaloneNoBackend {
                dispatchAffinityNative(fd: fd, operation: operation, requestId: requestId, params: params, paramsDict: paramsDict, start: start, origin: "store-miss-native")
            } else {
                dispatchProxy(fd: fd, operation: operation, body: body, rawBytes: rawBytes, start: start, origin: "store-miss")
            }
        }
    }

    /// Shared tail for both affinity-native branches above (store-hit, and
    /// the standalone store-miss-dispatches-native case, Item 4c): runs the
    /// session-scoped request through `sessionGate` (W0) when a sessionId is
    /// present, then defers to `dispatchNativeDecoded`.
    private func dispatchAffinityNative(
        fd: Int32, operation: String, requestId: String?, params: Any?, paramsDict: [String: Any], start: DispatchTime, origin: String
    ) {
        if let sessionId = paramsDict["sessionId"] as? String, !sessionId.isEmpty {
            sessionGate.run(sessionId: sessionId) {
                dispatchNativeDecoded(fd: fd, operation: operation, requestId: requestId, params: params, start: start, origin: origin)
            }
        } else {
            dispatchNativeDecoded(fd: fd, operation: operation, requestId: requestId, params: params, start: start, origin: origin)
        }
    }

    /// Merge dispatch (D-03 v2, dispatch-plane consequence (b)): `listSessions`
    /// — call the native handler for Swift-owned sessions, tunnel a
    /// body-captured round trip for the backend's own sessions, then
    /// concatenate Swift-owned-FIRST-then-backend, each independently sorted
    /// by (createdAt, id) for deterministic cross-run ordering (T-27, run x5
    /// for stability). A backend hiccup degrades to Swift-owned-only —
    /// graceful degradation, never a hard failure of the whole call.
    private func dispatchMerge(fd: Int32, operation: String, body: Data, rawBytes: Data, start: DispatchTime) {
        var requestId: String?
        do {
            let (rid, params) = try JSON.decodeEnvelope(body)
            requestId = rid
            guard let entry = registry.entry(for: operation) else {
                throw DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404)
            }
            try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation: operation)

            let nativeResult = try entry.handler(params, context)
            let nativeSessions = sortedSummaries((nativeResult as? [String: Any])?["sessions"] as? [[String: Any]] ?? [])

            var backendSessions: [[String: Any]] = []
            if let backend = proxyBackendSocket, !backend.isEmpty,
               let captured = try? ProxyClient.tunnelCapturing(requestBytes: rawBytes, backendSocketPath: backend),
               let result = captured.envelope?["result"] as? [String: Any],
               let list = result["sessions"] as? [[String: Any]] {
                backendSessions = sortedSummaries(list)
            }

            let merged = nativeSessions + backendSessions
            writeSuccess(fd, requestId: requestId, result: ["sessions": merged] as [String: Any])
            logLine(op: operation, route: "merge", status: 200, start: start)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "merge", status: e.status, start: start)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "merge", status: 500, start: start)
        }
    }

    /// Deterministic (createdAt, id) sort for a `SessionSummary[]` — the tie
    /// break by `id` is added defensively at THIS layer (not relied upon from
    /// either store's own ordering) so merge order is stable regardless of
    /// what either side's internal listing does. `createdAt` is an ISO-8601
    /// UTC string on the wire on both sides (SessionStore's own
    /// `sessionSummaryJSON` and the TS SessionSummary shape) — lexicographic
    /// string comparison on a fixed-width ISO-8601-Z string sorts identically
    /// to chronological order, so no date parsing is needed here.
    private func sortedSummaries(_ list: [[String: Any]]) -> [[String: Any]] {
        list.sorted { a, b in
            let ca = (a["createdAt"] as? String) ?? ""
            let cb = (b["createdAt"] as? String) ?? ""
            if ca != cb { return ca < cb }
            return ((a["id"] as? String) ?? "") < ((b["id"] as? String) ?? "")
        }
    }

    /// Fanout dispatch (D-03 v2, dispatch-plane consequence (b)):
    /// `closeAllSessions` — native close + tunneled close, aggregated counts
    /// (T-27, "both sides proven closed"). The WIRE result stays byte-identical
    /// to the frozen `{success:true}` contract (core-api.ts
    /// CloseAllSessionsResult) — aggregated counts are observability-only,
    /// logged, never added as a new response field the contract spec doesn't
    /// declare. Counts are snapshotted BEFORE either close call (post-close
    /// counts are trivially 0 on both sides and prove nothing about what was
    /// actually closed).
    private func dispatchFanout(fd: Int32, operation: String, body: Data, rawBytes: Data, start: DispatchTime) {
        var requestId: String?
        do {
            let (rid, params) = try JSON.decodeEnvelope(body)
            requestId = rid
            guard let entry = registry.entry(for: operation) else {
                throw DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404)
            }
            try CapabilityPolicy.shared.assert(entry.requiredCapabilities, operation: operation)

            let nativeClosedCount = context.sessions.listSummaries().count

            var backendClosedCount: Int?
            var backendOk = false
            if let backend = proxyBackendSocket, !backend.isEmpty {
                if let listCaptured = try? ProxyClient.tunnelCapturing(
                    requestBytes: ProxyClient.syntheticRequest(operation: "listSessions"), backendSocketPath: backend
                ),
                   let result = listCaptured.envelope?["result"] as? [String: Any],
                   let list = result["sessions"] as? [[String: Any]] {
                    backendClosedCount = list.count
                }
                // Fan the real close out using the CLIENT's own captured
                // request bytes, verbatim — byte-faithful (T-27), not a
                // re-serialization.
                if let closeCaptured = try? ProxyClient.tunnelCapturing(requestBytes: rawBytes, backendSocketPath: backend) {
                    backendOk = (closeCaptured.envelope?["ok"] as? Bool) ?? false
                }
            }

            // Native close — SessionStore.closeAll is idempotent/never-throws
            // (mirrors SessionManager.close's own close_all semantics).
            _ = try entry.handler(params, context)

            writeSuccess(fd, requestId: requestId, result: ["success": true] as [String: Any])
            let counts = "native_closed=\(nativeClosedCount) backend_closed=\(backendClosedCount.map(String.init) ?? "n/a") backend_ok=\(backendOk)"
            logLine(op: operation, route: "fanout", origin: counts, status: 200, start: start)
        } catch let e as DaemonApiError {
            writeError(fd, requestId: requestId, error: e)
            logLine(op: operation, route: "fanout", status: e.status, start: start)
        } catch {
            writeError(fd, requestId: requestId, error: DaemonApiError(.internalError, "\(error)", status: 500))
            logLine(op: operation, route: "fanout", status: 500, start: start)
        }
    }

    /// Proxy dispatch: pure byte tunnel when a backend is configured (no JSON
    /// parsing of the request at all — TS validates and answers). With no
    /// backend configured (e.g. Gate A's native-only regression run), preserve
    /// the exact pre-flip behavior: not_found, still echoing requestId when the
    /// body happens to decode (best-effort — never fatal on decode failure
    /// here, since the op was going to be not_found either way). `origin`
    /// carries the store-miss log tag when called from the affinity path
    /// (`nil`, unchanged, for the plain `.proxy` bucket).
    private func dispatchProxy(fd: Int32, operation: String, body: Data, rawBytes: Data, start: DispatchTime, origin: String? = nil) {
        guard let backend = proxyBackendSocket, !backend.isEmpty else {
            let requestId = (try? JSON.decodeEnvelope(body))?.requestId
            writeError(fd, requestId: requestId, error: DaemonApiError(.notFound, "Operation \(operation) not served by this daemon", status: 404))
            logLine(op: operation, route: "proxy", origin: origin, status: 404, start: start)
            return
        }
        do {
            let status = try ProxyClient.tunnel(clientFD: fd, requestBytes: rawBytes, backendSocketPath: backend)
            logLine(op: operation, route: "proxy", origin: origin, status: status ?? 0, start: start)
        } catch {
            writeError(fd, requestId: nil, error: DaemonApiError(.daemonUnhealthy, "Backend daemon unreachable: \(error)", status: 503))
            logLine(op: operation, route: "proxy", origin: origin, status: 503, start: start)
        }
    }

    /// D-02: shadow-call the backend for the 3 dual-run-eligible read ops when
    /// SPECTRA_DUAL_RUN=1 and a backend is configured. Log-only; a shadow-call
    /// failure still produces a JSONL row (never a starved dual-run op) but
    /// never touches the response already written to the real client.
    private func maybeDualRun(operation: String, params: Any?, swiftResult: Any) {
        guard dualRunEnabled, let recorder = dualRunRecorder else { return }
        guard router.isDualRunEligible(operation) else { return }
        guard let backend = proxyBackendSocket, !backend.isEmpty else { return }
        do {
            let tsResult = try ProxyClient.shadowCall(operation: operation, params: params, backendSocketPath: backend)
            recorder.record(op: operation, tsResult: tsResult, swiftResult: swiftResult)
        } catch {
            recorder.record(op: operation, tsResult: ["__shadowCallError": "\(error)"] as [String: Any], swiftResult: swiftResult)
        }
    }

    // ─── observability (Item 7): per-request router log line ─────────────────
    // `origin` (dispatch-plane consequence (c)) carries the store-hit/miss tag
    // for affinity-routed requests (`"store-hit"`/`"store-miss"`) or the
    // aggregated-counts note for fanout; `nil` (the default, and every plain
    // native/proxy call site) prints exactly the v1 log line, unchanged.
    private func logLine(op: String, route: String, origin: String? = nil, status: Int, start: DispatchTime) {
        let elapsedNs = DispatchTime.now().uptimeNanoseconds &- start.uptimeNanoseconds
        let ms = Double(elapsedNs) / 1_000_000
        var line = String(format: "[spectra-router] op=%@ route=%@", op, route)
        if let origin { line += " origin=\(origin)" }
        line += String(format: " status=%d ms=%.2f\n", status, ms)
        FileHandle.standardError.write(Data(line.utf8))
    }

    // ─── HTTP framing ────────────────────────────────────────────────────────
    private enum RawRequest {
        case ok(method: String, path: String, body: Data, rawBytes: Data)
        case malformed
        case oversized
    }

    /// Read a full HTTP/1.1 request: headers until CRLFCRLF, then Content-Length
    /// bytes of body. `rawBytes` reconstructs exactly what the client sent
    /// (header block + body, in order) for verbatim tunnel replay — never
    /// re-parsed or re-serialized on the proxy path. `.oversized` fires the
    /// instant the declared/accumulated body exceeds the TS-parity limit
    /// (T-07), before reading further.
    private func readRawRequest(_ fd: Int32) -> RawRequest {
        var buffer = Data()
        let sep = Data("\r\n\r\n".utf8)
        var headerEnd: Int? = nil
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while headerEnd == nil {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { return .malformed }
            buffer.append(contentsOf: chunk[0..<n])
            if buffer.count > Wire.maxBodyBytes { return .malformed }
            headerEnd = range(of: sep, in: buffer)?.lowerBound
        }
        guard let hEnd = headerEnd else { return .malformed }
        let headerData = buffer.subdata(in: 0..<hEnd)
        guard let headerStr = String(data: headerData, encoding: .utf8) else { return .malformed }
        let lines = headerStr.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let requestLine = lines.first else { return .malformed }
        let parts = requestLine.split(separator: " ").map(String.init)
        guard parts.count >= 2 else { return .malformed }
        let method = parts[0]
        let path = parts[1]

        var contentLength = 0
        for line in lines.dropFirst() {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                contentLength = Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        // TS body-limit parity (T-07): src/daemon/server.ts's readBody rejects
        // with status 413 / code bad_request the instant accumulated size
        // exceeds MAX_JSON_BYTES (1 MiB) — mirror that exactly, before reading
        // any further body bytes.
        if contentLength > tsBodyLimitBytes { return .oversized }

        let bodyStart = hEnd + sep.count
        var body = buffer.count > bodyStart ? buffer.subdata(in: bodyStart..<buffer.count) : Data()
        while body.count < contentLength {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            body.append(contentsOf: chunk[0..<n])
            if body.count > tsBodyLimitBytes { return .oversized }
        }
        if contentLength > 0 && body.count > contentLength {
            body = body.subdata(in: 0..<contentLength)
        }
        let headerBlock = buffer.subdata(in: 0..<min(bodyStart, buffer.count))
        let rawBytes = headerBlock + body
        return .ok(method: method, path: path, body: body, rawBytes: rawBytes)
    }

    private func writeSuccess(_ fd: Int32, requestId: String?, result: Any) {
        writeHttp(fd, status: 200, reason: "OK", body: JSON.successEnvelope(requestId: requestId, result: result))
    }
    private func writeError(_ fd: Int32, requestId: String?, error: DaemonApiError) {
        writeHttp(fd, status: error.status, reason: reason(for: error.status), body: JSON.errorEnvelope(requestId: requestId, error: error))
    }

    private func writeHttp(_ fd: Int32, status: Int, reason: String, body: Data) {
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        out.withUnsafeBytes { raw in
            var off = 0
            let base = raw.bindMemory(to: UInt8.self).baseAddress!
            while off < out.count {
                let w = write(fd, base + off, out.count - off)
                if w <= 0 { break }
                off += w
            }
        }
    }

    private func reason(for status: Int) -> String {
        switch status {
        case 200: return "OK"; case 400: return "Bad Request"; case 403: return "Forbidden"
        case 404: return "Not Found"; case 405: return "Method Not Allowed"; case 413: return "Payload Too Large"
        case 500: return "Internal Server Error"; case 503: return "Service Unavailable"
        default: return "Status"
        }
    }

    private func range(of needle: Data, in haystack: Data) -> Range<Int>? {
        guard needle.count <= haystack.count else { return nil }
        let end = haystack.count - needle.count
        var i = 0
        while i <= end {
            if haystack.subdata(in: i..<(i + needle.count)) == needle { return i..<(i + needle.count) }
            i += 1
        }
        return nil
    }
}

struct POSIXError: Error, CustomStringConvertible {
    let code: Int32
    let ctx: String
    init(errno code: Int32, ctx: String) { self.code = code; self.ctx = ctx }
    var description: String { "\(ctx): errno \(code) (\(String(cString: strerror(code))))" }
}

/// W0 concurrency flag (M3.G2, DriverProtocol.swift `Driver` doc-comment):
/// `SocketServer.connQueue` is `.concurrent` — two connections dispatching
/// concurrently against the SAME sessionId are not otherwise serialized
/// anywhere above the driver layer. `SessionDispatchGate` closes that at
/// dispatch: a lazily-created serial `DispatchQueue` per sessionId, so a
/// session-scoped request queues behind any other in-flight request for that
/// SAME sessionId, while unrelated sessions continue to dispatch fully
/// concurrently on `connQueue`. Per-session queues are created once and never
/// removed — a bounded, per-distinct-sessionId cost for the process lifetime,
/// not a correctness issue (sessions are already process-lifetime-bounded;
/// closeSession/closeAllSessions do not need to reclaim this bookkeeping for
/// dispatch to stay correct).
final class SessionDispatchGate: @unchecked Sendable {
    private let lock = NSLock()
    private var perSession: [String: DispatchQueue] = [:]

    private func queue(for sessionId: String) -> DispatchQueue {
        lock.lock(); defer { lock.unlock() }
        if let existing = perSession[sessionId] { return existing }
        let created = DispatchQueue(label: "spectra.daemon.session.\(sessionId)")
        perSession[sessionId] = created
        return created
    }

    /// Runs `body` synchronously, serialized against any other call for the
    /// SAME sessionId. The calling thread (one of `connQueue`'s concurrent
    /// worker threads) blocks until its turn on that session's serial queue,
    /// then runs `body` — different sessionIds never block each other.
    func run(sessionId: String, _ body: () -> Void) {
        queue(for: sessionId).sync(execute: body)
    }
}
