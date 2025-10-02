from __future__ import annotations

from pathlib import Path
from typing import Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.dataset import Dataset
from ..models.job import Job, JobKind, JobStatus
from ..models.session import Operation, Session as SessionModel
from ..storage import get_storage
from ..utils.logger import get_logger
from ..utils.pcd import UnsupportedPCDError, parse_pcd, serialize_ascii_pcd


logger = get_logger(__name__)


def enqueue_job(session: Session, dataset_id: str, kind: JobKind, meta: dict | None = None) -> Job:
    job = Job(dataset_id=dataset_id, kind=kind, status=JobStatus.pending, meta=meta or {})
    session.add(job)
    session.flush()
    return job


def collect_removed_indices(session: Session, dataset_id: str) -> Set[int]:
    stmt = (
        select(Operation.op)
        .join(SessionModel, Operation.session_id == SessionModel.id)
        .where(SessionModel.dataset_id == dataset_id)
        .order_by(Operation.version)
    )
    removed: set[int] = set()
    for (payload,) in session.execute(stmt):
        if not isinstance(payload, dict):
            continue
        indices: set[int] = set()
        if "indices" in payload and isinstance(payload["indices"], list):
            indices.update(int(i) for i in payload["indices"])
        selection = payload.get("selection")
        if isinstance(selection, dict) and isinstance(selection.get("indices"), list):
            indices.update(int(i) for i in selection["indices"])
        action = payload.get("action") or payload.get("op")
        if action in {"delete", "mask.delete", "remove"}:
            removed.update(indices)
    return removed


def perform_export(session: Session, dataset_id: str) -> tuple[Job, Path]:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise ValueError("Dataset not found")
    if not dataset.raw_uri:
        raise ValueError("Dataset has no raw file")

    storage = get_storage()
    raw_path = Path(dataset.raw_uri)
    if not raw_path.exists():
        raise ValueError("Raw dataset file is missing on disk")

    try:
        raw_bytes = raw_path.read_bytes()
    except OSError as exc:
        raise ValueError(f"Failed to read raw dataset file: {exc}") from exc

    try:
        parsed = parse_pcd(raw_bytes)
    except UnsupportedPCDError as exc:
        logger.error(
            "export.parse_failed",
            extra={"dataset_id": dataset_id, "pcd_error": str(exc)},
        )
        raise ValueError(str(exc)) from exc

    removed_indices = collect_removed_indices(session, dataset_id)
    filtered_points = [point for idx, point in enumerate(parsed.points) if idx not in removed_indices]
    export_payload = serialize_ascii_pcd(filtered_points).encode("utf-8")
    export_path = storage.save_export(dataset_id, export_payload)

    meta = {
        "points_total": len(parsed.points),
        "removed": len(removed_indices),
        "kept": len(filtered_points),
    }

    job = enqueue_job(session, dataset_id, JobKind.export, meta=meta)
    job.status = JobStatus.done
    session.flush()

    return job, export_path
