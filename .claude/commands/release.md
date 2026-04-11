Run a release for this project.

Ask the user which bump type they want: `patch`, `minor`, or `major`. Then run:

```bash
git checkout main && git pull
./scripts/release.sh <bump-type>
```

The script will:
1. Bump the version in `package.json`
2. Assemble `CHANGELOG.md` from merged PR bodies (`## Release Notes` sections)
3. Create a `release/vX.Y.Z` branch
4. Open a PR to main

When that PR is merged, `release.yml` automatically creates the git tag, builds `dist/mosaic-card.js`, and publishes the GitHub release. HACS picks it up from there.

**Important:** all changes that should be in the release must already be merged to main before running this — the tag is cut from the merge commit, so nothing added after the PR is opened will be in the tag.
