#!/bin/bash

# Git Helper Script for Disney Infinity Community Server (Linux/Mac)
# This script ensures consistent git operations across different environments

GIT_PATH="/usr/bin/git"
WORKING_DIR="infinity-community-server"

# Function to run git commands
run_git() {
    local git_command="$1"
    shift
    local git_args=("$@")

    echo "Running: git $git_command ${git_args[*]}"

    cd "$WORKING_DIR" 2>/dev/null || {
        echo "Error: Cannot change to directory $WORKING_DIR"
        exit 1
    }

    "$GIT_PATH" "$git_command" "${git_args[@]}"
}

# Main logic
if [ $# -lt 1 ]; then
    echo "Usage: $0 <git-command> [arguments...]"
    echo "Example: $0 status"
    echo "Example: $0 add ."
    echo "Example: $0 commit -m 'message'"
    exit 1
fi

COMMAND="$1"
shift

run_git "$COMMAND" "$@"
