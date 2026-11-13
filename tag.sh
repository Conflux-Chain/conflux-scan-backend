#!/usr/bin/env bash
set -euo pipefail

git fetch -- origin
BRANCH=origin/main
CURTAG=$(git describe --abbrev=0 --tags -- "$BRANCH")
CURTAG="${CURTAG#v}"
#CURTAG="3.1.40"

IFS='.' read -a vers <<< "$CURTAG"
#IFS='.' read -A vers <<< "$CURTAG"

MAJ=${vers[0]}
MIN=${vers[1]}
BUG=${vers[2]}
if [[ ! $MAJ =~ ^[0-9]+$ || ! $MIN =~ ^[0-9]+$ || ! $BUG =~ ^[0-9]+$ ]]; then
    echo "Latest tag is not a numeric semantic version: v$CURTAG" >&2
    exit 1
fi
echo "Current Tag: v$MAJ.$MIN.$BUG branch [$BRANCH]"

for cmd in "$@"
do
	case $cmd in
		"--major")
			# $((MAJ+1))
			((MAJ+=1))
			MIN=0
			BUG=0
			echo "Incrementing Major Version#"
			;;
		"--minor")
			((MIN+=1))
			BUG=0
			echo "Incrementing Minor Version#"
			;;
		"--bug")
			((BUG+=1))
			echo "Incrementing Bug Version#"
			;;
	esac
done
NEWTAG="v$MAJ.$MIN.$BUG"
# Pass each argument separately. Tag and branch names are data, not shell
# source; never build a command string and evaluate it.
echo "Adding Tag: $NEWTAG branch [$BRANCH]"
git tag -a "$NEWTAG" -m "$NEWTAG" "$BRANCH"
git push origin tag "$NEWTAG"
#echo "push it : git push origin tag $NEWTAG"

#git tag                  # 查看所有标签
#git tag <tag_name>       # 创建标签
#git tag -d <tag_name>    # 删除本地标签
#git push origin <tag_name> # 推送标签到远程
#git push origin :refs/tags/<tag_name> # 删除远程标签
