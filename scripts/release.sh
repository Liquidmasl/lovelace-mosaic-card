#!/bin/bash
# Usage: ./scripts/release.sh <patch|minor|major>
# Creates a release branch and PR with auto-generated changelog from merged PR bodies.
set -euo pipefail

BUMP_TYPE=${1:?Usage: release.sh <patch|minor|major>}
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

# Ensure we're on main and up to date
git checkout main
git pull

# Bump version in package.json (no commit, no tag)
npm version "$BUMP_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

# Collect release notes from merged PRs since last tag
NOTES=""
if [ -n "$LAST_TAG" ]; then
  PR_NUMBERS=$(git log "${LAST_TAG}..HEAD" --merges --pretty=format:"%s" | grep -oP '#\d+' | tr -d '#' | sort -u || true)
else
  PR_NUMBERS=$(git log --merges --pretty=format:"%s" | grep -oP '#\d+' | tr -d '#' | sort -u || true)
fi

for PR in $PR_NUMBERS; do
  BODY=$(gh pr view "$PR" --json body --jq '.body' 2>/dev/null || true)
  PR_NOTES=$(echo "$BODY" | sed -n '/^## Release Notes$/,/^## /p' | head -n -1 | tail -n +2 || true)
  if [ -n "$PR_NOTES" ]; then
    NOTES="${NOTES}${PR_NOTES}"$'\n'
  fi
done

# Update CHANGELOG.md
DATE=$(date +%Y-%m-%d)
NEW_SECTION="## [${NEW_VERSION}] - ${DATE}"$'\n\n'"${NOTES}"
if [ -f CHANGELOG.md ]; then
  # Insert new version section after the first line (# Changelog header)
  HEADER=$(head -n 1 CHANGELOG.md)
  REST=$(tail -n +2 CHANGELOG.md)
  echo -e "${HEADER}\n\n${NEW_SECTION}${REST}" > CHANGELOG.md
else
  echo -e "# Changelog\n\n${NEW_SECTION}" > CHANGELOG.md
fi

# Create release branch and PR
BRANCH="release/v${NEW_VERSION}"
git checkout -b "$BRANCH"
git add package.json CHANGELOG.md
git commit -m "release: v${NEW_VERSION}"
git push -u origin "$BRANCH"

PR_BODY="## Changelog

${NOTES}
---
Merging this PR will create tag v${NEW_VERSION} and publish the GitHub release."

gh pr create --title "Release v${NEW_VERSION}" --body "$PR_BODY"

echo "Release PR created for v${NEW_VERSION}"
