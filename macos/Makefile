# Spectra — macOS menu-bar app
# Build, archive, and package as DMG. Pattern lifted from
# ~/dev/git-folder/secrets-vault/SecretsVault/Makefile (proven path per
# feedback_macos_keychain_signing.md).
#
# Usage:
#   make build         — Release build with full signing
#   make build-adhoc   — Release build with ad-hoc sign (no Apple Dev cert needed)
#   make dmg           — Build + bundle into release/Spectra.dmg (signed)
#   make dmg-adhoc     — Build + bundle into release/Spectra.dmg (ad-hoc)
#   make clean         — Wipe build + release directories

PROJECT      = Spectra.xcodeproj
SCHEME       = Spectra
CONFIG       = Release
BUILD_DIR    = build
DERIVED      = $(BUILD_DIR)/derived
RELEASE_DIR  = release
APP_NAME     = Spectra
TEAM_ID      = 7AK2KDLAVP

.PHONY: build build-adhoc dmg dmg-adhoc clean run test test-adhoc size verify

# Debug build, for local run from Xcode-style invocations
run:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration Debug \
		-derivedDataPath $(DERIVED) \
		build

# Release build with Apple Development signing (Team 7AK2KDLAVP).
# Requires that a "Mac Development" provisioning profile for
# dev.spectra.app exists in the user's keychain. To create one:
#   - Open Spectra.xcodeproj in Xcode once
#   - Xcode → Signing & Capabilities → Automatically manage signing
#     → pick the same team — Xcode will create + install the profile.
# Or use `make build-adhoc` if you don't have the Apple Dev account.
build:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-derivedDataPath $(DERIVED) \
		DEVELOPMENT_TEAM=$(TEAM_ID) \
		build

# Ad-hoc-signed Release build — runs on this machine but no biometric
# Keychain (per feedback_macos_keychain_signing.md). Use for local
# smoke tests, NOT for shipping artifacts.
build-adhoc:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration $(CONFIG) \
		-derivedDataPath $(DERIVED) \
		CODE_SIGN_IDENTITY="-" \
		CODE_SIGNING_REQUIRED=NO \
		CODE_SIGNING_ALLOWED=NO \
		build

# Test (XCTest unit tests)
test:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration Debug \
		-derivedDataPath $(DERIVED) \
		DEVELOPMENT_TEAM=$(TEAM_ID) \
		test

test-adhoc:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration Debug \
		-derivedDataPath $(DERIVED) \
		CODE_SIGN_IDENTITY="-" \
		CODE_SIGNING_REQUIRED=NO \
		CODE_SIGNING_ALLOWED=NO \
		test

# Bundle the Release build into a DMG (signed path). The Release build
# is already signed by xcodebuild; this just packages the .app.
dmg: build
	@$(MAKE) _dmg-package

# Same, but starting from an ad-hoc Release build.
dmg-adhoc: build-adhoc
	@$(MAKE) _dmg-package

# Internal — package whatever just landed in the derived products dir.
_dmg-package:
	@mkdir -p $(RELEASE_DIR)
	@mkdir -p $(BUILD_DIR)/dmg-staging
	rm -rf "$(BUILD_DIR)/dmg-staging/$(APP_NAME).app"
	cp -R "$(DERIVED)/Build/Products/$(CONFIG)/$(APP_NAME).app" \
		"$(BUILD_DIR)/dmg-staging/$(APP_NAME).app"
	rm -f "$(RELEASE_DIR)/$(APP_NAME).dmg"
	hdiutil create \
		-volname "$(APP_NAME)" \
		-srcfolder "$(BUILD_DIR)/dmg-staging" \
		-ov -format UDZO \
		"$(RELEASE_DIR)/$(APP_NAME).dmg"
	@echo "DMG: $(RELEASE_DIR)/$(APP_NAME).dmg"

# codesign --verify the most-recent build product
verify:
	codesign --verify --deep --strict --verbose=2 \
		"$(DERIVED)/Build/Products/$(CONFIG)/$(APP_NAME).app"

clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(RELEASE_DIR)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) clean || true

size:
	@du -sh "$(DERIVED)/Build/Products/$(CONFIG)/$(APP_NAME).app" 2>/dev/null \
		|| echo "Run 'make build' first."
