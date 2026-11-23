#!/usr/bin/env bash
# Activates a Unity license (falls back to Personal) using UNITY_EMAIL / UNITY_PASSWORD
# from the environment. Never put the credentials in this file or in Git.
set -euo pipefail
: "${UNITY_EMAIL:?set UNITY_EMAIL in the environment settings}"
: "${UNITY_PASSWORD:?set UNITY_PASSWORD in the environment settings}"
L=/opt/unity/6000.3.29f1/Editor/Data/Resources/Licensing/Client/Unity.Licensing.Client
"$L" --activate-all --include-personal --username "$UNITY_EMAIL" "--password=$UNITY_PASSWORD"
"$L" --showEntitlements
