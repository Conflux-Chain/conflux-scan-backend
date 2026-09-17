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

awk '$2 !~ /\^\{\}$/ {sub("refs/tags/", "", $2); print $2 "\t" $1}' "${REMOTE_TAGS}" \
| sort -t "$(printf '\t')" -k1,1V -u \
> "${NORMALIZED_TAGS}"

awk -v boundary="${BOUNDARY_TAG}" '
    $1 == boundary { found=1 }
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
while IFS=$'\t' read -r tag oid; do
    if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
        git tag -d "${tag}"
    else
        echo "Local tag ${tag} not found; skip local delete."
    fi
done < "${TAGS_TO_DELETE}"

echo "Deleting remote tags..."
while IFS=$'\t' read -r tag oid; do
    echo "Deleting remote tag: ${tag}"
    git push --force-with-lease="refs/tags/${tag}:${oid}" "${REMOTE}" ":refs/tags/${tag}"
done < "${TAGS_TO_DELETE}"
