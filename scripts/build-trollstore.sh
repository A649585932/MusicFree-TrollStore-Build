#!/usr/bin/env bash
# =============================================================================
# MusicFree -> TrollStore .tipa build script  (ASCII-only, LF line endings)
#
#   1. The repo already contains a full RN iOS project (ios/MusicFree.xcodeproj
#      + Podfile), so we just compile that target.
#   2. TrollStore bypasses code-signing via CoreTrust, so the artifact needs
#      no Apple developer certificate: xcodebuild with signing disabled.
#   3. .tipa is just a zip whose outermost entry is Payload/MusicFree.app.
#
# Requires: macOS + Xcode + Node >= 18 + CocoaPods (ldid optional)
# Usage:    bash scripts/build-trollstore.sh
#           SCHEME=MusicFreeNew NEW_ARCH=0 SIGN_TOOL=none bash scripts/build-trollstore.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCHEME="${SCHEME:-MusicFreeNew}"
WORKSPACE="${WORKSPACE:-ios/MusicFree.xcworkspace}"
CONFIGURATION="${CONFIGURATION:-Release}"
SDK="${SDK:-iphoneos}"
APP_NAME="${APP_NAME:-MusicFree.app}"
BUNDLE_ID="${BUNDLE_ID:-app.musicfree.trollstore}"
OUTPUT_NAME="${OUTPUT_NAME:-MusicFree.trollstore.tipa}"
NEW_ARCH="${NEW_ARCH:-0}"
SIGN_TOOL="${SIGN_TOOL:-none}"
SKIP_POD_INSTALL="${SKIP_POD_INSTALL:-0}"
SKIP_NPM="${SKIP_NPM:-0}"

BUILD_DIR="$ROOT/build"
ARCHIVE_PATH="$BUILD_DIR/MusicFree.xcarchive"
DERIVED_DATA="$BUILD_DIR/DerivedData"
STAGE_DIR="$BUILD_DIR/trollstore"
ENTITLEMENTS="$ROOT/scripts/trollstore.entitlements.plist"
OUTPUT="$BUILD_DIR/$OUTPUT_NAME"

log() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "macOS required (xcodebuild / CocoaPods / codesign)"
command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild not found; install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
[ -f "$ENTITLEMENTS" ] || die "missing entitlements: $ENTITLEMENTS"

export RCT_NEW_ARCH_ENABLED="$NEW_ARCH"
export EXPO_NO_TELEMETRY=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

xcodebuild -version
node --version

# ---------------------------- 1. JS deps -------------------------------------
log "[1/6] Install npm dependencies"
if [ "$SKIP_NPM" != "1" ]; then
    # Upstream package-lock.json is out of sync with package.json (missing
    # fsevents / lightningcss-* optional platform packages), so npm ci fails
    # with EUSAGE on npm >= 10. Fall back to npm install, which fixes the lock.
    if npm ci --no-audit --no-fund; then
        echo "npm ci OK"
    else
        echo "WARNING: npm ci failed (lock out of sync), falling back to npm install"
        npm install --no-audit --no-fund
    fi
else
    echo "SKIP_NPM=1, skipped"
fi

# ---------------------------- 2. CocoaPods -----------------------------------
log "[2/6] pod install (generates .xcworkspace / Pods / ExpoModulesProvider)"
if [ "$SKIP_POD_INSTALL" != "1" ]; then
    if [ -f Gemfile ] && command -v bundle >/dev/null 2>&1; then
        bundle install || echo "WARNING: bundle install failed, using system CocoaPods"
        if bundle exec pod --version >/dev/null 2>&1; then
            POD=(bundle exec pod)
        else
            POD=(pod)
        fi
    else
        POD=(pod)
    fi
    ( cd ios && RCT_NEW_ARCH_ENABLED="$NEW_ARCH" "${POD[@]}" install )
else
    echo "SKIP_POD_INSTALL=1, skipped"
fi

[ -d "$WORKSPACE" ] || die "workspace not found: $WORKSPACE (pod install failed?)"

# ---------------------------- 3. unsigned archive ----------------------------
log "[3/6] xcodebuild archive with signing disabled"
rm -rf "$ARCHIVE_PATH"
mkdir -p "$BUILD_DIR"

XCB_ARGS=(
    -workspace "$WORKSPACE"
    -scheme "$SCHEME"
    -configuration "$CONFIGURATION"
    -sdk "$SDK"
    -destination "generic/platform=iOS"
    -archivePath "$ARCHIVE_PATH"
    -derivedDataPath "$DERIVED_DATA"
    CODE_SIGNING_ALLOWED=NO
    CODE_SIGNING_REQUIRED=NO
    CODE_SIGN_IDENTITY=""
    CODE_SIGN_ENTITLEMENTS=""
    DEVELOPMENT_TEAM=""
    PROVISIONING_PROFILE_SPECIFIER=""
    PROVISIONING_PROFILE=""
    ENABLE_BITCODE=NO
    SKIP_INSTALL=NO
    ONLY_ACTIVE_ARCH=NO
    RCT_NEW_ARCH_ENABLED="$NEW_ARCH"
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
    clean archive
)
xcodebuild "${XCB_ARGS[@]}" 2>&1 | tee "$BUILD_DIR/xcodebuild.log"

APP_SRC="$ARCHIVE_PATH/Products/Applications/$APP_NAME"
[ -d "$APP_SRC" ] || die "no $APP_NAME in archive, see $BUILD_DIR/xcodebuild.log"

if [ -f "$APP_SRC/main.jsbundle" ]; then
    echo "main.jsbundle embedded (offline launch OK)"
else
    echo "WARNING: main.jsbundle missing; check 'Bundle React Native code and images' phase in xcodebuild.log"
fi

# ---------------------------- 4. assemble Payload ----------------------------
log "[4/6] Assemble Payload/$APP_NAME"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/Payload"
cp -Rp "$APP_SRC" "$STAGE_DIR/Payload/"
find "$STAGE_DIR/Payload" -name '.DS_Store' -delete 2>/dev/null || true
find "$STAGE_DIR/Payload" -name '__MACOSX' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ---------------------------- 5. optional fakesign ---------------------------
log "[5/6] Optional fakesign (default none: TrollStore signs on install)"

sign_with_ldid() {
    ldid -S"$ENTITLEMENTS" "$STAGE_DIR/Payload/$APP_NAME"
    echo "ldid fakesign done"
}

sign_with_codesign() {
    local app="$STAGE_DIR/Payload/$APP_NAME"
    if [ -d "$app/Frameworks" ]; then
        find "$app/Frameworks" \( -name '*.framework' -o -name '*.dylib' -o -name '*.appex' \) -print0 |
            while IFS= read -r -d '' item; do
                codesign --force --sign - --timestamp=none "$item" 2>/dev/null || true
            done
    fi
    codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$app"
    echo "codesign ad-hoc fakesign done"
}

case "$SIGN_TOOL" in
    none)
        echo "SIGN_TOOL=none, skipped (recommended)"
        ;;
    ldid)
        command -v ldid >/dev/null 2>&1 || die "ldid not found: brew install ldid, or use SIGN_TOOL=codesign"
        sign_with_ldid
        ;;
    codesign)
        sign_with_codesign
        ;;
    auto)
        if command -v ldid >/dev/null 2>&1; then
            sign_with_ldid
        else
            echo "ldid missing, falling back to codesign ad-hoc"
            sign_with_codesign
        fi
        ;;
    *) die "unknown SIGN_TOOL=$SIGN_TOOL (auto|ldid|codesign|none)" ;;
esac

# ---------------------------- 6. zip .tipa -----------------------------------
log "[6/6] Package .tipa"
rm -f "$OUTPUT"
( cd "$STAGE_DIR" && zip -qry "$OUTPUT" Payload -x '*.DS_Store' '*__MACOSX*' )

log "Artifact verification"
echo "== zip top-level entries (should be Payload/ only) =="
unzip -Z1 "$OUTPUT" | awk -F/ '{print $1}' | sort -u
echo
echo "== first 20 entries =="
unzip -l "$OUTPUT" | sed -n '1,20p'
echo
echo "== Info.plist key fields =="
plutil -p "$STAGE_DIR/Payload/$APP_NAME/Info.plist" 2>/dev/null |
    grep -E 'CFBundleIdentifier|CFBundleShortVersionString|MinimumOSVersion|NSAllowsArbitraryLoads|UIFileSharingEnabled|UIBackgroundModes|CFBundleURLTypes' || true
echo
echo "== signature status =="
codesign -dv "$STAGE_DIR/Payload/$APP_NAME" 2>&1 | sed -n '1,12p' || true
echo
echo "== SHA-256 =="
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$OUTPUT"; else openssl dgst -sha256 "$OUTPUT"; fi

printf '\n\033[1;32mDONE: %s\033[0m\n' "$OUTPUT"
cat <<'EOF'

Install:
  1. Copy the .tipa to the iPhone (AirDrop / Files / Safari download)
  2. Open it with TrollStore -> Install (permasigned, no 7-day refresh)
  3. If prompted about an untrusted enterprise developer, run
     TrollStore -> Settings -> Refresh App Registrations
EOF
