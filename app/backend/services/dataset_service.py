from __future__ import annotations

import io
from typing import Iterable

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.dataset import Dataset, DatasetStatus
from ..models.tile import Tile
from ..schemas.dataset import DatasetCreate
from ..services.tiler_service import build_tiles
from ..storage import get_storage
from ..utils.pcd import UnsupportedPCDError, parse_pcd
from ..utils.logger import get_logger


logger = get_logger(__name__)


def list_datasets(session: Session) -> Iterable[Dataset]:
    stmt = select(Dataset).order_by(Dataset.created_at.desc())
    return session.scalars(stmt)


def create_dataset(session: Session, payload: DatasetCreate) -> Dataset:
    dataset = Dataset(
        name=payload.name,
        raw_uri=payload.raw_uri,
        points_total=payload.points_total or 0,
    )
    session.add(dataset)
    session.flush()
    return dataset


def get_dataset(session: Session, dataset_id: str) -> Dataset | None:
    return session.get(Dataset, dataset_id)


def create_dataset_from_upload(session: Session, name: str, upload: UploadFile) -> Dataset:
    raw_bytes = upload.file.read()
    if not raw_bytes:
        logger.warning("upload.empty_file", extra={"pcd_filename": upload.filename})
        raise ValueError("Empty file uploaded")

    dataset = Dataset(name=name, raw_uri="", status=DatasetStatus.uploaded, points_total=0)
    session.add(dataset)
    session.flush()

    storage = get_storage()
    filename = upload.filename or "dataset.pcd"
    storage.save_raw_file(dataset.id, filename, io.BytesIO(raw_bytes))
    dataset.raw_uri = str(storage.raw_dir(dataset.id) / filename)

    try:
        parsed = parse_pcd(raw_bytes)
    except UnsupportedPCDError as exc:
        logger.error(
            "upload.parse_failed",
            extra={
                "dataset_id": dataset.id,
                "pcd_filename": filename,
                "pcd_error": str(exc),
            },
        )
        raise ValueError(str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "upload.unexpected_error",
            extra={"dataset_id": dataset.id, "pcd_filename": filename},
        )
        raise ValueError("Unexpected error during PCD parsing") from exc

    dataset.points_total = len(parsed.points)

    tiles = build_tiles(parsed.points)
    for tile_payload in tiles:
        storage.save_tile(dataset.id, tile_payload.z, tile_payload.x, tile_payload.y, tile_payload.data)
        tile_record = Tile(
            dataset_id=dataset.id,
            z=tile_payload.z,
            x=tile_payload.x,
            y=tile_payload.y,
            uri=str(storage.tile_path(dataset.id, tile_payload.z, tile_payload.x, tile_payload.y)),
            points=tile_payload.point_count,
            base_index=tile_payload.start_index,
        )
        session.add(tile_record)

    dataset.status = DatasetStatus.ready

    return dataset
