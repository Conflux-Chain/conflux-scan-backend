#!/usr/bin/env bash
set -euo pipefail

BOUNDARY_TAG="v3.1.73"
TAGS_TO_DELETE="$(mktemp)"

cleanup() {
    rm -f "${TAGS_TO_DELETE}"
}
trap cleanup EXIT

git fetch --tags --prune

if ! git ls-remote --exit-code --tags origin "refs/tags/${BOUNDARY_TAG}" >/dev/null; then
    echo "Boundary tag ${BOUNDARY_TAG} not found on origin. Abort." >&2
    exit 1
fi

git ls-remote --tags origin 'refs/tags/v*' \
| awk '{sub("refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2}' \
| sort -Vu \
| awk -v boundary="${BOUNDARY_TAG}" '$0==boundary{found=1} !found{print}' \
> "${TAGS_TO_DELETE}"

echo "Deleting local tags..."
xargs -t -r git tag -d < "${TAGS_TO_DELETE}"

echo "Deleting remote tags..."
while read -r tag; do
    echo "Deleting remote tag: ${tag}"
    git push origin ":refs/tags/${tag}"
done < "${TAGS_TO_DELETE}"
