"""Crypto Pay API client (the payment API of @CryptoBot / @send).

Base URL https://pay.crypt.bot/api/<method> (testnet: https://testnet-pay.crypt.bot), auth header Crypto-Pay-API-Token.
Responses: {"ok": true, "result": ...} or {"ok": false, "error": {"code": 400, "name": "..."}}.
Webhook updates are signed: header Crypto-Pay-Api-Signature = hex HMAC-SHA256(key=SHA256(token), msg=raw body).
"""
import hashlib
import hmac
import json
import logging
from decimal import ROUND_DOWN, Decimal

import aiohttp

from .config import settings

log = logging.getLogger("trusty.cryptopay")
CENT = Decimal("0.01")


class CryptoPayError(Exception):
    def __init__(self, code: int, name: str):
        super().__init__(f"{code} {name}")
        self.code, self.name = code, name

    @property
    def uncertain(self) -> bool:
        """True when the request may have been executed (network failure, 5xx, unreadable answer)."""
        return self.code == 0 or self.code >= 500


def money(x) -> Decimal:
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_DOWN)


def amount_str(x) -> str:
    return format(money(x), "f")


def check_signature(raw_body: bytes, signature: str, token: str | None = None) -> bool:
    token = token if token is not None else settings.cryptopay_token
    if not token or not signature:
        return False
    secret = hashlib.sha256(token.encode()).digest()
    expected = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class CryptoPay:
    def __init__(self, token: str, base_url: str):
        self.token = token
        self.base = base_url.rstrip("/") + "/api/"
        self._session: aiohttp.ClientSession | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    async def _call(self, method: str, **params):
        if not self.token:
            raise CryptoPayError(0, "NOT_CONFIGURED")
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
        body = {k: v for k, v in params.items() if v is not None}
        try:
            async with self._session.post(self.base + method, json=body, headers={"Crypto-Pay-API-Token": self.token}) as r:
                text = await r.text()
        except (aiohttp.ClientError, TimeoutError) as e:
            raise CryptoPayError(0, f"NETWORK: {e}") from e
        try:
            data = json.loads(text)
        except ValueError as e:
            raise CryptoPayError(0 if r.status < 500 else r.status, f"BAD_RESPONSE: {text[:120]}") from e
        if not data.get("ok"):
            err = data.get("error") or {}
            raise CryptoPayError(int(err.get("code") or r.status), str(err.get("name") or "UNKNOWN"))
        return data["result"]

    async def get_me(self) -> dict:
        return await self._call("getMe")

    async def get_balance(self) -> list[dict]:
        return await self._call("getBalance")

    async def create_invoice(self, amount, description: str, payload: str, paid_btn_url: str | None = None,
                             expires_in: int = 86400, hidden_message: str | None = None) -> dict:
        return await self._call(
            "createInvoice", currency_type="crypto", asset=settings.asset, amount=amount_str(amount),
            description=description[:1024], payload=payload[:4000], hidden_message=(hidden_message or None),
            paid_btn_name="callback" if paid_btn_url else None, paid_btn_url=paid_btn_url,
            allow_comments=False, allow_anonymous=False, expires_in=expires_in)

    async def get_invoices(self, invoice_ids: list[int]) -> list[dict]:
        if not invoice_ids:
            return []
        res = await self._call("getInvoices", invoice_ids=",".join(map(str, invoice_ids)), count=1000)
        return res.get("items", []) if isinstance(res, dict) else res

    async def delete_invoice(self, invoice_id: int) -> bool:
        return await self._call("deleteInvoice", invoice_id=invoice_id)

    async def transfer(self, user_id: int, amount, spend_id: str, comment: str) -> dict:
        return await self._call("transfer", user_id=user_id, asset=settings.asset, amount=amount_str(amount),
                                spend_id=spend_id[:64], comment=comment[:1024])

    async def create_check(self, user_id: int, amount) -> dict:
        return await self._call("createCheck", asset=settings.asset, amount=amount_str(amount), pin_to_user_id=user_id)

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()


pay = CryptoPay(settings.cryptopay_token, settings.cryptopay_url)
