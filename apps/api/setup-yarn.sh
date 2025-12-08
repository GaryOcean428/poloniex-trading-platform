#!/bin/sh
corepack enable
corepack prepare yarn@4.9.2 --activate
ln -sf $(which yarn) /usr/local/bin/yarn
export PATH="/usr/local/bin:$PATH"
yarn --version