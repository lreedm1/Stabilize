#!/bin/zsh -f

emulate -LR zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077

if (( EUID == 0 )); then
  print -u2 "Run this uninstaller as your normal Mac user, not with sudo."
  exit 1
fi
if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  print -u2 "This uninstaller is for macOS."
  exit 1
fi

label="info.stabilize.nightly-review"
account_name="$(/usr/bin/id -un)"
home_record="$(
  /usr/bin/dscl /Search -read "/Users/$account_name" NFSHomeDirectory 2>/dev/null
)" || {
  print -u2 "Could not determine the account home directory."
  exit 1
}
[[ "$home_record" == "NFSHomeDirectory: "* ]] || {
  print -u2 "Directory Services returned an unexpected home record."
  exit 1
}
user_home="${home_record#NFSHomeDirectory: }"
[[ "$user_home" == /* && "$user_home" != *$'\n'* && "$user_home" != *$'\r'* ]] || {
  print -u2 "The account home directory is invalid."
  exit 1
}
[[ -d "$user_home" && -O "$user_home" && "${HOME:-}" == "$user_home" ]] || {
  print -u2 "HOME does not match the current account's registered home directory."
  exit 1
}
domain="gui/$(/usr/bin/id -u)"
target="$domain/$label"
plist="$user_home/Library/LaunchAgents/$label.plist"

if [[ -L "$plist" || ( -e "$plist" && ( ! -f "$plist" || ! -O "$plist" ) ) ]]; then
  print -u2 "Refusing unexpected LaunchAgent plist target: $plist"
  exit 1
fi

if /bin/launchctl print "$target" >/dev/null 2>&1; then
  /bin/launchctl bootout "$target"
fi
/bin/rm -f "$plist"

print "Uninstalled $label. Private reports, logs, and checkpoints were preserved."
