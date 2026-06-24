from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/indstockscreener"

    class Config:
        env_file = ".env"


settings = Settings()
