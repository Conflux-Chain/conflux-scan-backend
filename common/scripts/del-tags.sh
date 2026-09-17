#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-origin}"
BOUNDARY_TAG="${2:-v3.1.73}"
if [[ $# -gt 2 ]]; then
    echo "Usage: $0 [remote] [boundary-tag]" >&2
    exit 2
fi

REMOTE_TAGS="$(mktemp)"
NORMALIZED_TAGS="$(mktemp)"
TAGS_TO_DELETE="$(mktemp)"

cleanup() {
    rm -f "${REMOTE_TAGS}" "${NORMALIZED_TAGS}" "${TAGS_TO_DELETE}"
}
trap cleanup EXIT

git remote get-url "${REMOTE}" >/dev/null
git fetch "${REMOTE}" --tags --prune

git ls-remote --tags "${REMOTE}" 'refs/tags/v*' > "${REMOTE_TAGS}"

awk '{sub("refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2}' "${REMOTE_TAGS}" \
| sort -Vu \
> "${NORMALIZED_TAGS}"

awk -v boundary="${BOUNDARY_TAG}" '
    $0 == boundary { found=1 }
    !found { print }
    END {
        if (!found) {
            print "Boundary tag " boundary " not found on remote." > "/dev/stderr"
            exit 1
        }
    }
' "${NORMALIZED_TAGS}" \
| sort -V \
> "${TAGS_TO_DELETE}"

echo "Deleting local tags..."
while read -r tag; do
    git tag -d "${tag}"
done < "${TAGS_TO_DELETE}"

echo "Deleting remote tags..."
while read -r tag; do
    echo "Deleting remote tag: ${tag}"
    git push "${REMOTE}" ":refs/tags/${tag}"
done < "${TAGS_TO_DELETE}"
