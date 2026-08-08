#!/usr/bin/env bash

set -e

bun run format
bun run lint
if [[ "$1" == "-t" ]]; then
    bun run test
fi

