from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/indstockscreener"

    class Config:
        env_file = ".env"


settings = Settings()

# Render (and most hosts) hand out postgres:// or postgresql:// URLs; SQLAlchemy
# routes those to psycopg2, but this project uses psycopg v3.
if settings.database_url.startswith("postgres://"):
    settings.database_url = settings.database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif settings.database_url.startswith("postgresql://"):
    settings.database_url = settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
