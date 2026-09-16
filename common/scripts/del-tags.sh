#!/usr/bin/env bash
set -euo pipefail

BOUNDARY_TAG="v3.1.73"
TAGS_TO_DELETE="/tmp/tags_to_delete.txt"

git fetch --tags --prune

if ! git rev-parse -q --verify "refs/tags/${BOUNDARY_TAG}" >/dev/null; then
    echo "Boundary tag ${BOUNDARY_TAG} not found. Abort." >&2
    exit 1
fi

git tag -l 'v*' \
| sort -V \
| awk -v boundary="${BOUNDARY_TAG}" '$0==boundary{exit} {print}' \
> "${TAGS_TO_DELETE}"

echo "Deleting local tags..."
xargs -t -r git tag -d < "${TAGS_TO_DELETE}"

echo "Deleting remote tags..."
while read -r tag; do
    echo "Deleting remote tag: ${tag}"
    git push origin ":refs/tags/${tag}"
done < "${TAGS_TO_DELETE}"
