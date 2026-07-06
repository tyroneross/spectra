// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public final class CDPDriver {
    private let connection: CDPConnection
    private let browser: CDPBrowserManager
    private let browserOptions: CDPBrowserOptions

    private var targetDomain: CDPTargetDomain?
    private var accessibility: CDPAccessibilityDomain?
    private var consoleDomain: CDPConsoleDomain?
    private var input: CDPInputDomain?
    private var page: CDPPageDomain?
    private var dom: CDPDOMDomain?
    private var runtime: CDPRuntimeDomain?

    private var targetID: String?
    private var sessionID: String?
    private var currentURL: String?

    public init(browserOptions: CDPBrowserOptions = CDPBrowserOptions()) {
        self.connection = CDPConnection()
        self.browser = CDPBrowserManager()
        self.browserOptions = browserOptions
    }

    public func connect(target: CDPDriverTarget) async throws {
        let wsURL = try await browser.launch(options: browserOptions)
        try await connection.connect(wsURL)

        let targetDomain = CDPTargetDomain(connection: connection)
        self.targetDomain = targetDomain
        let url = target.url ?? "about:blank"
        let targetID = try await targetDomain.createPage(url: url)
        self.targetID = targetID
        currentURL = url

        let sessionID = try await targetDomain.attach(targetID: targetID)
        self.sessionID = sessionID

        let accessibility = CDPAccessibilityDomain(connection: connection, sessionID: sessionID)
        let consoleDomain = CDPConsoleDomain(connection: connection, sessionID: sessionID)
        let input = CDPInputDomain(connection: connection, sessionID: sessionID)
        let page = CDPPageDomain(connection: connection, sessionID: sessionID)
        let dom = CDPDOMDomain(connection: connection, sessionID: sessionID)
        let runtime = CDPRuntimeDomain(connection: connection, sessionID: sessionID)

        self.accessibility = accessibility
        self.consoleDomain = consoleDomain
        self.input = input
        self.page = page
        self.dom = dom
        self.runtime = runtime

        try await accessibility.enable()
        try await consoleDomain.enable()
        try await page.enableLifecycleEvents()
        _ = try await waitForStableCDPTree { try await accessibility.getSnapshot() }
    }

    public func snapshot() async throws -> CDPSnapshot {
        guard let accessibility else { throw CDPError.notConnected }
        let stable = try await waitForStableCDPTree { try await accessibility.getSnapshot() }
        var url = currentURL
        if let runtime {
            do {
                if let href = try await runtime.evaluate("globalThis.location?.href ?? document.location.href") as? String,
                   !href.isEmpty {
                    currentURL = href
                    url = href
                }
            } catch {
                // Keep last known URL when runtime is unavailable.
            }
        }
        return CDPSnapshot(
            url: url,
            platform: "web",
            elements: stable.elements,
            timestamp: CDPJSON.millisNow(),
            metadata: CDPSnapshotMetadata(elementCount: stable.elements.count, timedOut: stable.timedOut)
        )
    }

    public func act(elementID: String, action: CDPActionType, value: String? = nil) async throws -> CDPActResult {
        guard let accessibility, let dom, let input else { throw CDPError.notConnected }
        guard let backendNodeID = accessibility.getBackendNodeID(elementID: elementID) else {
            return CDPActResult(
                success: false,
                error: "Element \(elementID) not found in AX tree",
                snapshot: try await snapshot()
            )
        }

        do {
            let center = try await dom.getElementCenter(backendNodeID: backendNodeID)
            switch action {
            case .click:
                try await input.click(x: center.x, y: center.y)
            case .type:
                try await input.click(x: center.x, y: center.y)
                if let value { try await input.type(value) }
            case .clear:
                try await input.click(x: center.x, y: center.y)
                _ = try await runtime?.evaluate("document.activeElement && (document.activeElement.value = '')")
            case .scroll:
                try await input.scroll(x: center.x, y: center.y, deltaX: 0, deltaY: Double(Int(value ?? "100") ?? 100))
            case .hover:
                _ = try await connection.send(
                    "Input.dispatchMouseEvent",
                    params: ["type": "mouseMoved", "x": center.x, "y": center.y],
                    sessionID: sessionID
                )
            case .focus, .select:
                try await input.click(x: center.x, y: center.y)
            }
            return CDPActResult(success: true, error: nil, snapshot: try await snapshot())
        } catch {
            return CDPActResult(success: false, error: error.localizedDescription, snapshot: try await snapshot())
        }
    }

    public func screenshot() async throws -> Data {
        guard let page else { throw CDPError.notConnected }
        return try await page.screenshot()
    }

    public func navigate(_ url: String) async throws {
        guard let page, let accessibility else { throw CDPError.notConnected }
        try await page.navigate(url: url)
        currentURL = url
        _ = try await waitForStableCDPTree { try await accessibility.getSnapshot() }
    }

    public func queryAXTree(accessibleName: String? = nil, role: String? = nil) async throws -> [CDPElement] {
        guard let accessibility else { throw CDPError.notConnected }
        return try await accessibility.queryAXTree(accessibleName: accessibleName, role: role)
    }

    public var console: CDPConsoleDomain? {
        consoleDomain
    }

    public func getConnection() -> (connection: CDPConnection, sessionID: String?) {
        (connection, sessionID)
    }

    public func close() async {
        if let targetID {
            try? await targetDomain?.close(targetID: targetID)
        }
        await connection.close()
        browser.close()
        self.targetID = nil
        self.sessionID = nil
    }

    public func disconnect() async {
        await close()
    }
}
