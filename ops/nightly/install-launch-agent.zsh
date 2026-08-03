#!/bin/zsh -f

emulate -LR zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077

label="info.stabilize.nightly-review"
time_value="02:17"
run_now=false

usage() {
  print "Usage: ops/nightly/install-launch-agent.zsh [--time HH:MM] [--run-now]"
}

die() {
  print -u2 -- "$*"
  exit 1
}

while (( $# > 0 )); do
  case "$1" in
    --time)
      (( $# >= 2 )) || {
        print -u2 "Missing value after --time."
        usage >&2
        exit 2
      }
      time_value="$2"
      shift 2
      ;;
    --run-now)
      run_now=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      print -u2 "Unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
done

(( EUID != 0 )) || die "Run this installer as your normal Mac user, not with sudo."
[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || die "This installer is for macOS."

if [[ ! "$time_value" =~ '^[0-9]{2}:[0-9]{2}$' ]]; then
  print -u2 "Time must use 24-hour HH:MM format."
  exit 2
fi

hour_text="${time_value%%:*}"
minute_text="${time_value##*:}"
hour=$(( 10#$hour_text ))
minute=$(( 10#$minute_text ))
if (( hour < 0 || hour > 23 || minute < 0 || minute > 59 )); then
  print -u2 "Time must be between 00:00 and 23:59."
  exit 2
fi

uid_number="$(/usr/bin/id -u)"
account_name="$(/usr/bin/id -un)"
domain="gui/$uid_number"
target="$domain/$label"
home_record="$(
  /usr/bin/dscl /Search -read "/Users/$account_name" NFSHomeDirectory 2>/dev/null
)" || die "Could not determine the account home directory."
[[ "$home_record" == "NFSHomeDirectory: "* ]] ||
  die "Directory Services returned an unexpected home record."
user_home="${home_record#NFSHomeDirectory: }"
[[ "$user_home" == /* && "$user_home" != *$'\n'* && "$user_home" != *$'\r'* ]] ||
  die "The account home directory is invalid."
[[ -d "$user_home" && -O "$user_home" ]] ||
  die "The account home directory is missing or is not owned by this user."
[[ "${HOME:-}" == "$user_home" ]] ||
  die "HOME does not match the current account's registered home directory."

installer_dir="${0:A:h}"
repo_root="${installer_dir:h:h}"
runner_js="$installer_dir/run-nightly.mjs"
sandbox_profile="$installer_dir/verification.sb"
[[ -f "$runner_js" && -r "$runner_js" ]] ||
  die "Nightly runner is missing or unreadable: $runner_js"
[[ -f "$sandbox_profile" && -r "$sandbox_profile" && -x /usr/bin/sandbox-exec ]] ||
  die "The macOS verification sandbox is unavailable."
[[ "$repo_root" != *$'\n'* && "$repo_root" != *$'\r'* ]] ||
  die "Repository paths containing line breaks are unsupported."

protected_roots=(
  "$user_home/Desktop"
  "$user_home/Documents"
  "$user_home/Downloads"
  "$user_home/Library/Mobile Documents"
  "$user_home/Library/CloudStorage"
)
for protected_root in "${protected_roots[@]}"; do
  if [[ "$repo_root" == "$protected_root" || "$repo_root" == "$protected_root"/* ]]; then
    die "Move the repository outside macOS privacy-protected storage, such as to ~/Developer/Stabilize."
  fi
done

state_dir="$user_home/Library/Application Support/Stabilize Nightly"
log_dir="$user_home/Library/Logs/Stabilize"
agent_dir="$user_home/Library/LaunchAgents"
plist="$agent_dir/$label.plist"
stdout_log="$log_dir/nightly.stdout.log"
stderr_log="$log_dir/nightly.stderr.log"

reject_symlink() {
  [[ ! -L "$1" ]] || die "Refusing symbolic-link target: $1"
}

for candidate in \
  "$state_dir" \
  "$log_dir" \
  "$agent_dir" \
  "$plist" \
  "$stdout_log" \
  "$stderr_log"
do
  reject_symlink "$candidate"
done
for directory in "$state_dir" "$log_dir" "$agent_dir"; do
  [[ ! -e "$directory" || -d "$directory" ]] || die "Expected a directory: $directory"
done
for output_file in "$stdout_log" "$stderr_log"; do
  [[ ! -e "$output_file" || ( -f "$output_file" && -O "$output_file" ) ]] ||
    die "Log path is not a regular user-owned file: $output_file"
done
[[ ! -e "$plist" || ( -f "$plist" && -O "$plist" ) ]] ||
  die "LaunchAgent plist is not a regular user-owned file: $plist"

/bin/mkdir -p "$state_dir" "$log_dir" "$agent_dir"
/bin/chmod 700 "$state_dir" "$log_dir"
/usr/bin/touch "$stdout_log" "$stderr_log"
/bin/chmod 600 "$stdout_log" "$stderr_log"
for directory in "$state_dir" "$log_dir" "$agent_dir"; do
  [[ -d "$directory" && -O "$directory" ]] ||
    die "Directory is not owned by the current user: $directory"
done

typeset -A tool_bins
for tool in git node npm codex gh; do
  resolved="$(whence -p -- "$tool" 2>/dev/null || true)"
  if [[ "$resolved" != /* || ! -f "$resolved" || ! -x "$resolved" ]]; then
    die "Missing absolute executable for required command: $tool"
  fi
  if [[ "$resolved" == *$'\n'* || "$resolved" == *$'\r'* || "${resolved:h}" == *:* ]]; then
    die "Unsupported executable path for $tool: $resolved"
  fi
  tool_bins[$tool]="$resolved"
done

node_bin="${tool_bins[node]}"
npm_bin="${tool_bins[npm]}"
codex_bin="${tool_bins[codex]}"
gh_bin="${tool_bins[gh]}"
git_bin="${tool_bins[git]}"
typeset -aU required_dirs final_dirs
required_dirs=(
  "${node_bin:h}"
  "${npm_bin:h}"
  "${codex_bin:h}"
  "${gh_bin:h}"
  "${git_bin:h}"
)
for candidate_dir in ${(s/:/)PATH}; do
  [[ -n "$candidate_dir" && "$candidate_dir" == /* ]] || continue
  for required_dir in "${required_dirs[@]}"; do
    if [[ "$candidate_dir" == "$required_dir" ]]; then
      final_dirs+=("$candidate_dir")
      break
    fi
  done
done
final_dirs+=("${required_dirs[@]}" /usr/bin /bin /usr/sbin /sbin)
tool_path="${(j/:/)final_dirs}"

for tool in git node npm codex gh; do
  expected="${tool_bins[$tool]}"
  actual=""
  for candidate_dir in "${final_dirs[@]}"; do
    if [[ -f "$candidate_dir/$tool" && -x "$candidate_dir/$tool" ]]; then
      actual="$candidate_dir/$tool"
      break
    fi
  done
  [[ "$actual" == "$expected" ]] ||
    die "Reduced PATH changes the selected $tool executable: expected $expected, got ${actual:-none}"
done

typeset -a clean_environment
clean_environment=(
  -i
  "HOME=$user_home"
  "USER=$account_name"
  "LOGNAME=$account_name"
  "SHELL=/bin/zsh"
  "PATH=$tool_path"
  "LANG=en_US.UTF-8"
  "LC_ALL=en_US.UTF-8"
  "STABILIZE_NIGHTLY_STATE_DIR=$state_dir"
  "CI=1"
  "GIT_TERMINAL_PROMPT=0"
  "GH_PROMPT_DISABLED=1"
  "NO_COLOR=1"
)

run_clean() {
  /usr/bin/env "${clean_environment[@]}" "$@"
}

node_major="$(run_clean "$node_bin" -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" == <-> ]] || die "Could not determine the Node.js version."
(( node_major >= 22 )) || die "Node.js 22 or newer is required."
run_clean "$npm_bin" --version >/dev/null
run_clean "$gh_bin" --version >/dev/null
codex_version_output="$(run_clean "$codex_bin" --version)"
version_regex='([0-9]+)\.([0-9]+)\.([0-9]+)'
[[ "$codex_version_output" =~ "$version_regex" ]] ||
  die "Could not determine the Codex CLI version."
codex_major=$(( 10#${match[1]} ))
codex_minor=$(( 10#${match[2]} ))
if (( codex_major == 0 && codex_minor < 138 )); then
  die "Codex CLI 0.138.0 or newer is required."
fi

run_clean "$codex_bin" login status >/dev/null ||
  die "Codex is not authenticated in the scheduled environment."
run_clean "$gh_bin" auth status >/dev/null ||
  die "GitHub CLI is not authenticated in the scheduled environment."
repo_top="$(run_clean "$git_bin" -C "$repo_root" rev-parse --show-toplevel)"
[[ "${repo_top:A}" == "${repo_root:A}" ]] ||
  die "The installer is not running from the expected repository root."
origin="$(run_clean "$git_bin" -C "$repo_root" remote get-url origin)"
case "$origin" in
  https://github.com/lreedm1/Stabilize|https://github.com/lreedm1/Stabilize.git)
    ;;
  *)
    die "The nightly runner requires the HTTPS origin https://github.com/lreedm1/Stabilize.git; found: $origin"
    ;;
esac
run_clean "$git_bin" -C "$repo_root" \
  ls-remote --exit-code origin refs/heads/main >/dev/null ||
  die "The scheduled environment cannot read origin/main over HTTPS."
repo_name="$(
  run_clean "$gh_bin" repo view lreedm1/Stabilize --json nameWithOwner --jq .nameWithOwner
)" || die "The scheduled environment cannot access lreedm1/Stabilize through GitHub CLI."
[[ "$repo_name" == "lreedm1/Stabilize" ]] ||
  die "GitHub CLI returned an unexpected repository."
viewer_permission="$(
  run_clean "$gh_bin" repo view lreedm1/Stabilize --json viewerPermission --jq .viewerPermission
)" || die "Could not determine GitHub repository permission."
case "$viewer_permission" in
  WRITE|MAINTAIN|ADMIN)
    ;;
  *)
    die "GitHub authentication needs write permission for lreedm1/Stabilize."
    ;;
esac
run_clean "$node_bin" --check "$runner_js" >/dev/null ||
  die "The nightly JavaScript runner has a syntax error."
run_clean /usr/bin/sandbox-exec -f "$sandbox_profile" /usr/bin/true ||
  die "The localhost-only verification sandbox is unsupported on this Mac."
/bin/launchctl print "$domain" >/dev/null 2>&1 ||
  die "No active GUI launchd domain exists for this user. Log in locally before installing."

temporary_plist=""
backup_plist=""
old_loaded=false
transaction_armed=false
new_plist_installed=false
committed=false

rollback_install() {
  set +e
  local rollback_ok=true
  print -u2 "Installation did not complete; restoring the previous LaunchAgent."
  if [[ "$new_plist_installed" == true ]]; then
    if /bin/launchctl print "$target" >/dev/null 2>&1; then
      /bin/launchctl bootout "$target" >/dev/null 2>&1 || rollback_ok=false
    fi
    /bin/rm -f "$plist" || rollback_ok=false
  fi
  if [[ -n "$backup_plist" && -e "$backup_plist" ]]; then
    if /bin/mv -f "$backup_plist" "$plist"; then
      backup_plist=""
    else
      rollback_ok=false
    fi
  fi
  if [[ "$old_loaded" == true ]] &&
     ! /bin/launchctl print "$target" >/dev/null 2>&1; then
    /bin/chmod 600 "$plist" || rollback_ok=false
    /bin/launchctl enable "$target" >/dev/null 2>&1 || rollback_ok=false
    /bin/launchctl bootstrap "$domain" "$plist" >/dev/null 2>&1 || rollback_ok=false
  fi
  if [[ "$rollback_ok" != true ]]; then
    print -u2 "Automatic rollback was incomplete."
    [[ -n "$backup_plist" && -e "$backup_plist" ]] &&
      print -u2 "Previous plist backup preserved at: $backup_plist"
  fi
}

on_exit() {
  local exit_status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$transaction_armed" == true && "$committed" != true ]]; then
    rollback_install
  fi
  [[ -n "$temporary_plist" && -e "$temporary_plist" ]] && /bin/rm -f "$temporary_plist"
  if [[ -n "$backup_plist" && -e "$backup_plist" ]]; then
    if [[ "$transaction_armed" == true && "$committed" != true ]]; then
      print -u2 "Previous plist backup preserved at: $backup_plist"
    else
      /bin/rm -f "$backup_plist"
    fi
  fi
  exit "$exit_status"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

temporary_plist="$(/usr/bin/mktemp "$agent_dir/.$label.plist.XXXXXX")"
/usr/bin/plutil -create xml1 "$temporary_plist"
/usr/bin/plutil -insert Label -string "$label" "$temporary_plist"
/usr/bin/plutil -insert ProgramArguments -array "$temporary_plist"
program_arguments=(
  /usr/bin/env
  "${clean_environment[@]}"
  "$node_bin"
  "$runner_js"
  --scheduled
)
for (( index = 1; index <= ${#program_arguments}; index++ )); do
  zero_index=$(( index - 1 ))
  /usr/bin/plutil -insert "ProgramArguments.$zero_index" \
    -string "${program_arguments[$index]}" "$temporary_plist"
done
/usr/bin/plutil -insert WorkingDirectory -string "$repo_root" "$temporary_plist"
/usr/bin/plutil -insert StartCalendarInterval -dictionary "$temporary_plist"
/usr/bin/plutil -insert StartCalendarInterval.Hour -integer "$hour" "$temporary_plist"
/usr/bin/plutil -insert StartCalendarInterval.Minute -integer "$minute" "$temporary_plist"
/usr/bin/plutil -insert StandardOutPath -string "$stdout_log" "$temporary_plist"
/usr/bin/plutil -insert StandardErrorPath -string "$stderr_log" "$temporary_plist"
/usr/bin/plutil -insert Umask -integer 63 "$temporary_plist"
/usr/bin/plutil -insert ProcessType -string Background "$temporary_plist"
/usr/bin/plutil -insert LowPriorityIO -bool true "$temporary_plist"
/usr/bin/plutil -lint "$temporary_plist" >/dev/null
/bin/chmod 600 "$temporary_plist"

assert_plist_value() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(/usr/bin/plutil -extract "$key" raw "$temporary_plist")" ||
    die "Generated plist is missing $key."
  [[ "$actual" == "$expected" ]] || die "Generated plist has the wrong $key value."
}

assert_plist_value Label "$label"
assert_plist_value ProgramArguments "${#program_arguments}"
for (( index = 1; index <= ${#program_arguments}; index++ )); do
  zero_index=$(( index - 1 ))
  assert_plist_value "ProgramArguments.$zero_index" "${program_arguments[$index]}"
done
assert_plist_value WorkingDirectory "$repo_root"
assert_plist_value StartCalendarInterval.Hour "$hour"
assert_plist_value StartCalendarInterval.Minute "$minute"
assert_plist_value StandardOutPath "$stdout_log"
assert_plist_value StandardErrorPath "$stderr_log"
assert_plist_value Umask "63"
assert_plist_value ProcessType "Background"
assert_plist_value LowPriorityIO "true"

if /bin/launchctl print "$target" >/dev/null 2>&1; then
  old_loaded=true
  [[ -f "$plist" ]] || die "The service is loaded, but its expected plist is missing: $plist"
  /usr/bin/plutil -lint "$plist" >/dev/null ||
    die "The currently loaded plist is not valid enough for safe rollback."
  old_label="$(/usr/bin/plutil -extract Label raw "$plist")"
  [[ "$old_label" == "$label" ]] ||
    die "The loaded service does not match the expected plist label."
fi
if [[ -e "$plist" ]]; then
  backup_plist="$(/usr/bin/mktemp "$agent_dir/.$label.backup.XXXXXX")"
  /bin/cp -p "$plist" "$backup_plist"
fi

transaction_armed=true
if [[ "$old_loaded" == true ]]; then
  /bin/launchctl bootout "$target"
fi
new_plist_installed=true
/bin/mv -f "$temporary_plist" "$plist"
temporary_plist=""
/bin/launchctl enable "$target"
/bin/launchctl bootstrap "$domain" "$plist"
/bin/launchctl print "$target" >/dev/null
committed=true
transaction_armed=false

if [[ -n "$backup_plist" && -e "$backup_plist" ]]; then
  /bin/rm -f "$backup_plist"
  backup_plist=""
fi
if [[ "$run_now" == true ]]; then
  if ! /bin/launchctl kickstart -p "$target"; then
    print -u2 "The schedule is installed, but the requested immediate run failed to start."
    exit 1
  fi
fi

print "Installed $label for $time_value local time."
print "Logs: $log_dir"
print "State: $state_dir"
