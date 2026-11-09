from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    bot_token: str
    bot_username: str = "zuba_ruba_bot"
    admin_ids: Annotated[list[int], NoDecode] = Field(default_factory=list)
    flyer_api_key: str = ""
    flyer_base_url: str = "https://api.flyerhubs.com"
    flyer_webhook_secret: str = ""
    domain: str = "localhost"
    webapp_url: str = ""

    database_url: str = "postgresql+asyncpg://zuba:zuba@postgres:5432/zuba"
    redis_url: str = "redis://redis:6379/0"

    init_data_ttl_seconds: int = 86400
    media_dir: str = "/data/media"
    log_level: str = "INFO"

    @field_validator("admin_ids", mode="before")
    @classmethod
    def _split_ids(cls, value):
        if isinstance(value, str):
            return [int(part) for part in value.replace(" ", "").split(",") if part]
        if isinstance(value, int):
            return [value]
        return value

    @property
    def app_url(self) -> str:
        return self.webapp_url or f"https://{self.domain}"

    def is_admin(self, user_id: int) -> bool:
        return user_id in self.admin_ids


@lru_cache
def get_config() -> Config:
    return Config()
