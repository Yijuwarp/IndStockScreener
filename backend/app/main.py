from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import stocks
from app.services.freshness import check_and_refresh, status

app = FastAPI(title="IndStockScreener API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router)


@app.on_event("startup")
def on_startup():
    check_and_refresh()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def get_status():
    return {"refreshing": status.refreshing, "data_as_of": status.data_as_of}
