#!/bin/sh
# Chromium wrapper for the container.
#
# The renderer sandbox needs unprivileged user namespaces, which the default
# Docker seccomp profile blocks. The image therefore defaults to --no-sandbox
# and is suitable only for trusted sites. Set PORTOLAN_CHROME_SANDBOX=1 and
# give the container a seccomp profile that permits the sandbox to turn it on.
set -eu

flags="--disable-dev-shm-usage"
if [ "${PORTOLAN_CHROME_SANDBOX:-0}" != "1" ]; then
  flags="$flags --no-sandbox"
fi

exec /usr/bin/chromium $flags "$@"
