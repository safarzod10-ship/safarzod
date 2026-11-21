import sys

from aiohttp import web

TOKEN = "777:MOCK_TOKEN"


class MockCryptoPay:

    def __init__(self):
        self.invoices, self.transfers, self.checks = {}, {}, {}
        self.fail_transfer: dict[int, str] = {}
        self.network_fail_once: set[int] = set()
        self.seq = 1000

    async def handle(self, request: web.Request):
        assert request.headers.get("Crypto-Pay-API-Token") == TOKEN
        method = request.match_info["method"]
        p = await request.json() if request.can_read_body else {}
        ok = lambda r: web.json_response({"ok": True, "result": r})
        err = lambda name, code=400: web.json_response({"ok": False, "error": {"code": code, "name": name}})
        if method == "getMe":
            return ok({"app_id": 1, "name": "MOCK", "payment_processing_bot_username": "CryptoTestnetBot"})
        if method == "getBalance":
            return ok([{"currency_code": "USDT", "available": "1000.00", "onhold": "0"}])
        if method == "createInvoice":
            assert p["currency_type"] == "crypto" and p["asset"] == "USDT" and p["allow_anonymous"] is False
            self.seq += 1
            inv = {"invoice_id": self.seq, "hash": f"IV{self.seq}", "status": "active", "asset": "USDT", "amount": p["amount"],
                   "payload": p["payload"], "bot_invoice_url": f"https://t.me/CryptoBot?start=IV{self.seq}",
                   "mini_app_invoice_url": f"https://t.me/CryptoBot/app?startapp=invoice-IV{self.seq}",
                   "web_app_invoice_url": f"https://app.send.tg/invoices/IV{self.seq}", "currency_type": "crypto"}
            self.invoices[self.seq] = inv
            return ok(inv)
        if method == "getInvoices":
            ids = [int(x) for x in str(p.get("invoice_ids", "")).split(",") if x]
            return ok({"items": [self.invoices[i] for i in ids if i in self.invoices]})
        if method == "deleteInvoice":
            self.invoices.pop(int(p["invoice_id"]), None)
            return ok(True)
        if method == "transfer":
            uid, spend = int(p["user_id"]), p["spend_id"]
            if spend in self.transfers:
                return ok(self.transfers[spend])
            if uid in self.fail_transfer:
                return err(self.fail_transfer[uid])
            self.seq += 1
            t = {"transfer_id": self.seq, "user_id": uid, "asset": p["asset"], "amount": p["amount"], "status": "completed",
                 "completed_at": "2026-11-20T00:00:00Z", "spend_id": spend}
            self.transfers[spend] = t
            if uid in self.network_fail_once:
                self.network_fail_once.discard(uid)
                return web.Response(status=502, text="<html>bad gateway</html>")
            return ok(t)
        if method == "createCheck":
            self.seq += 1
            c = {"check_id": self.seq, "hash": f"CQ{self.seq}", "asset": p["asset"], "amount": p["amount"],
                 "bot_check_url": f"https://t.me/CryptoBot?start=CQ{self.seq}", "status": "active", "pin_to_user_id": p.get("pin_to_user_id")}
            self.checks[self.seq] = c
            return ok(c)
        return err("METHOD_NOT_FOUND", 404)

    def pay(self, invoice_id: int):
        self.invoices[invoice_id]["status"] = "paid"
        return self.invoices[invoice_id]


def make_app(mock: MockCryptoPay) -> web.Application:
    app = web.Application()

    async def pay_last(_):
        if not mock.invoices:
            return web.json_response({"ok": False}, status=404)
        inv = mock.pay(max(mock.invoices))
        return web.json_response({"ok": True, "invoice_id": inv["invoice_id"]})

    async def state(_):
        return web.json_response({"transfers": mock.transfers, "checks": mock.checks, "invoices": mock.invoices})

    app.router.add_post("/_mock/pay_last", pay_last)
    app.router.add_get("/_mock/state", state)
    app.router.add_route("*", "/api/{method}", mock.handle)
    return app


if __name__ == "__main__":
    web.run_app(make_app(MockCryptoPay()), host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 18765)
