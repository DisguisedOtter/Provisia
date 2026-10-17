#!/usr/bin/env bash
# Generates a Markdown changelog section from conventional commits.
#   scripts/changelog.sh [FROM_REF] [TO_REF]      default: previous tag .. HEAD
# Groups: Breaking changes, Features (feat), Fixes (fix), Performance (perf), Other (refactor/docs/build/ci/chore/...).
# Used by .forgejo/workflows/release.yml to fill the Forgejo release notes; paste the output into CHANGELOG.md.
set -euo pipefail

TO="${2:-HEAD}"
FROM="${1:-$(git describe --tags --abbrev=0 "${TO}^" 2>/dev/null || true)}"
RANGE="${FROM:+$FROM..}$TO"
repo_url="${REPO_URL:-}"

declare -a breaking feat fix perf other
while IFS=$'\037' read -r hash subject body; do
  [ -n "$hash" ] || continue
  short="${hash:0:7}"
  link="$short"; [ -n "$repo_url" ] && link="[$short]($repo_url/commit/$hash)"
  # Parse "type(scope)!: description" with bash regex (portable to bash 3.2, no nested parentheses in $(...)).
  type="" scope="" bang=""
  if [[ "$subject" =~ ^([a-z]+)(\(([^\)]*)\))?(!)?:[[:space:]]*(.*)$ ]]; then
    type="${BASH_REMATCH[1]}"; scope="${BASH_REMATCH[3]}"; bang="${BASH_REMATCH[4]}"; desc="${BASH_REMATCH[5]}"
  else
    desc="$subject"
  fi
  line="- ${scope:+**$scope:** }$desc ($link)"
  if [ -n "$bang" ] || [[ "$body" == *"BREAKING CHANGE"* ]]; then
    breaking+=("$line")
  fi
  case "$type" in
    feat) feat+=("$line") ;;
    fix) fix+=("$line") ;;
    perf) perf+=("$line") ;;
    '') ;; # not a conventional commit (merge commits, "Add ..."): listed under Other
    *) other+=("$line") ;;
  esac
  [ -z "$type" ] && other+=("- $subject ($link)") || true
done < <(git log --no-merges --format='%H%x1f%s%x1f%b%x1e' "$RANGE" | tr -d '\n' | tr '\036' '\n')

section() { local title="$1"; shift; [ $# -gt 0 ] || return 0; printf '### %s\n\n' "$title"; printf '%s\n' "$@"; printf '\n'; }
printf '%s\n\n' "${FROM:+Changes since $FROM.}${FROM:-Initial release.}"
section "Breaking changes" "${breaking[@]+"${breaking[@]}"}"
section "Features" "${feat[@]+"${feat[@]}"}"
section "Fixes" "${fix[@]+"${fix[@]}"}"
section "Performance" "${perf[@]+"${perf[@]}"}"
section "Other" "${other[@]+"${other[@]}"}"
