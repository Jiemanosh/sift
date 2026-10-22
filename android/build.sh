#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-D:/Android/Sdk}}"
if command -v cygpath >/dev/null 2>&1; then
  SDK="$(cygpath -u "$SDK")"
fi
if [ ! -d "$SDK" ]; then
  echo "找不到 Android SDK：$SDK（可用 ANDROID_SDK_ROOT 指定）" >&2
  exit 1
fi

BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -n 1)"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -n 1)"
BUILD="$HERE/build"
KEYSTORE="$HERE/keystore/sift.keystore"
PASSFILE="$HERE/keystore/password"

for tool in "$BT/aapt2.exe" "$BT/zipalign.exe" "$BT/lib/d8.jar" "$BT/lib/apksigner.jar"; do
  if [ ! -f "$tool" ]; then
    echo "缺少构建工具：$tool" >&2
    exit 1
  fi
done

mkdir -p "$HERE/keystore"
if [ ! -f "$PASSFILE" ]; then
  openssl rand -hex 18 | tr -d '\r\n' > "$PASSFILE"
  chmod 600 "$PASSFILE" 2>/dev/null || true
fi
PASS="$(tr -d '\r\n' < "$PASSFILE")"
printf '%s\n' "$PASS" > "$PASSFILE"
chmod 600 "$PASSFILE" 2>/dev/null || true

if [ ! -f "$KEYSTORE" ]; then
  echo "生成签名密钥…"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -alias sift \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$PASS" \
    -keypass "$PASS" \
    -dname "CN=Sift, OU=Local, O=QoderCN, L=Local, C=CN" >/dev/null
fi

echo "清理构建目录…"
rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

echo "编译资源…"
"$BT/aapt2.exe" compile --dir "$HERE/res" -o "$BUILD/res.zip"
"$BT/aapt2.exe" link \
  -o "$BUILD/app-unsigned.apk" \
  -I "$PLATFORM/android.jar" \
  --manifest "$HERE/AndroidManifest.xml" \
  -R "$BUILD/res.zip" \
  --auto-add-overlay \
  --java "$BUILD/gen" \
  --min-sdk-version 26 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name 1.0.0

echo "编译 Java…"
mapfile -t SOURCES < <(find "$HERE/src" "$BUILD/gen" -name '*.java' | sort)
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -classpath "$PLATFORM/android.jar" \
  -d "$BUILD/classes" \
  "${SOURCES[@]}"

echo "转换为 dex…"
mapfile -t CLASSES < <(find "$BUILD/classes" -name '*.class' | sort)
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release \
  --min-api 26 \
  --lib "$PLATFORM/android.jar" \
  --output "$BUILD/dex" \
  "${CLASSES[@]}"

echo "打包并签名…"
cp "$BUILD/app-unsigned.apk" "$BUILD/app-dexed.apk"
(cd "$BUILD/dex" && jar uf "$BUILD/app-dexed.apk" classes.dex)
"$BT/zipalign.exe" -f 4 "$BUILD/app-dexed.apk" "$BUILD/app-aligned.apk"

java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias sift \
  --ks-pass "pass:$PASS" \
  --key-pass "pass:$PASS" \
  --out "$HERE/sift.apk" \
  "$BUILD/app-aligned.apk"

java -jar "$BT/lib/apksigner.jar" verify --print-certs "$HERE/sift.apk"

SIZE="$(du -h "$HERE/sift.apk" | cut -f1)"
echo "已生成 $HERE/sift.apk（$SIZE）"
