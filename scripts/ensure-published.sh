#!/usr/bin/env bash
# Makes sure every package name has been published for the latest release tag.
#
# semantic-release creates the git tag before publishing, so if one of the two
# npm publishes fails (e.g. a token without rights for the unscoped alias), the
# tag exists and later runs see nothing to release. This script closes that
# gap: it builds the tagged source and publishes any name that is missing the
# tagged version. Safe to run on every release; it is a no-op when up to date.
#
# Auth: npm >= 11.5.1 tries OIDC trusted publishing first, then NPM_TOKEN.
set -euo pipefail

TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*')
VERSION=${TAG#v}
SCOPED=$(node -p "require('./package.json').name")
ALIAS=openbao-js

published() { [ -n "$(npm view "$1@$VERSION" version 2>/dev/null || true)" ]; }

missing=()
for name in "$SCOPED" "$ALIAS"; do
  if published "$name"; then
    echo "✔ $name@$VERSION already published"
  else
    echo "✘ $name@$VERSION missing"
    missing+=("$name")
  fi
done
[ ${#missing[@]} -eq 0 ] && exit 0
[ -n "${DRY_RUN:-}" ] && { echo "DRY_RUN set - not publishing ${missing[*]}"; exit 0; }

if [ -n "${NPM_TOKEN:-}" ]; then
  echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > "$HOME/.npmrc"
fi

WORKTREE=$(mktemp -d)
git worktree add --detach "$WORKTREE" "$TAG"
trap 'git worktree remove --force "$WORKTREE"' EXIT
cd "$WORKTREE"
npm ci --no-audit --no-fund
npm run build
npm run prepare-alias

for name in "${missing[@]}"; do
  if [ "$name" = "$ALIAS" ]; then dir=.release/$ALIAS; else dir=.; fi
  (cd "$dir" && npm pkg set version="$VERSION" && npm publish --provenance --access public --tag latest)
  echo "✔ published $name@$VERSION"
done
