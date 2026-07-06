// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation

#if SPECTRA_CDP_SMOKE
@main
enum CDPSmokeMain {
    static func main() async {
        let url = CommandLine.arguments.dropFirst().first
            ?? "data:text/html,<title>Spectra CDP Smoke</title><button id='ok'>OK</button><script>console.log('ready')</script>"
        let profile = FileManager.default.temporaryDirectory
            .appendingPathComponent("spectra-cdp-smoke-\(UUID().uuidString)", isDirectory: true)
        let driver = CDPDriver(browserOptions: CDPBrowserOptions(headless: true, userDataDirectory: profile))

        do {
            try await driver.connect(target: CDPDriverTarget(url: url))
            try await driver.navigate("data:text/html,<title>Spectra CDP Smoke 2</title><button>Continue</button>")
            let matches = try await driver.queryAXTree(accessibleName: "Continue", role: "button")
            let snapshot = try await driver.snapshot()
            let png = try await driver.screenshot()
            print("url=\(snapshot.url ?? "")")
            print("elements=\(snapshot.elements.count)")
            print("queryMatches=\(matches.count)")
            print("pngBytes=\(png.count)")
            if png.isEmpty || snapshot.elements.isEmpty || matches.isEmpty {
                throw CDPError.invalidResponse("Smoke produced empty screenshot, AX tree, or query result")
            }
            await driver.close()
            try? FileManager.default.removeItem(at: profile)
        } catch {
            await driver.close()
            try? FileManager.default.removeItem(at: profile)
            fputs("spectra-cdp-smoke failed: \(error.localizedDescription)\n", stderr)
            Foundation.exit(1)
        }
    }
}
#endif
