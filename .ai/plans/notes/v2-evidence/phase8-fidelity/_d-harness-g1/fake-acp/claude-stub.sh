#!/bin/sh
# Stands in for the `claude` CLI in desktop e2e lanes that drive a FAKE ACP agent (S6.16 first-canvas).
# Only the one subcommand the connected-gate probe shells out to is answered: "signed in". Anything else is an
# error, so a lane can never reach a real model through this stub.
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '{"loggedIn":true,"apiProvider":"firstParty"}'
  exit 0
fi
exit 1
