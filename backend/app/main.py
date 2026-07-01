import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import Base, engine
from app.routers import stocks, indexes
from app.services.freshness import check_and_refresh, status

app = FastAPI(title="IndStockScreener API")

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router)
app.include_router(indexes.router)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)  # dev-mode: no migrations yet, just ensure schema exists
    check_and_refresh()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def get_status():
    return {"refreshing": status.refreshing, "data_as_of": status.data_as_of}
