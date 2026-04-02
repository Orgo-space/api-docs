#!/usr/bin/env bash

# ORGO Changelog Populator
# Analyzes git merge commits by month and generates Mintlify changelog entries
# Usage: ./generate-changelog.sh 2026-01 2026-02
#        ./generate-changelog.sh 2026-01   (single month)

set -e

ORGO_REPO="/Users/alex/orgo"
CHANGELOG_FILE="/Users/alex/api-docs/changelog/index.mdx"
BRANCH="master"

if [ $# -eq 0 ]; then
    echo "Usage: $0 YYYY-MM [YYYY-MM ...]"
    echo "Example: $0 2026-01 2026-02"
    exit 1
fi

# Check dependencies
if ! command -v claude &> /dev/null; then
    echo "Error: 'claude' CLI not found"
    exit 1
fi

generate_month() {
    local MONTH="$1"
    local YEAR="${MONTH%-*}"
    local MON="${MONTH#*-}"

    # Calculate next month for --before
    local NEXT_MON=$((10#$MON + 1))
    local NEXT_YEAR="$YEAR"
    if [ "$NEXT_MON" -gt 12 ]; then
        NEXT_MON=1
        NEXT_YEAR=$((YEAR + 1))
    fi
    local SINCE="${YEAR}-${MON}-01"
    local UNTIL=$(printf "%s-%02d-01" "$NEXT_YEAR" "$NEXT_MON")

    # Human-readable month label
    local MONTH_LABEL
    MONTH_LABEL=$(date -j -f "%Y-%m-%d" "${SINCE}" "+%B %Y" 2>/dev/null || date -d "${SINCE}" "+%B %Y")

    echo "Processing $MONTH_LABEL ($SINCE to $UNTIL)..." >&2

    # Collect merge commit data (first-parent only = one entry per merged branch)
    local DATA_FILE
    DATA_FILE=$(mktemp)
    trap "rm -f $DATA_FILE" RETURN

    cd "$ORGO_REPO"

    local COUNT=0
    {
        echo "=== MERGED BRANCHES: $MONTH_LABEL ==="
        echo ""

        git log --first-parent "$BRANCH" --after="${SINCE}" --before="${UNTIL}" \
            --format="%H|%s" | while IFS='|' read -r HASH MSG; do

            # Extract branch name from merge message
            BRANCH_NAME=""
            if [[ "$MSG" =~ Merge\ branch\ \'([^\']+)\' ]]; then
                BRANCH_NAME="${BASH_REMATCH[1]}"
            fi

            # Skip technical/infra branches
            if [[ "$BRANCH_NAME" =~ ^(claude_md|update_claude|cco_updates|unit_testing|php_stan|aws_audit) ]]; then
                continue
            fi

            echo "--- BRANCH: ${BRANCH_NAME:-DIRECT_COMMIT} ---"
            echo "Merge commit: $HASH"
            echo "Message: $MSG"

            # Get diff stats (files changed in this merge)
            if git rev-parse "${HASH}^2" &>/dev/null; then
                echo "Files changed:"
                git diff --stat "${HASH}^1..${HASH}^2" 2>/dev/null | tail -20

                echo "Key file paths:"
                git diff --name-only "${HASH}^1..${HASH}^2" 2>/dev/null | head -30

                # For vague branch names, show key code additions
                if [[ "$BRANCH_NAME" =~ ^(general|bug_fix|fixes|updates|improvements) ]] || [ -z "$BRANCH_NAME" ]; then
                    echo "Key additions:"
                    git diff "${HASH}^1..${HASH}^2" 2>/dev/null | grep -E "^[+].*(function |class |const |export |def |\.vue|template>)" | head -15 || true
                fi
            else
                # Direct commit (not a merge)
                echo "Files changed:"
                git diff --stat "${HASH}^..${HASH}" 2>/dev/null | tail -10
                echo "Key file paths:"
                git diff --name-only "${HASH}^..${HASH}" 2>/dev/null | head -15
            fi

            echo ""
        done
    } > "$DATA_FILE"

    local TOTAL
    TOTAL=$(grep -c "^--- BRANCH:" "$DATA_FILE" || echo 0)
    echo "  Found $TOTAL merged branches" >&2

    if [ "$TOTAL" -eq 0 ]; then
        echo "  No merges found for $MONTH_LABEL, skipping." >&2
        return
    fi

    # Send to Claude for analysis
    echo "  Analyzing with Claude..." >&2

    local PROMPT
    PROMPT="You are generating a user-friendly changelog for the ORGO platform (a SaaS for managing organizations, associations, and scouting groups).

Based on the git merge data below, generate a Mintlify-compatible changelog entry for $MONTH_LABEL.

RULES:
1. Write ONLY for END USERS (admins and members). Focus on what they can now DO.
2. Group changes by feature area: Events, Newsletter, Payments & Fees, Voting, Discussions, Groups, Contacts, Dashboard, Profiles, Files & Drive, Projects, Forms, Companies, Courses, etc.
3. Analyze branch names AND file paths to understand what changed.
4. Use clear, benefit-focused language: 'You can now...', 'Added ability to...', 'Improved...'
5. Combine related branches into single entries where they clearly address the same feature.

EXCLUDE (do NOT mention):
- Database migrations, entity internals, API refactoring
- Security patches, auth internals, session changes
- Docker, deployment, CI/CD, infrastructure
- Code cleanup, linting, PHPStan, testing infrastructure
- Internal performance optimizations users won't notice
- CLAUDE.md updates, developer tooling
- Reverted commits

INCLUDE only what users SEE or INTERACT with:
- New UI features, buttons, forms, pages, modals
- Export/filter/search capabilities
- Visual/design changes
- Email notifications and templates
- Bug fixes users would have noticed (keep these brief)
- Permission changes

OUTPUT FORMAT (use EXACTLY this):
<Update label=\"$MONTH_LABEL\">
**New Features**

**[Feature Area]**
- **Feature Title**: Clear description

**Improvements**

**[Feature Area]**
- **Improvement Title**: What got better


</Update>

CRITICAL:
- Output ONLY the <Update> block, nothing else
- Only two sections: New Features and Improvements. NO Bug Fixes section.
- Skip all bug fix branches entirely - do not include them at all
- If a section has no entries, omit it entirely
- Keep it concise but informative
- Do not fabricate features - only describe what the git data supports

GIT DATA:
$(cat "$DATA_FILE")"

    local RESULT
    RESULT=$(echo "$PROMPT" | claude -p --output-format text 2>/dev/null)

    echo "$RESULT"
}

# Process each month (newest first for correct changelog order)
MONTHS=("$@")
ALL_OUTPUT=""

# Sort months in reverse order (newest first)
IFS=$'\n' SORTED_MONTHS=($(sort -r <<<"${MONTHS[*]}")); unset IFS

for MONTH in "${SORTED_MONTHS[@]}"; do
    RESULT=$(generate_month "$MONTH")
    if [ -n "$RESULT" ]; then
        if [ -n "$ALL_OUTPUT" ]; then
            ALL_OUTPUT="${ALL_OUTPUT}

${RESULT}"
        else
            ALL_OUTPUT="$RESULT"
        fi
    fi
done

if [ -z "$ALL_OUTPUT" ]; then
    echo "No changelog entries generated."
    exit 0
fi

echo "" >&2
echo "=== GENERATED CHANGELOG ===" >&2
echo "$ALL_OUTPUT"
echo "" >&2

# Ask to insert into changelog
echo "" >&2
read -p "Insert into $CHANGELOG_FILE? [y/N] " -n 1 -r REPLY >&2
echo >&2

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Insert after the frontmatter (after the closing ---)
    # The file starts with ---\ntitle...\n---\n then the content
    TEMP_FILE=$(mktemp)

    # Extract frontmatter (first 4 lines: ---, title, description, ---)
    head -4 "$CHANGELOG_FILE" > "$TEMP_FILE"

    # Add blank line + new entries
    echo "" >> "$TEMP_FILE"
    echo "$ALL_OUTPUT" >> "$TEMP_FILE"
    echo "" >> "$TEMP_FILE"

    # Add remaining content (skip frontmatter)
    tail -n +5 "$CHANGELOG_FILE" >> "$TEMP_FILE"

    mv "$TEMP_FILE" "$CHANGELOG_FILE"
    echo "Changelog updated: $CHANGELOG_FILE" >&2
else
    echo "Output not inserted. You can copy the output above manually." >&2
fi
