#!/bin/zsh -f

emulate -LR zsh
setopt ERR_EXIT NO_UNSET PIPE_FAIL
umask 077

script_dir="${0:A:h}"
node_bin="$(whence -p -- node 2>/dev/null || true)"
[[ "$node_bin" == /* && -x "$node_bin" ]] || {
  print -u2 "Node.js is not available as an absolute executable."
  exit 1
}
exec "$node_bin" "$script_dir/run-nightly.mjs" "$@"
