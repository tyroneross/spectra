// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import XCTest
@testable import Spectra

final class CDPPortTests: XCTestCase {
    func testFingerprintUsesOnlyActionableElements() {
        let elements = [
            CDPElement(
                id: "group",
                role: "group",
                label: "Container",
                value: nil,
                enabled: true,
                focused: false,
                actions: [],
                bounds: [0, 0, 0, 0],
                parent: nil
            ),
            CDPElement(
                id: "button",
                role: "button",
                label: "Continue",
                value: nil,
                enabled: true,
                focused: false,
                actions: ["press"],
                bounds: [0, 0, 0, 0],
                parent: nil
            ),
        ]

        XCTAssertEqual(buildCDPFingerprint(elements), "button:Continue:true")
    }

    func testSnapshotMetadataMatchesElementCount() {
        let snapshot = CDPSnapshot(
            url: "data:text/html,<button>OK</button>",
            platform: "web",
            elements: [
                CDPElement(
                    id: "button",
                    role: "button",
                    label: "OK",
                    value: nil,
                    enabled: true,
                    focused: false,
                    actions: ["press"],
                    bounds: [0, 0, 0, 0],
                    parent: nil
                ),
            ],
            timestamp: 1,
            metadata: CDPSnapshotMetadata(elementCount: 1, timedOut: false)
        )

        XCTAssertEqual(snapshot.metadata.elementCount, snapshot.elements.count)
        XCTAssertFalse(snapshot.metadata.timedOut)
    }
}
