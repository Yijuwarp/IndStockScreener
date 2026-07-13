"""Export the session bundle to a static JSON file.

Run by the data-refresh workflow after ingestion:

    python -m scripts.export_bundle ../frontend/public/bundle.json

The file is committed to the repo, so Vercel redeploys and serves it from the
CDN -- production frontends load their data without touching the backend (no
Render cold start in the read path).
"""
import json
import sys

from fastapi.encoders import jsonable_encoder

from app.db.session import SessionLocal
from app.schemas import BundleOut
from app.services.bundle import build_bundle


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m scripts.export_bundle <output-path>")
    db = SessionLocal()
    try:
        bundle = BundleOut.model_validate(build_bundle(db))
    finally:
        db.close()
    payload = jsonable_encoder(bundle)
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {sys.argv[1]}: {len(payload['stocks'])} stocks, data_as_of {payload['data_as_of']}")


if __name__ == "__main__":
    main()
