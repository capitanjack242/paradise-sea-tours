#!/bin/sh
# Assemble the deployable site into _site/.
#
# The repo keeps each surface in its own folder; the site wants them at their
# own paths. This is the one place that mapping lives, so GitHub Pages and
# Cloudflare Pages build exactly the same tree and can't drift apart while both
# are running during the cutover.
#
# Cloudflare Pages: build command `sh scripts/build-site.sh`, output `_site`.

set -eu

rm -rf _site
mkdir -p _site
cp -R web/. _site/
mkdir -p _site/control && cp -R control/. _site/control/
mkdir -p _site/captain && cp -R captain/. _site/captain/
mkdir -p _site/trip    && cp -R trip/. _site/trip/

# Stamp our own CSS/JS with the commit hash so a browser can never serve a stale
# stylesheet or script after a deploy. Done here rather than in the source files
# so nobody has to remember to bump it.
#
# The hash comes from whichever CI is running: GitHub sets GITHUB_SHA, Cloudflare
# sets CF_PAGES_COMMIT_SHA. Falls back to git, then to a timestamp, so running
# this by hand still produces a stamped build rather than an unstamped one.
V="${GITHUB_SHA:-${CF_PAGES_COMMIT_SHA:-}}"
[ -n "$V" ] || V="$(git rev-parse HEAD 2>/dev/null || date +%s)"
V="$(printf '%s' "$V" | cut -c1-8)"

find _site -name '*.html' -print0 | xargs -0 sed -i.bak \
  -e "s|href=\"styles\.css\"|href=\"styles.css?v=$V\"|g" \
  -e "s|src=\"script\.js\"|src=\"script.js?v=$V\"|g"
find _site -name '*.bak' -delete

echo "Assembled _site, assets stamped with v=$V"
grep -o 'styles\.css?v=[a-z0-9]*' _site/index.html | head -1
