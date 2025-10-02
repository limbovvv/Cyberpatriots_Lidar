from __future__ import annotations

import io
import struct
from dataclasses import dataclass
from typing import Iterable, List, Sequence

try:
    from lzf import decompress as _lib_lzf_decompress
except ImportError:  # pragma: no cover - optional dependency fallback
    _lib_lzf_decompress = None


@dataclass(slots=True)
class PointRecord:
    x: float
    y: float
    z: float
    r: int = 0
    g: int = 0
    b: int = 0
    intensity: int = 0


class UnsupportedPCDError(Exception):
    """Raised when the provided PCD is not supported by the lightweight parser."""


@dataclass(slots=True)
class ParsedPointCloud:
    points: List[PointRecord]


@dataclass(slots=True)
class _PCDField:
    name: str
    size: int
    type_code: str
    count: int


@dataclass(slots=True)
class _PCDMetadata:
    fields: List[_PCDField]
    data_format: str
    points: int
    point_step: int


@dataclass(slots=True)
class _ComponentLayout:
    name: str
    type_code: str
    size: int
    offset: int


_DEF_FIELD_NAMES = {"x", "y", "z", "rgb", "r", "g", "b", "intensity"}
_SUPPORTED_FORMATS = {"ascii", "binary", "binary_compressed"}


def parse_pcd(payload: bytes) -> ParsedPointCloud:
    metadata, body = _parse_header(payload)
    if metadata.data_format == "ascii":
        return _parse_ascii(body.decode("utf-8"), metadata)
    if metadata.data_format == "binary":
        return _parse_binary(body, metadata)
    if metadata.data_format == "binary_compressed":
        return _parse_binary_compressed(body, metadata)
    raise UnsupportedPCDError(f"Unsupported PCD DATA format: {metadata.data_format}")


def serialize_ascii_pcd(points: Sequence[PointRecord]) -> str:
    header = [
        "# .PCD v0.7 - Point Cloud Data file format",
        "VERSION 0.7",
        "FIELDS x y z r g b intensity",
        "SIZE 4 4 4 1 1 1 1",
        "TYPE F F F U U U U",
        "COUNT 1 1 1 1 1 1 1",
        f"WIDTH {len(points)}",
        "HEIGHT 1",
        "VIEWPOINT 0 0 0 1 0 0 0",
        f"POINTS {len(points)}",
        "DATA ascii",
    ]
    output_lines = header.copy()
    for point in points:
        output_lines.append(
            f"{point.x} {point.y} {point.z} {int(point.r)} {int(point.g)} {int(point.b)} {int(point.intensity)}"
        )
    return "\n".join(output_lines) + "\n"


# --- internal helpers -----------------------------------------------------


def _parse_header(payload: bytes) -> tuple[_PCDMetadata, bytes]:
    stream = io.BytesIO(payload)
    header_lines: list[str] = []

    while True:
        line = stream.readline()
        if line == b"":
            raise UnsupportedPCDError("Unexpected end of file while reading header")
        stripped = line.decode("utf-8", errors="strict").strip()
        if not stripped:
            continue
        header_lines.append(stripped)
        if stripped.lower().startswith("data"):
            break

    data_offset = stream.tell()

    fields: list[str] | None = None
    sizes: list[int] | None = None
    types: list[str] | None = None
    counts: list[int] | None = None
    points: int | None = None
    width: int | None = None
    height: int | None = None
    data_format = "ascii"

    for entry in header_lines:
        parts = entry.split()
        if not parts:
            continue
        key = parts[0].lower()
        values = parts[1:]
        if key == "fields":
            fields = values
        elif key == "size":
            sizes = [int(x) for x in values]
        elif key == "type":
            types = values
        elif key == "count":
            counts = [int(x) for x in values]
        elif key == "width":
            width = int(values[0])
        elif key == "height":
            height = int(values[0])
        elif key == "points":
            points = int(values[0])
        elif key == "data":
            if not values:
                raise UnsupportedPCDError("DATA directive missing format specification")
            data_format = values[0].lower()

    if fields is None or types is None:
        raise UnsupportedPCDError("FIELDS and TYPE directives are required")
    if counts is None:
        counts = [1] * len(fields)
    if sizes is None:
        sizes = [4] * len(fields)

    if not (len(fields) == len(types) == len(counts) == len(sizes)):
        raise UnsupportedPCDError("FIELDS/TYPE/SIZE/COUNT directives lengths mismatch")

    if points is None:
        if width is not None and height is not None:
            points = width * height
        else:
            raise UnsupportedPCDError("POINTS directive is required to determine cloud size")

    if data_format not in _SUPPORTED_FORMATS:
        raise UnsupportedPCDError(f"Unsupported DATA format: {data_format}")

    accumulated = 0
    parsed_fields: list[_PCDField] = []
    for name, size, type_code, count in zip(fields, sizes, types, counts, strict=True):
        parsed_fields.append(_PCDField(name=name, size=size, type_code=type_code.upper(), count=count))
        accumulated += size * count

    metadata = _PCDMetadata(fields=parsed_fields, data_format=data_format, points=points, point_step=accumulated)

    body = payload[data_offset:]
    if len(body) == 0:
        raise UnsupportedPCDError("PCD file contains no data section")

    return metadata, body


def _parse_ascii(body: str, metadata: _PCDMetadata) -> ParsedPointCloud:
    expanded_fields: list[tuple[str, str]] = []
    for field in metadata.fields:
        if field.count == 1:
            expanded_fields.append((field.name, field.type_code))
        else:
            for idx in range(field.count):
                expanded_fields.append((f"{field.name}_{idx}", field.type_code))

    if not any(name in _DEF_FIELD_NAMES for name, _ in expanded_fields):
        raise UnsupportedPCDError("PCD must contain at least x, y, z fields")

    points: list[PointRecord] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        values = line.split()
        if len(values) != len(expanded_fields):
            raise UnsupportedPCDError("Row size does not match header definition")
        record = _empty_point()
        for raw, (name, type_code) in zip(values, expanded_fields, strict=True):
            _assign_value(record, name, _coerce_ascii(raw, type_code))
        points.append(record)

    if not points:
        raise UnsupportedPCDError("PCD file contains no point data")

    return ParsedPointCloud(points=points)


def _parse_binary(body: bytes, metadata: _PCDMetadata) -> ParsedPointCloud:
    point_step = metadata.point_step
    expected_len = metadata.points * point_step
    if len(body) < expected_len:
        raise UnsupportedPCDError("Binary PCD payload shorter than expected")

    layouts = _build_component_layouts(metadata)
    points: list[PointRecord] = []
    mv = memoryview(body)
    for idx in range(metadata.points):
        start = idx * point_step
        chunk = mv[start : start + point_step]
        record = _empty_point()
        for component in layouts:
            offset_slice = chunk[component.offset : component.offset + component.size]
            value = _decode_binary(offset_slice, component.type_code, component.size)
            _assign_value(record, component.name, value)
        points.append(record)

    if not points:
        raise UnsupportedPCDError("PCD file contains no point data")

    return ParsedPointCloud(points=points)


def _parse_binary_compressed(body: bytes, metadata: _PCDMetadata) -> ParsedPointCloud:
    if len(body) < 8:
        raise UnsupportedPCDError("Compressed PCD payload too small")

    compressed_size = struct.unpack("<I", body[:4])[0]
    uncompressed_size = struct.unpack("<I", body[4:8])[0]
    compressed_data = body[8 : 8 + compressed_size]
    if len(compressed_data) != compressed_size:
        raise UnsupportedPCDError("Compressed data length mismatch")

    decompressed = _lzf_decompress(compressed_data, uncompressed_size)
    if len(decompressed) != uncompressed_size:
        raise UnsupportedPCDError("LZF decompression returned unexpected size")

    interleaved = _rebuild_interleaved(decompressed, metadata)
    return _parse_binary(interleaved, metadata)


def _build_component_layouts(metadata: _PCDMetadata) -> list[_ComponentLayout]:
    layouts: list[_ComponentLayout] = []
    offset = 0
    for field in metadata.fields:
        for idx in range(field.count):
            name = field.name if field.count == 1 else f"{field.name}_{idx}"
            layouts.append(_ComponentLayout(name=name, type_code=field.type_code, size=field.size, offset=offset))
            offset += field.size
    return layouts


def _rebuild_interleaved(raw: bytes, metadata: _PCDMetadata) -> bytes:
    point_step = metadata.point_step
    expected = metadata.points * point_step
    if len(raw) != expected:
        raise UnsupportedPCDError("Compressed PCD payload size mismatch")

    field_starts: list[tuple[int, int]] = []
    cursor = 0
    for field in metadata.fields:
        field_width = field.size * field.count
        total = field_width * metadata.points
        field_starts.append((cursor, field_width))
        cursor += total

    output = bytearray(expected)
    for point_idx in range(metadata.points):
        dest_offset = point_idx * point_step
        for start, field_width in field_starts:
            src_offset = start + point_idx * field_width
            output[dest_offset : dest_offset + field_width] = raw[src_offset : src_offset + field_width]
            dest_offset += field_width
    return bytes(output)


def _decode_binary(data: memoryview, type_code: str, size: int) -> float | int:
    type_code = type_code.upper()
    if type_code == "F":
        if size == 4:
            return struct.unpack("<f", data)[0]
        if size == 8:
            return struct.unpack("<d", data)[0]
    elif type_code == "I":
        if size == 1:
            return struct.unpack("<b", data)[0]
        if size == 2:
            return struct.unpack("<h", data)[0]
        if size == 4:
            return struct.unpack("<i", data)[0]
        if size == 8:
            return struct.unpack("<q", data)[0]
    elif type_code == "U":
        if size == 1:
            return struct.unpack("<B", data)[0]
        if size == 2:
            return struct.unpack("<H", data)[0]
        if size == 4:
            return struct.unpack("<I", data)[0]
        if size == 8:
            return struct.unpack("<Q", data)[0]
    raise UnsupportedPCDError(f"Unsupported binary field type {type_code}{size}")


def _coerce_ascii(raw: str, type_code: str) -> float | int:
    type_code = type_code.upper()
    if type_code == "F":
        return float(raw)
    if type_code in {"I", "U"}:
        return float(raw)
    return float(raw)


def _assign_value(record: PointRecord, name: str, value: float | int) -> None:
    if name == "x":
        record.x = float(value)
    elif name == "y":
        record.y = float(value)
    elif name == "z":
        record.z = float(value)
    elif name == "intensity":
        record.intensity = int(round(float(value)))
    elif name in {"r", "g", "b"}:
        setattr(record, name, int(round(float(value))))
    elif name == "rgb":
        if isinstance(value, float):
            r, g, b = _unpack_rgb_float(value)
        else:
            r = (int(value) >> 16) & 0xFF
            g = (int(value) >> 8) & 0xFF
            b = int(value) & 0xFF
        record.r = r
        record.g = g
        record.b = b


def _empty_point() -> PointRecord:
    return PointRecord(x=0.0, y=0.0, z=0.0)


def _unpack_rgb_float(value: float) -> tuple[int, int, int]:
    packed = struct.pack("<f", value)
    as_int = struct.unpack("<I", packed)[0]
    r = (as_int >> 16) & 0xFF
    g = (as_int >> 8) & 0xFF
    b = as_int & 0xFF
    return r, g, b


def _lzf_decompress(data: bytes, expected_size: int) -> bytes:
    if _lib_lzf_decompress is not None:
        try:
            return _lib_lzf_decompress(data, expected_size)
        except ValueError as exc:  # pragma: no cover - propagate as our error type
            raise UnsupportedPCDError(str(exc)) from exc
    raise UnsupportedPCDError(
        "python-lzf is required to decode DATA binary_compressed PCD files"
    )
