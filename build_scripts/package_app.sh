#!/bin/sh
#
# Package a system dashboard app as a distributable .fma archive.
# The archive is a zip with the app's files (package.json, index.html, ...)
# at the archive root — the layout AppManager.decompressApp expects when a
# user drops the file onto the dashboard's app installer.
#
# Usage: build_scripts/package_app.sh <app-dir> [output-dir]
#   e.g. build_scripts/package_app.sh dashboard/apps/tool_status.fma dist/

set -e

APP_DIR="$1"
OUT_DIR="${2:-.}"

if [ -z "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
    echo "Usage: $0 <app-dir> [output-dir]  (app-dir must contain package.json)" >&2
    exit 1
fi

python3 - "$APP_DIR" "$OUT_DIR" <<'EOF'
import json, os, sys, zipfile

app_dir, out_dir = sys.argv[1], sys.argv[2]
pkg = json.load(open(os.path.join(app_dir, "package.json")))
app_id = pkg.get("id") or os.path.basename(app_dir).replace(".fma", "")
version = pkg.get("version", "0.0.0")
out_path = os.path.join(out_dir, "%s-%s.fma" % (app_id, version))

EXCLUDE_DIRS = {".git", "node_modules", "__pycache__"}
EXCLUDE_FILES = {".DS_Store"}

os.makedirs(out_dir, exist_ok=True)
with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(app_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in sorted(files):
            if f in EXCLUDE_FILES:
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, app_dir))

print("wrote %s (%d files)" % (out_path, len(zipfile.ZipFile(out_path).namelist())))
EOF
