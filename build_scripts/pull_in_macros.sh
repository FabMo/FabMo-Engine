#!/bin/bash

# === CONFIGURATION ===
REMOTE_REPO="https://github.com/FabMo/fabmo-macros-dt-main.git"
TEMP_DIR="/tmp/macros"
TARGET_DIR="/fabmo/profiles/fabmo-profile-dt/macros"
FILE_LIST=("base/macro_10.sbp" "base/macro_2.sbp" "base/macro_201.sbp" "base/macro_211.sbp" "base/macro_3.sbp" "base/macro_5.sbp" "base/macro_6.sbp" "base/macro_7.sbp" "base/macro_78.sbp" "base/macro_79.sbp" "base/macro_9.sbp" "base/macro_90.sbp" "base/macro_91.sbp")

# === BEGIN ===

echo "➡️ Syncing from $REMOTE_REPO..."

# Clone or update temp repo
for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    dest_name=$(basename "$file")
    cp "$TEMP_DIR/$file" "$TARGET_DIR/$dest_name"
    echo "✅ Copied: $file → $TARGET_DIR/$dest_name"
  else
    echo "⚠️  File not found: $file"
  fi
done

# Copy specific files to target location
echo "📂 Copying files to $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    cp "$TEMP_DIR/$file" "$TARGET_DIR/"
    echo "✅ Copied: $file"
  else
    echo "⚠️  File not found in repo: $file"
  fi
done

echo "✅ Done syncing files."

# === CONFIGURATION ===
REMOTE_REPO="https://github.com/FabMo/fabmo-macros-dt-main.git"
TEMP_DIR="/tmp/macros"
TARGET_DIR="/fabmo/profiles/fabmo-profile-dtmax/macros"
FILE_LIST=("base/macro_10.sbp" "base/macro_2.sbp" "base/macro_201.sbp" "base/macro_211.sbp" "base/macro_3.sbp" "base/macro_5.sbp" "base/macro_6.sbp" "base/macro_7.sbp" "base/macro_78.sbp" "base/macro_79.sbp" "base/macro_9.sbp" "base/macro_90.sbp" "base/macro_91.sbp")

# === BEGIN ===

echo "➡️ Syncing from $REMOTE_REPO..."

# Clone or update temp repo
for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    dest_name=$(basename "$file")
    cp "$TEMP_DIR/$file" "$TARGET_DIR/$dest_name"
    echo "✅ Copied: $file → $TARGET_DIR/$dest_name"
  else
    echo "⚠️  File not found: $file"
  fi
done

# Copy specific files to target location
echo "📂 Copying files to $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    cp "$TEMP_DIR/$file" "$TARGET_DIR/"
    echo "✅ Copied: $file"
  else
    echo "⚠️  File not found in repo: $file"
  fi
done

echo "✅ Done syncing files."

# === CONFIGURATION ===
REMOTE_REPO="https://github.com/FabMo/fabmo-macros-dt-main.git"
TEMP_DIR="/tmp/macros"
TARGET_DIR="/fabmo/profiles/fabmo-profile-dtatc/macros"
FILE_LIST=("base/macro_10.sbp" "base/macro_2.sbp" "base/macro_201.sbp" "base/macro_211.sbp" "base/macro_3.sbp" "base/macro_5.sbp" "base/macro_6.sbp" "base/macro_7.sbp" "base/macro_78.sbp" "base/macro_79.sbp" "base/macro_9.sbp" "base/macro_90.sbp" "base/macro_91.sbp")

# === BEGIN ===

echo "➡️ Syncing from $REMOTE_REPO..."

# Clone or update temp repo
for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    dest_name=$(basename "$file")
    cp "$TEMP_DIR/$file" "$TARGET_DIR/$dest_name"
    echo "✅ Copied: $file → $TARGET_DIR/$dest_name"
  else
    echo "⚠️  File not found: $file"
  fi
done

# Copy specific files to target location
echo "📂 Copying files to $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    cp "$TEMP_DIR/$file" "$TARGET_DIR/"
    echo "✅ Copied: $file"
  else
    echo "⚠️  File not found in repo: $file"
  fi
done

echo "✅ Done syncing files."

# === CONFIGURATION ===
REMOTE_REPO="https://github.com/FabMo/fabmo-macros-dt-main.git"
TEMP_DIR="/tmp/macros"
TARGET_DIR="/fabmo/profiles/fabmo-profile-dtatc/macros"
FILE_LIST=("max-atc-ADD/macro_1.sbp" "max-atc-ADD/macro_204.sbp" "max-atc-ADD/macro_205.sbp" "max-atc-ADD/macro_212.sbp" "max-atc-ADD/macro_70.sbp" "max-atc-ADD/macro_71.sbp" "max-atc-ADD/macro_72.sbp" "max-atc-ADD/macro_73.sbp" "max-atc-ADD/macro_74.sbp" "max-atc-ADD/macro_75.sbp")

# === BEGIN ===

echo "➡️ Syncing from $REMOTE_REPO..."

# Clone or update temp repo
for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    dest_name=$(basename "$file")
    cp "$TEMP_DIR/$file" "$TARGET_DIR/$dest_name"
    echo "✅ Copied: $file → $TARGET_DIR/$dest_name"
  else
    echo "⚠️  File not found: $file"
  fi
done

# Copy specific files to target location
echo "📂 Copying files to $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

for file in "${FILE_LIST[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    cp "$TEMP_DIR/$file" "$TARGET_DIR/"
    echo "✅ Copied: $file"
  else
    echo "⚠️  File not found in repo: $file"
  fi
done

echo "✅ Done syncing files."
