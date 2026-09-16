git fetch --tags --prune

git tag -l 'v*' \
| sort -V \
| awk '$0=="v3.1.73"{exit} {print}' \
> /tmp/tags_to_delete.txt

echo "Deleting local tags..."
xargs -t -r git tag -d < /tmp/tags_to_delete.txt

echo "Deleting remote tags..."
while read -r tag; do
    echo "Deleting remote tag: $tag"
    git push origin ":refs/tags/$tag"
done < /tmp/tags_to_delete.txt
