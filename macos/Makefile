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
TEAM_ID      = Q6TB8685V9

.PHONY: build build-adhoc dmg dmg-adhoc clean run test test-adhoc size verify embed-helpers

# Native helper executables embedded into Contents/Helpers/ (native-Swift
# migration M1). These are the SAME binaries produced today by the bare-exec
# pipeline (`npm run build:native` / `build:composite` / `build:cursor-sampler`
# / `build:window-bounds` / `build:daemon-helper`, from the repo root) at
# ~/.spectra/bin — this target only copies + (re)signs whatever already
# exists there. It does not build/compile Swift itself, so it never touches
# native/swift/ sources.
SPECTRA_HELPERS = spectra-native spectra-composite-capture \
	spectra-screen-recording-preflight spectra-cursor-sampler \
	spectra-daemon-launcher spectra-window-bounds
SPECTRA_BIN_DIR = $(HOME)/.spectra/bin

# Debug build, for local run from Xcode-style invocations
run:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration Debug \
		-derivedDataPath $(DERIVED) \
		build

# Release build with Apple Development signing (Team Q6TB8685V9).
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

# Copy already-built native helper executables from ~/.spectra/bin into the
# built app's Contents/Helpers/, then re-sign each with the app's own signing
# identity (when signing is enabled) so it inherits Spectra.app's TCC identity.
# Invoked as a postBuildScripts phase from project.yml (env vars like
# CODESIGNING_FOLDER_PATH / CODE_SIGNING_ALLOWED / EXPANDED_CODE_SIGN_IDENTITY
# come from the enclosing xcodebuild script-phase environment). Safe to run
# standalone too (e.g. `make embed-helpers` after `make build`) — falls back
# to $(DERIVED)/Build/Products/$(CONFIG)/$(APP_NAME).app when the Xcode-only
# env vars aren't set. Additive/idempotent; never fails the enclosing build —
# a helper not yet built at $(SPECTRA_BIN_DIR) is skipped with a warning.
embed-helpers:
	@if [ -n "$${CODESIGNING_FOLDER_PATH:-}" ]; then \
		dest="$${CODESIGNING_FOLDER_PATH}/Contents/Helpers"; \
	elif [ -n "$${TARGET_BUILD_DIR:-}" ] && [ -n "$${CONTENTS_FOLDER_PATH:-}" ]; then \
		dest="$${TARGET_BUILD_DIR}/$${CONTENTS_FOLDER_PATH}/Helpers"; \
	else \
		dest="$(DERIVED)/Build/Products/$(CONFIG)/$(APP_NAME).app/Contents/Helpers"; \
	fi; \
	mkdir -p "$$dest"; \
	for h in $(SPECTRA_HELPERS); do \
		src="$(SPECTRA_BIN_DIR)/$$h"; \
		if [ -x "$$src" ]; then \
			cp -f "$$src" "$$dest/$$h"; \
			if [ "$${CODE_SIGNING_ALLOWED:-YES}" != "NO" ] && [ -n "$${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then \
				codesign --force --timestamp=none --options runtime \
					-i "dev.spectra.$${h#spectra-}" \
					--sign "$${EXPANDED_CODE_SIGN_IDENTITY}" "$$dest/$$h"; \
			fi; \
			echo "embed-helpers: embedded $$h -> $$dest/$$h"; \
		else \
			echo "embed-helpers: SKIP $$h (not built at $$src -- run the repo-root npm build:* scripts first)"; \
		fi; \
	done

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
