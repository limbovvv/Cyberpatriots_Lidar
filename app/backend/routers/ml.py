"""FastAPI router for ML preview and cleaning endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import ml_service


router = APIRouter(prefix="/ml", tags=["ml"])


class PreviewRequest(BaseModel):
    dataset_path: Path = Field(..., description="Path to the uploaded point cloud file")
    eps: float = Field(0.5, description="DBSCAN neighbourhood radius in metres")
    min_points: int = Field(30, description="Minimum points to form a cluster")
    voxel_size: float = Field(
        0.05,
        description="Voxel size for downsampling during preview (0.0 keeps 1:1 point count)",
    )
    use_nn: bool = Field(True, description="Whether to use neural network classification")
    checkpoint: Optional[Path] = Field(None, description="Path to model checkpoint (.pt)")
    model_type: str = Field(
        "pointnet",
        description="Type of neural network to use ('pointnet' or 'dgcnn')",
    )
    target_classes: Optional[list[str]] = Field(
        None,
        description="Classes that should be marked in the preview mask (defaults to common objects)",
    )


class PreviewResponse(BaseModel):
    preview_id: str
    stats: dict[str, int]


class ApplyRequest(BaseModel):
    preview_id: str = Field(..., description="Identifier returned from preview")
    classes_to_remove: Optional[List[str]] = Field(None, description="Classes to remove")
    output_path: Path = Field(..., description="Destination path for cleaned point cloud")


class ApplyResponse(BaseModel):
    output_path: Path


@router.post("/preview", response_model=PreviewResponse)
def create_preview(req: PreviewRequest) -> PreviewResponse:
    """Generate a mask preview for the given dataset and return its ID."""
    preview_id = ml_service.generate_preview(
        dataset_path=req.dataset_path,
        eps=req.eps,
        min_points=req.min_points,
        voxel_size=req.voxel_size,
        use_nn=req.use_nn,
        checkpoint=req.checkpoint,
        model_type=req.model_type,
        target_classes=req.target_classes,
    )
    stats = ml_service.get_preview_stats(preview_id)
    return PreviewResponse(preview_id=preview_id, stats=stats)


@router.post("/apply", response_model=ApplyResponse)
def apply_preview(req: ApplyRequest) -> ApplyResponse:
    """Apply a previously generated preview mask to remove objects."""
    try:
        output_path = ml_service.apply_preview(
            req.preview_id,
            classes_to_remove=req.classes_to_remove,
            output_path=req.output_path,
        )
        return ApplyResponse(output_path=Path(output_path))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class PreviewDetailResponse(BaseModel):
    num_points: int
    labels: list[str]
    clusters: list[list[int]]
    selected_classes: list[str] = Field(default_factory=list)


@router.get("/preview/{preview_id}/detail", response_model=PreviewDetailResponse)
def get_preview_detail(preview_id: str) -> PreviewDetailResponse:
    """Return cluster indices and labels to visualise mask in the frontend."""
    try:
        detail = ml_service.get_preview_detail(preview_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return PreviewDetailResponse(
        num_points=int(detail["num_points"]),
        labels=list(detail["labels"]),
        clusters=list(detail["clusters"]),
        selected_classes=list(detail.get("selected_classes", [])),
    )
