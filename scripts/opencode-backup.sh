#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<EOF
Usage: opencode-backup.sh <backup|restore> <output/input.tar.gz>

Modes:
  backup   — create a portable tarball of ALL OpenCode directories
  restore  — extract a tarball onto this machine (overwrites existing dirs)

Directories included (exact copy, no exclusions):
  ~/.opencode/              — opencode binary + runtime
  ~/.config/opencode/       — config, plugins, memory.db, state files
  ~/.cache/opencode/        — plugin cache packages
  ~/.local/share/opencode/  — sessions, snapshot, logs, tool output

Tarball stores paths relative to home, so restore works on any machine
regardless of username.
EOF
	exit 1
}

MODE="${1:-}"
TARGET="${2:-}"

if [[ -z "$MODE" || -z "$TARGET" ]]; then
	usage
fi

HOME_DIR="$HOME"

case "$MODE" in
backup)
	echo "Creating backup at $TARGET ..."
	echo "  Including: .opencode/ .config/opencode/ .cache/opencode/ .local/share/opencode/"
	echo "  This may take a while depending on total size."

	tar czf "$TARGET" \
		--transform="s|$HOME/||" \
		"$HOME/.opencode" \
		"$HOME/.config/opencode" \
		"$HOME/.cache/opencode" \
		"$HOME/.local/share/opencode"

	echo "Done: $(ls -lh "$TARGET" | awk '{print $5}')"
	;;

restore)
	if [[ ! -f "$TARGET" ]]; then
		echo "Error: $TARGET not found"
		exit 1
	fi

	echo "Restoring from $TARGET to $HOME ..."
	echo "  This will overwrite existing directories."

	tar xzf "$TARGET" -C "$HOME"

	echo "Done. Restored to:"
	echo "  $HOME/.opencode/"
	echo "  $HOME/.config/opencode/"
	echo "  $HOME/.cache/opencode/"
	echo "  $HOME/.local/share/opencode/"
	;;

*)
	usage
	;;
esac
