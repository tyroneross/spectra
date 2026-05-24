// KeychainStore.swift
//
// Biometric-protected Keychain storage for the Anthropic API key.
//
// On read, macOS prompts the user with Touch ID / password (depending on the
// device + ACL flags). The key never leaves the user's local machine and is
// never logged. The daemon NEVER has access to this — only the in-process app.
//
// IMPORTANT — signing prerequisite:
//   `kSecAttrAccessControl` with `.biometryCurrentSet` requires a real
//   Apple Development cert + Team ID match. Ad-hoc signed bundles fail with
//   `errSecAuthFailed (-25293)` on `SecItemAdd`. See
//   `feedback_macos_keychain_signing.md`. We fall back to a passcode-only
//   ACL automatically when biometry is unavailable, and to a plain (no
//   access control) item when even that fails — surfacing the degraded
//   security mode via `lastSecurityLevel`.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>

import Foundation
import Security
import LocalAuthentication

public enum KeychainError: Error, LocalizedError, Equatable {
    case notFound
    case authFailed(OSStatus)
    case writeFailed(OSStatus)
    case readFailed(OSStatus)
    case malformed

    public var errorDescription: String? {
        switch self {
        case .notFound: return "No API key stored. Add one in Settings."
        case .authFailed(let s): return "Keychain auth failed (\(s))."
        case .writeFailed(let s): return "Keychain write failed (\(s))."
        case .readFailed(let s): return "Keychain read failed (\(s))."
        case .malformed: return "Keychain returned data in an unexpected format."
        }
    }
}

/// Security tier we ultimately stored the secret under. UI surfaces this.
public enum KeychainSecurityLevel: String, Sendable {
    case biometric         // touch-id + currentSet
    case passcode          // device passcode required
    case standard          // accessible-when-unlocked, no ACL
    case unknown
}

public final class KeychainStore: @unchecked Sendable {

    public static let shared = KeychainStore()

    /// Service identifier for SecItem queries. Bundle id is fine; keychain
    /// items are keyed by (service, account).
    public let service: String
    /// Account name — single per-app key.
    public let account: String

    /// Tier the last successful `save()` used. Read-only.
    public private(set) var lastSecurityLevel: KeychainSecurityLevel = .unknown

    public init(service: String = "dev.spectra.app", account: String = "anthropic-api-key") {
        self.service = service
        self.account = account
    }

    // ─── Public API ──────────────────────────────────────────

    /// Store the API key. Tries biometric-protected first; falls back through
    /// passcode → standard. Returns the security level we landed on.
    @discardableResult
    public func saveApiKey(_ key: String) throws -> KeychainSecurityLevel {
        guard let data = key.data(using: .utf8), !key.isEmpty else { throw KeychainError.malformed }

        // Best to try biometric. If that returns errSecAuthFailed (signing
        // wall) we degrade and tell the UI what tier we used.
        if (try? saveWithAccessControl(data, flags: [.biometryCurrentSet])) == true,
           verifyStored() {
            lastSecurityLevel = .biometric
            return .biometric
        }
        if (try? saveWithAccessControl(data, flags: [.devicePasscode])) == true,
           verifyStored() {
            lastSecurityLevel = .passcode
            return .passcode
        }
        try saveStandard(data)
        lastSecurityLevel = .standard
        return .standard
    }

    /// Read the API key. Throws `KeychainError.notFound` if absent, .authFailed
    /// if the user denies biometric/passcode, .readFailed for any other error.
    public func loadApiKey() throws -> String {
        let context = LAContext()
        // Allow biometric AND fallback to passcode in one auth prompt.
        context.localizedReason = "Authenticate to use your Anthropic API key"
        // Setting interactionNotAllowed=false explicitly allows the OS UI.
        // Replaces deprecated kSecUseAuthenticationUIAllow.
        context.interactionNotAllowed = false
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
            kSecUseAuthenticationContext: context,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { throw KeychainError.notFound }
        if status == errSecAuthFailed || status == errSecUserCanceled {
            throw KeychainError.authFailed(status)
        }
        guard status == errSecSuccess else { throw KeychainError.readFailed(status) }
        guard let data = item as? Data, let s = String(data: data, encoding: .utf8), !s.isEmpty else {
            throw KeychainError.malformed
        }
        return s
    }

    /// Returns true iff an item exists for our (service, account). Does not
    /// fetch the secret — safe to call without triggering biometric prompts.
    public func hasApiKey() -> Bool {
        let context = LAContext()
        // Tell the OS we forbid interactive auth on this query; protected items
        // then return `errSecInteractionNotAllowed`, which we treat as "present".
        context.interactionNotAllowed = true
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecMatchLimit: kSecMatchLimitOne,
            kSecUseAuthenticationContext: context,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    /// Delete the stored key. No-op if nothing is stored.
    public func deleteApiKey() throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainError.writeFailed(status)
        }
    }

    // ─── Internals ───────────────────────────────────────────

    private func saveWithAccessControl(_ data: Data, flags: SecAccessControlCreateFlags) throws -> Bool {
        var err: Unmanaged<CFError>?
        guard let acl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            flags,
            &err
        ) else {
            return false
        }

        // Remove any prior item.
        _ = SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ] as CFDictionary)

        let attrs: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: data,
            kSecAttrAccessControl: acl,
        ]
        let status = SecItemAdd(attrs as CFDictionary, nil)
        if status != errSecSuccess {
            throw KeychainError.writeFailed(status)
        }
        return true
    }

    private func saveStandard(_ data: Data) throws {
        _ = SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ] as CFDictionary)

        let attrs: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemAdd(attrs as CFDictionary, nil)
        if status != errSecSuccess {
            throw KeychainError.writeFailed(status)
        }
    }

    private func verifyStored() -> Bool {
        // Just check presence; do NOT trigger a biometric prompt during save.
        return hasApiKey()
    }
}
