#!/bin/sh
export PATH="/root/.yarn/berry/bin:$PATH"
export YARN_GLOBAL_FOLDER="/root/.yarn/berry"
exec /root/.yarn/berry/bin/yarn "$@"