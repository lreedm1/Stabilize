#!/bin/zsh -f

emulate -LR zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077

die() {
  print -u2 -- "$*"
  exit 1
}

[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || die "The verification sandbox probe requires macOS."
[[ -x /usr/bin/sandbox-exec ]] || die "sandbox-exec is unavailable."

script_dir="${0:A:h}"
profile="$script_dir/verification.sb"
[[ -f "$profile" && -r "$profile" ]] || die "The verification sandbox profile is missing."

probe_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/stabilize-sandbox-root.XXXXXX")"
outside_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/stabilize-sandbox-outside.XXXXXX")"
# Seatbelt path filters compare against canonical paths. GitHub's TMPDIR ends
# with a slash, so mktemp can echo a harmless but noncanonical `//` path.
probe_root="${probe_root:A}"
outside_root="${outside_root:A}"
cleanup() {
  set +e
  /bin/rm -f -- \
    "$probe_root/allowed" \
    "$probe_root/escape" \
    "$outside_root/direct" \
    "$outside_root/symlink"
  /bin/rmdir -- "$probe_root" "$outside_root"
}
trap cleanup EXIT INT TERM HUP

/bin/ln -s "$outside_root" "$probe_root/escape"

/usr/bin/sandbox-exec -D "WRITABLE_ROOT=$probe_root" -f "$profile" \
  /bin/sh -c 'printf allowed > "$1/allowed"' sh "$probe_root" ||
  die "The verification sandbox denied its disposable writable root."
[[ "$(<"$probe_root/allowed")" == "allowed" ]] || die "The allowed-write probe was corrupted."

if /usr/bin/sandbox-exec -D "WRITABLE_ROOT=$probe_root" -f "$profile" \
  /bin/sh -c 'printf blocked > "$1/direct"' sh "$outside_root" 2>/dev/null
then
  die "The verification sandbox allowed a direct write outside its disposable root."
fi
[[ ! -e "$outside_root/direct" ]] || die "The direct denied-write probe escaped."

if /usr/bin/sandbox-exec -D "WRITABLE_ROOT=$probe_root" -f "$profile" \
  /bin/sh -c 'printf blocked > "$1/escape/symlink"' sh "$probe_root" 2>/dev/null
then
  die "The verification sandbox allowed a symbolic-link write escape."
fi
[[ ! -e "$outside_root/symlink" ]] || die "The symbolic-link denied-write probe escaped."

print "Verification sandbox write-confinement probe passed."
