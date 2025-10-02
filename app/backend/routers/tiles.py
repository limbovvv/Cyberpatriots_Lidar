from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..core.database import get_session
from ..schemas.tile import TileRead
from ..services.tile_service import get_tile_by_coords, list_tiles
from ..storage import get_storage

router = APIRouter(prefix="/datasets/{dataset_id}/tiles", tags=["tiles"])


@router.get("/", response_model=list[TileRead])
def read_tiles(dataset_id: str, session: Session = Depends(get_session)):
    return list(list_tiles(session, dataset_id))


@router.get("/{z}/{x}/{y}")
def download_tile(dataset_id: str, z: int, x: int, y: int, session: Session = Depends(get_session)):
    tile = get_tile_by_coords(session, dataset_id, z, x, y)
    if tile is None:
        raise HTTPException(status_code=404, detail="Tile not found")
    storage = get_storage()
    payload = storage.read_tile(dataset_id, z, x, y)
    headers = {"Content-Disposition": f"attachment; filename={z}_{x}_{y}.bin"}
    return Response(content=payload, media_type="application/octet-stream", headers=headers)
