from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO

from .core.config import get_settings


class LocalStorage:
    def __init__(self, root: str | Path | None = None) -> None:
        settings = get_settings()
        self.root = Path(root or settings.data_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def dataset_dir(self, dataset_id: str) -> Path:
        path = self.root / dataset_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def raw_dir(self, dataset_id: str) -> Path:
        path = self.dataset_dir(dataset_id) / "raw"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def tiles_dir(self, dataset_id: str) -> Path:
        path = self.dataset_dir(dataset_id) / "tiles"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def masks_dir(self, dataset_id: str) -> Path:
        path = self.dataset_dir(dataset_id) / "masks"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def export_dir(self, dataset_id: str) -> Path:
        path = self.dataset_dir(dataset_id) / "export"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_raw_file(self, dataset_id: str, filename: str, fileobj: BinaryIO) -> Path:
        target = self.raw_dir(dataset_id) / filename
        with target.open("wb") as dest:
            dest.write(fileobj.read())
        return target

    def tile_path(self, dataset_id: str, z: int, x: int, y: int) -> Path:
        return self.tiles_dir(dataset_id) / f"{z}_{x}_{y}.bin"

    def save_tile(self, dataset_id: str, z: int, x: int, y: int, payload: bytes) -> Path:
        target = self.tile_path(dataset_id, z, x, y)
        with target.open("wb") as fh:
            fh.write(payload)
        return target

    def read_tile(self, dataset_id: str, z: int, x: int, y: int) -> bytes:
        target = self.tile_path(dataset_id, z, x, y)
        with target.open("rb") as fh:
            return fh.read()

    def save_mask(self, dataset_id: str, version: int, payload: bytes) -> Path:
        target = self.masks_dir(dataset_id) / f"{version}.rle"
        with target.open("wb") as fh:
            fh.write(payload)
        return target

    def save_export(self, dataset_id: str, payload: bytes, filename: str = "processed_points.pcd") -> Path:
        target = self.export_dir(dataset_id) / filename
        with target.open("wb") as fh:
            fh.write(payload)
        return target


_storage: LocalStorage | None = None


def get_storage() -> LocalStorage:
    global _storage
    if _storage is None:
        _storage = LocalStorage()
    return _storage
