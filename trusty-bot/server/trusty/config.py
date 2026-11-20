"""Settings from environment variables (on the server: /etc/trusty/trusty.env)."""
import hashlib
import hmac
import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    bot_token: str = field(default_factory=lambda: _env("TRUSTY_BOT_TOKEN"))
    db_url: str = field(default_factory=lambda: _env("TRUSTY_DB_URL", "sqlite+aiosqlite:///./trusty.db"))
    public_url: str = field(default_factory=lambda: _env("TRUSTY_PUBLIC_URL").rstrip("/"))
    admin_code: str = field(default_factory=lambda: _env("TRUSTY_ADMIN_CODE"))
    upload_dir: str = field(default_factory=lambda: _env("TRUSTY_UPLOAD_DIR", "./uploads"))
    bot_mode: str = field(default_factory=lambda: _env("TRUSTY_BOT_MODE", "polling"))  # polling | off
    # local development only: accept "Authorization: dev <telegram id>" without a signed initData
    dev_auth: bool = field(default_factory=lambda: _env("TRUSTY_DEV_AUTH") == "1")
    max_admins: int = 2
    # payments: Crypto Pay API of @CryptoBot (@send)
    cryptopay_token: str = field(default_factory=lambda: _env("TRUSTY_CRYPTOPAY_TOKEN"))
    cryptopay_url: str = field(default_factory=lambda: _env("TRUSTY_CRYPTOPAY_URL", "https://pay.crypt.bot"))
    asset: str = field(default_factory=lambda: _env("TRUSTY_ASSET", "USDT"))
    fee_percent: float = field(default_factory=lambda: float(_env("TRUSTY_FEE_PERCENT", "5")))
    review_days: float = field(default_factory=lambda: float(_env("TRUSTY_REVIEW_DAYS", "3")))
    new_dev_limit: int = field(default_factory=lambda: int(_env("TRUSTY_NEW_DEV_LIMIT", "100")))

    @property
    def secret(self) -> bytes:
        """Server-side secret for signing file links, derived from the bot token."""
        return hmac.new(b"trusty-files", self.bot_token.encode(), hashlib.sha256).digest()


settings = Settings()
