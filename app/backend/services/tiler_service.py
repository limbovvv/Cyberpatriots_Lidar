from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from typing import Iterable, Sequence

from ..utils.pcd import PointRecord


@dataclass(slots=True)
class TilePayload:
    z: int
    x: int
    y: int
    data: bytes
    point_count: int
    start_index: int


MAGIC = 0x50544344  # 'PTCD'
VERSION = 1


def _pack_tile(points: Sequence[PointRecord]) -> bytes:
    buffer = bytearray()
    buffer.extend(struct.pack("<IHI", MAGIC, VERSION, len(points)))
    for point in points:
        buffer.extend(struct.pack(
            "<fffBBBB",
            point.x,
            point.y,
            point.z,
            point.r,
            point.g,
            point.b,
            max(0, min(point.intensity, 255)),
        ))
    return bytes(buffer)


def build_tiles(points: Sequence[PointRecord], capacity: int = 20000) -> Iterable[TilePayload]:
    if not points:
        return []

    tiles: list[TilePayload] = []
    total_tiles = math.ceil(len(points) / capacity)
    grid_width = math.ceil(math.sqrt(total_tiles))

    for idx in range(total_tiles):
        start = idx * capacity
        chunk = points[start : start + capacity]
        z = 0
        x = idx % grid_width
        y = idx // grid_width
        data = _pack_tile(chunk)
        tiles.append(
            TilePayload(
                z=z,
                x=x,
                y=y,
                data=data,
                point_count=len(chunk),
                start_index=start,
            )
        )
    return tiles
