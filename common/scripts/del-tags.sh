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
PUSH_REFSPECS="$(mktemp)"
PUSH_LEASES="$(mktemp)"

cleanup() {
    rm -f "${REMOTE_TAGS}" "${NORMALIZED_TAGS}" "${TAGS_TO_DELETE}" "${PUSH_REFSPECS}" "${PUSH_LEASES}"
}
trap cleanup EXIT

mapfile -t FETCH_URLS < <(git remote get-url --all "${REMOTE}")
mapfile -t PUSH_URLS < <(git remote get-url --push --all "${REMOTE}")
if [[ "${#FETCH_URLS[@]}" -ne 1 || "${#PUSH_URLS[@]}" -ne 1 || "${FETCH_URLS[0]}" != "${PUSH_URLS[0]}" ]]; then
    echo "Remote ${REMOTE} must have exactly one identical fetch URL and push URL. Abort." >&2
    exit 1
fi
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

while IFS=$'\t' read -r tag oid; do
    printf '%s\n' ":refs/tags/${tag}" >> "${PUSH_REFSPECS}"
    printf '%s\n' "--force-with-lease=refs/tags/${tag}:${oid}" >> "${PUSH_LEASES}"
done < "${TAGS_TO_DELETE}"

echo "Deleting remote tags..."
if [[ -s "${PUSH_REFSPECS}" ]]; then
    mapfile -t PUSH_LEASE_ARGS < "${PUSH_LEASES}"
    mapfile -t PUSH_REFSPEC_ARGS < "${PUSH_REFSPECS}"
    git push --atomic "${PUSH_LEASE_ARGS[@]}" "${REMOTE}" "${PUSH_REFSPEC_ARGS[@]}"
else
    echo "No remote tags to delete."
fi

echo "Deleting local tags..."
while IFS=$'\t' read -r tag oid; do
    if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
        git tag -d "${tag}"
    else
        echo "Local tag ${tag} not found; skip local delete."
    fi
done < "${TAGS_TO_DELETE}"
