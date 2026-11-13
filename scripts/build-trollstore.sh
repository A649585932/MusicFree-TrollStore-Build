#!/usr/bin/env bash
# =============================================================================
# MusicFree 鈫?TrollStore .tipa 涓€閿瀯寤鸿剼鏈?#
# 鍘熺悊锛?#   1. 浠撳簱鑷甫瀹屾暣 RN iOS 宸ョ▼锛坕os/MusicFree.xcodeproj + Podfile锛夛紝
#      鎵€浠ヤ笉闇€瑕?鎶?Android 鏀规垚 iOS"锛屽彧闇€瑕佺紪璇戣繖涓?iOS target銆?#   2. TrollStore 閫氳繃 CoreTrust 缁曡繃浠ｇ爜绛惧悕鏍￠獙骞舵案涔呯鍚嶏紝鍥犳浜х墿
#      涓嶉渶瑕?Apple 寮€鍙戣€呰瘉涔︼細xcodebuild 鍏虫帀绛惧悕 鈫?鍏嶇鍚?archive銆?#   3. .tipa 鏈川灏辨槸涓€涓?zip锛氭渶澶栧眰蹇呴』鏄?Payload/MusicFree.app锛?#      涓?.ipa 缁撴瀯鐩稿悓锛屾墿灞曞悕鎹㈡垚 .tipa 璁?TrollStore 鐩存帴璇嗗埆銆?#
# 杩愯鍓嶆彁锛歮acOS + Xcode + Node >= 18 + CocoaPods锛? 鍙€?ldid锛?# 鐢ㄦ硶锛歜ash scripts/build-trollstore.sh
#      SCHEME=MusicFreeNew NEW_ARCH=0 SIGN_TOOL=auto bash scripts/build-trollstore.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------- 鍙鐩栧弬鏁?-------------------------------------
# 娉ㄦ剰锛氬叡浜?scheme 鏂囦欢鍙?MusicFreeNew.xcscheme锛岃€?target 鍚嶆槸 MusicFree銆?# xcodebuild -scheme 鐢ㄧ殑鏄?scheme 鏂囦欢鍚嶏紝涓嶆槸 target 鍚嶏紝杩欓噷鏄渶甯歌鐨勮俯鍧戠偣銆?SCHEME="${SCHEME:-MusicFreeNew}"
WORKSPACE="${WORKSPACE:-ios/MusicFree.xcworkspace}"
CONFIGURATION="${CONFIGURATION:-Release}"
SDK="${SDK:-iphoneos}"
APP_NAME="${APP_NAME:-MusicFree.app}"
BUNDLE_ID="${BUNDLE_ID:-app.musicfree.trollstore}"
OUTPUT_NAME="${OUTPUT_NAME:-MusicFree.trollstore.tipa}"

# 0 = 鍏抽棴 New Architecture锛堟棫鏋舵瀯鍏煎鏈€绋筹紝閬垮紑 react-native-mmkv 2.x 绛夋棫搴擄級
# 1 = 寮€鍚?New Architecture / Bridgeless
NEW_ARCH="${NEW_ARCH:-0}"

# auto | ldid | codesign | none
#   none      鈥斺€?榛樿銆傚畼鏂规帹鑽愶細鍏嶇鍚?archive 鍚庣洿鎺ョ粍瑁?Payload 鎵撳寘锛?#                TrollStore 瀹夎鏃朵細鐢ㄥ唴缃?ldid 閫掑綊浼骞跺仛 CoreTrust bypass銆?#   ldid      鈥斺€?瓒婄嫳/TrollStore 绀惧尯鏍囧噯锛屾妸鑷畾涔?entitlements 鍐欒繘鎵€鏈?Mach-O
#   codesign  鈥斺€?macOS 鑷甫 ad-hoc 绛惧悕锛堟病鏈?ldid 鏃跺洖閫€锛?#   auto      鈥斺€?鏈?ldid 灏辩敤 ldid锛屽惁鍒?codesign
# 鍙湁闇€瑕佽嚜瀹氫箟 entitlements锛圝IT / 鍏ㄧ洏璁块棶 / root helper锛夋椂鎵嶆敼杩欓」銆?SIGN_TOOL="${SIGN_TOOL:-none}"

SKIP_POD_INSTALL="${SKIP_POD_INSTALL:-0}"
SKIP_NPM="${SKIP_NPM:-0}"

# ---------------------------- 鍥哄畾璺緞 ---------------------------------------
BUILD_DIR="$ROOT/build"
ARCHIVE_PATH="$BUILD_DIR/MusicFree.xcarchive"
DERIVED_DATA="$BUILD_DIR/DerivedData"
STAGE_DIR="$BUILD_DIR/trollstore"
ENTITLEMENTS="$ROOT/scripts/trollstore.entitlements.plist"
OUTPUT="$BUILD_DIR/$OUTPUT_NAME"

log() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "蹇呴』鍦?macOS 涓婃墽琛岋紙xcodebuild / CocoaPods / codesign 閮芥槸 macOS 涓撴湁锛?
command -v xcodebuild >/dev/null 2>&1 || die "鎵句笉鍒?xcodebuild锛岃鍏堣 Xcode 骞?sudo xcode-select -s /Applications/Xcode.app"
[ -f "$ENTITLEMENTS" ] || die "缂哄皯 entitlements 鏂囦欢锛?ENTITLEMENTS"

export RCT_NEW_ARCH_ENABLED="$NEW_ARCH"
export EXPO_NO_TELEMETRY=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

xcodebuild -version
node --version

# ---------------------------- 1. JS 渚濊禆 -------------------------------------
log "[1/6] 瀹夎 npm 渚濊禆"
if [ "$SKIP_NPM" != "1" ]; then
    # 涓婃父浠撳簱鐨?package-lock.json 涓?package.json 涓嶅悓姝ワ紙缂?fsevents /
    # lightningcss-* 鍚勫钩鍙板彲閫夊寘锛夛紝npm ci 鍦?npm >= 10 浼氭姤 EUSAGE 鐩存帴澶辫触銆?    # 鍥犳鍏堣瘯 npm ci锛屽け璐ヨ嚜鍔ㄥ洖閫€ npm install锛堜細椤哄甫淇 lock锛屼笉褰卞搷鏋勫缓锛夈€?    if ! npm ci --no-audit --no-fund; then
        echo "鈿狅笍  npm ci 澶辫触锛坙ock 涓嶅悓姝ワ級锛屽洖閫€ npm install 鑷姩淇 lockfile鈥?
        npm install --no-audit --no-fund
    fi
else
    echo "璺宠繃锛圫KIP_NPM=1锛?
fi

# ---------------------------- 2. CocoaPods ----------------------------------
log "[2/6] pod install锛堢敓鎴?.xcworkspace / Pods / ExpoModulesProvider锛?
if [ "$SKIP_POD_INSTALL" != "1" ]; then
    if [ -f Gemfile ] && command -v bundle >/dev/null 2>&1; then
        bundle install || echo "鈿狅笍  bundle install 澶辫触锛屽洖閫€鍒扮郴缁?CocoaPods"
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
    echo "璺宠繃锛圫KIP_POD_INSTALL=1锛?
fi

[ -d "$WORKSPACE" ] || die "鎵句笉鍒?workspace锛?WORKSPACE锛坧od install 娌℃垚鍔燂紵锛?

# ---------------------------- 3. 鍏嶇鍚?archive -----------------------------
log "[3/6] xcodebuild archive锛堝叧闂叏閮ㄧ鍚嶏級"
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

# pipefail 淇濊瘉 xcodebuild 澶辫触鏃惰剼鏈珛鍒婚€€鍑猴紝鍚屾椂鎶婂畬鏁存棩蹇楄惤鐩?xcodebuild "${XCB_ARGS[@]}" 2>&1 | tee "$BUILD_DIR/xcodebuild.log"

APP_SRC="$ARCHIVE_PATH/Products/Applications/$APP_NAME"
[ -d "$APP_SRC" ] || die "archive 閲屾病鎵惧埌 $APP_NAME锛岃鐪?$BUILD_DIR/xcodebuild.log"

# Release 蹇呴』鎶?JS bundle 鎵撹繘 app锛屽惁鍒欒鍒版墜鏈轰笂鏄櫧灞?if [ ! -f "$APP_SRC/main.jsbundle" ]; then
    echo "鈿狅笍  璀﹀憡锛氭湭鍙戠幇 main.jsbundle锛屾鏌?xcodebuild.log 涓?'Bundle React Native code and images' 闃舵鏄惁鎶ラ敊"
else
    echo "鉁?main.jsbundle 宸插唴宓岋紙绂荤嚎鍙惎鍔級"
fi

# ---------------------------- 4. 缁勮 Payload -------------------------------
log "[4/6] 缁勮 Payload/$APP_NAME"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/Payload"
# -Rp 淇濈暀绗﹀彿閾炬帴锛坒ramework 閲岀殑 Versions/Current 绛夛級锛屼笉璺熼殢銆佷笉鏀规潈闄?cp -Rp "$APP_SRC" "$STAGE_DIR/Payload/"
find "$STAGE_DIR/Payload" -name '.DS_Store' -delete 2>/dev/null || true
find "$STAGE_DIR/Payload" -name '__MACOSX' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ---------------------------- 5. 浼鍚?-------------------------------------
log "[5/6] 浼鍚嶏紙榛樿 none锛氫氦缁?TrollStore 瀹夎鏃堕€掑綊浼 + CoreTrust bypass锛?

sign_with_ldid() {
    # ldid -S<plist> 浼氭妸 entitlements 搴旂敤鍒?.app 鍐呮墍鏈?Mach-O
    ldid -S"$ENTITLEMENTS" "$STAGE_DIR/Payload/$APP_NAME"
    echo "鉁?ldid 浼瀹屾垚"
}

sign_with_codesign() {
    local app="$STAGE_DIR/Payload/$APP_NAME"
    # 鍏堢宓屽鐨?frameworks / dylibs / appex锛屾渶鍚庣鏈€澶栧眰 .app
    if [ -d "$app/Frameworks" ]; then
        find "$app/Frameworks" \( -name '*.framework' -o -name '*.dylib' -o -name '*.appex' \) -print0 |
            while IFS= read -r -d '' item; do
                codesign --force --sign - --timestamp=none "$item" 2>/dev/null || true
            done
    fi
    codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$app"
    echo "鉁?codesign ad-hoc 浼瀹屾垚"
}

case "$SIGN_TOOL" in
    none)
        echo "璺宠繃浼锛圫IGN_TOOL=none锛?
        ;;
    ldid)
        command -v ldid >/dev/null 2>&1 || die "鎵句笉鍒?ldid锛歜rew install ldid锛屾垨鏀圭敤 SIGN_TOOL=codesign"
        sign_with_ldid
        ;;
    codesign)
        sign_with_codesign
        ;;
    auto)
        # 鍏煎鏃ц皟鐢細auto 浠嶆寜"鏈?ldid 灏?ldid銆佸惁鍒?codesign"澶勭悊锛?        # 鏂版祦绋嬮粯璁?SIGN_TOOL=none锛屼笉闇€瑕佷换浣曟湰鍦扮鍚嶅伐鍏枫€?        if command -v ldid >/dev/null 2>&1; then
            sign_with_ldid
        else
            echo "鏈 ldid锛屽洖閫€ codesign ad-hoc"
            sign_with_codesign
        fi
        ;;
    *) die "鏈煡 SIGN_TOOL=$SIGN_TOOL锛堝彲閫?auto|ldid|codesign|none锛? ;;
esac

# ---------------------------- 6. 鎵撳寘 .tipa ---------------------------------
log "[6/6] 鎵撳寘 .tipa"
rm -f "$OUTPUT"
# -y 鍏抽敭锛氭妸绗﹀彿閾炬帴浣滀负閾炬帴瀛樿繘 zip锛岃€屼笉鏄睍寮€鎴愬疄浣撴枃浠讹紙鍚﹀垯 framework 浼氬潖锛?( cd "$STAGE_DIR" && zip -qry "$OUTPUT" Payload -x '*.DS_Store' '*__MACOSX*' )

# ---------------------------- 楠岃瘉 -------------------------------------------
log "浜х墿鏍￠獙"
echo "== zip 椤跺眰缁撴瀯锛堝簲鍙湁 Payload/锛?="
unzip -Z1 "$OUTPUT" | awk -F/ '{print $1}' | sort -u
echo
echo "== 鍓?20 椤?=="
unzip -l "$OUTPUT" | sed -n '1,20p'
echo
echo "== Info.plist 鍏抽敭瀛楁 =="
plutil -p "$STAGE_DIR/Payload/$APP_NAME/Info.plist" 2>/dev/null |
    grep -E 'CFBundleIdentifier|CFBundleShortVersionString|MinimumOSVersion|NSAllowsArbitraryLoads|UIFileSharingEnabled|UIBackgroundModes|CFBundleURLTypes' || true
echo
echo "== 绛惧悕鐘舵€?=="
codesign -dv "$STAGE_DIR/Payload/$APP_NAME" 2>&1 | sed -n '1,12p' || true
echo
echo "== SHA-256 =="
if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$OUTPUT"; else openssl dgst -sha256 "$OUTPUT"; fi

printf '\n\033[1;32m鉁?瀹屾垚锛?s\033[0m\n' "$OUTPUT"
cat <<'EOF'

瀹夎姝ラ锛?  1. 鎶?.tipa 浼犲埌 iPhone锛圓irDrop / 鏂囦欢 App / Safari 涓嬭浇鍧囧彲锛?  2. 鐢?TrollStore 鎵撳紑璇ユ枃浠?鈫?Install
  3. TrollStore 浼氫互 CoreTrust 姘镐箙绛惧悕锛岄噸鍚悗渚濈劧鍙敤锛屾棤闇€姣?7 澶╅噸绛?  4. 棣栨鍚姩鑻ユ彁绀?涓嶅彈淇′换鐨勪紒涓氬紑鍙戣€?锛屽湪 TrollStore 閲岀偣
     "Refresh App Registrations"锛屾垨 璁剧疆 鈫?閫氱敤 鈫?VPN涓庤澶囩鐞?閲屼俊浠?
鎻愮ず锛氭彃浠堕煶婧愯嫢涓?http://锛屽凡鍦?Info.plist 鏀惧紑 ATS锛?      鐘舵€佹爮姝岃瘝 / 閫€鍑哄簲鐢?/ ID3 鍏冩暟鎹湪 iOS 绔负瀹夊叏闄嶇骇瀹炵幇锛岃瑙?TROLLSTORE.md銆?EOF
