#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  print 'Node.js 22.12 or newer is required for the source launcher.'
  print 'For the ready-to-run app, visit https://github.com/LoneForgeTechnologies/prism-mapper/releases/latest'
  read 'reply?Press Enter to close.'
  exit 1
fi
lock_hash="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("package-lock.json")).digest("hex"))')"
stamp='node_modules/.prism-lock-sha256'
if [[ ! -d node_modules/electron/dist || ! -f "$stamp" || "$(cat "$stamp" 2>/dev/null)" != "$lock_hash" ]]; then
  npm ci
  print -r -- "$lock_hash" > "$stamp"
fi
npm run build
exec ./node_modules/.bin/electron .
