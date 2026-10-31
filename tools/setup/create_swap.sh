#!/usr/bin/env bash
# Optional: 4 GiB swap file for low-RAM servers (recommended for the 3.8 GB VPS,
# NOT needed on hosts with >= 8 GB). Refuses to touch existing swap.
#   sudo tools/setup/create_swap.sh [size_gib]
set -euo pipefail
SIZE=${1:-4}; FILE=/swapfile
if swapon --show | grep -q .; then echo "Swap already active — not modifying:"; swapon --show; exit 0; fi
[ -e "$FILE" ] && { echo "$FILE exists but is not active — inspect manually."; exit 1; }
avail=$(df -Pm / | awk 'NR==2{print $4}'); [ "$avail" -ge $((SIZE*1024+4096)) ] || { echo "Not enough disk"; exit 1; }
fallocate -l ${SIZE}G "$FILE" || dd if=/dev/zero of="$FILE" bs=1M count=$((SIZE*1024))
chmod 600 "$FILE"; mkswap "$FILE"; swapon "$FILE"
grep -q "^$FILE " /etc/fstab || echo "$FILE none swap sw 0 0" >> /etc/fstab
sysctl -w vm.swappiness=10 && echo "vm.swappiness=10" > /etc/sysctl.d/99-dushanbe-swap.conf
swapon --show; free -h
