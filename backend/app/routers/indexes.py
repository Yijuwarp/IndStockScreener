from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.stock import MarketIndex
from app.schemas import IndexOut

router = APIRouter(prefix="/indexes", tags=["indexes"])


@router.get("", response_model=list[IndexOut])
def list_indexes(db: Session = Depends(get_db)):
    return db.query(MarketIndex).all()
