from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.tile import Tile


def list_tiles(session: Session, dataset_id: str) -> Iterable[Tile]:
    stmt = select(Tile).where(Tile.dataset_id == dataset_id).order_by(Tile.z, Tile.x, Tile.y)
    return session.scalars(stmt)


def get_tile_by_coords(session: Session, dataset_id: str, z: int, x: int, y: int) -> Tile | None:
    stmt = select(Tile).where(
        Tile.dataset_id == dataset_id,
        Tile.z == z,
        Tile.x == x,
        Tile.y == y,
    )
    return session.scalar(stmt)
