"""High‑level service functions for ML preview and apply.

This module defines synchronous service functions that orchestrate
preview generation and application of cleaning masks.  It stores
preview results in a simple in‑memory dictionary for the lifetime of
the process.  In a production system you might persist previews on
disk or in a database and run the heavy work in background tasks via
Celery.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from ..ml.pipeline import build_preview, apply_mask, PreviewResult


# In‑memory store for preview masks keyed by preview_id
_PREVIEW_STORE: Dict[str, Dict[str, object]] = {}


def generate_preview(
    dataset_path: Path | str,
    *,
    eps: float = 0.5,
    min_points: int = 30,
    voxel_size: float = 0.05,
    use_nn: bool = True,
    checkpoint: Optional[Path | str] = None,
    model_type: str = "pointnet",
    target_classes: Optional[list[str]] = None,
) -> str:
    """Generate a preview mask and return its identifier.

    The preview is stored in the internal ``_PREVIEW_STORE``.  The
    returned identifier can be used to fetch statistics or to apply
    the mask later.
    """
    result: PreviewResult = build_preview(
        dataset_path,
        eps=eps,
        min_points=min_points,
        voxel_size=voxel_size,
        use_nn=use_nn,
        checkpoint=checkpoint,
        model_type=model_type,
        target_classes=target_classes,
    )
    _PREVIEW_STORE[result.id] = {
        "dataset_path": str(dataset_path),
        "mask": result.mask,
        "labels": result.labels,
        "stats": result.stats,
        "clusters": result.clusters,
        "num_points": int(result.mask.shape[0]),
        "selected_classes": result.selected_classes,
    }
    return result.id


def get_preview_stats(preview_id: str) -> Dict[str, int]:
    """Return class statistics for a previously generated preview."""
    entry = _PREVIEW_STORE.get(preview_id)
    if not entry:
        raise KeyError(f"preview {preview_id!r} not found")
    return entry["stats"]  # type: ignore[return-value]


def apply_preview(
    preview_id: str,
    *,
    classes_to_remove: Optional[list[str]] = None,
    output_path: Path | str,
) -> str:
    """Apply a stored preview mask to the original dataset.

    Parameters
    ----------
    preview_id: str
        Identifier returned by :func:`generate_preview`.
    classes_to_remove: list of str or None
        Optional list of class names to remove.  If ``None`` (default)
        then the entire preview mask is applied.  If provided, only
        points belonging to those classes are removed.
    output_path: Path or str
        Path where the cleaned point cloud will be written.

    Returns
    -------
    str
        The path to the output file.
    """
    entry = _PREVIEW_STORE.get(preview_id)
    if not entry:
        raise KeyError(f"preview {preview_id!r} not found")
    dataset_path = Path(entry["dataset_path"])
    mask: np.ndarray = entry["mask"]  # type: ignore[assignment]
    labels: list[str] = entry["labels"]  # type: ignore[assignment]
    clusters = entry.get("clusters")
    if classes_to_remove is not None:
        # Create a mask restricted to the specified classes by uniting indices
        class_mask = np.zeros_like(mask)
        if clusters is None:
            # Fallback: no clusters available, apply nothing
            mask_to_apply = class_mask
        else:
            # clusters is a list of numpy arrays
            for i, label in enumerate(labels):
                if label in classes_to_remove:
                    idx = clusters[i]
                    class_mask[idx] = True
            mask_to_apply = class_mask
    else:
        mask_to_apply = mask
    apply_mask(dataset_path, mask_to_apply, output_path=Path(output_path))
    return str(output_path)


def get_preview_detail(preview_id: str) -> Dict[str, object]:
    """Return detailed info for a preview: sizes, clusters and labels.

    The structure is JSON‑serializable for API responses.
    """
    entry = _PREVIEW_STORE.get(preview_id)
    if not entry:
        raise KeyError(f"preview {preview_id!r} not found")
    clusters = entry.get("clusters")
    # Ensure JSON serializable lists for clusters
    clusters_json = []
    if clusters is not None:
        for arr in clusters:  # type: ignore[assignment]
            clusters_json.append([int(x) for x in np.asarray(arr).tolist()])
    return {
        "dataset_path": entry["dataset_path"],
        "num_points": entry.get("num_points", len(entry["mask"])),  # type: ignore[arg-type]
        "labels": entry["labels"],
        "clusters": clusters_json,
        "selected_classes": entry.get("selected_classes", []),
    }
