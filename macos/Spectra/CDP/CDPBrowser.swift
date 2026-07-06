// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

public struct CDPBrowserOptions: Sendable {
    public var headless: Bool
    public var port: Int?
    public var userDataDirectory: URL?

    public init(headless: Bool = true, port: Int? = nil, userDataDirectory: URL? = nil) {
        self.headless = headless
        self.port = port
        self.userDataDirectory = userDataDirectory
    }
}

public final class CDPBrowserManager {
    public static let chromePaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
    ]

    private var process: Process?
    private var port = 0

    public init() {}

    public static func findChrome() -> String? {
        chromePaths.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    public var running: Bool {
        process?.isRunning == true
    }

    public func launch(options: CDPBrowserOptions = CDPBrowserOptions()) async throws -> String {
        guard let chromePath = Self.findChrome() else {
            throw CDPError.browserNotFound(Self.chromePaths)
        }

        port = options.port ?? Int.random(in: 49152...65535)
        let userDataDirectory = options.userDataDirectory ?? defaultUserDataDirectory()
        try FileManager.default.createDirectory(at: userDataDirectory, withIntermediateDirectories: true)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: chromePath)
        proc.arguments = [
            "--remote-debugging-port=\(port)",
            "--user-data-dir=\(userDataDirectory.path)",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-sync",
            "--password-store=basic",
            "--use-mock-keychain",
        ] + (options.headless ? ["--headless=new"] : [])
        proc.standardOutput = Pipe()
        proc.standardError = Pipe()
        try proc.run()
        process = proc

        return try await waitForDebugger()
    }

    public func close() {
        guard let process else { return }
        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.25)
            if process.isRunning {
                process.interrupt()
            }
        }
        self.process = nil
    }

    private func defaultUserDataDirectory() -> URL {
        let home = ProcessInfo.processInfo.environment["HOME"]
            .map(URL.init(fileURLWithPath:))
            ?? FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".spectra/chromium-profile", isDirectory: true)
    }

    private func waitForDebugger() async throws -> String {
        let versionURL = URL(string: "http://127.0.0.1:\(port)/json/version")!
        for _ in 0..<50 {
            do {
                let (data, _) = try await URLSession.shared.data(from: versionURL)
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                if let ws = object?["webSocketDebuggerUrl"] as? String, !ws.isEmpty {
                    return ws
                }
            } catch {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        throw CDPError.debuggerUnavailable(port: port)
    }
}
