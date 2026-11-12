#!/usr/bin/env python3
"""Administrator: make a one-time top-up code for a player.
   python3 tools/admin/make_code.py <player ID> <amount in game somoni>
The key must match Account.KEY in scripts/account/account.gd (change both before release)."""
import hmac, hashlib, secrets, sys

KEY = "dushanbe-city-topup-2026-key-v1-change-me"

if len(sys.argv) != 3:
    sys.exit(__doc__)
pid, amount = sys.argv[1].strip(), int(sys.argv[2])
nonce = secrets.token_hex(3).upper()
sig = hmac.new(KEY.encode(), f"{pid}|{amount}|{nonce}".encode(), hashlib.sha256).hexdigest()[:10].upper()
print(f"DX-{amount}-{nonce}-{sig}")
