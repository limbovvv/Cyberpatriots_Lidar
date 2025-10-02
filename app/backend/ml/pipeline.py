"""High‑level ML pipeline for LiDAR dataset cleaning.

This module orchestrates the steps required to generate a preview
mask of objects to be removed from a LiDAR dataset and to apply the
mask to produce a cleaned output.  It leverages geometry‑based
segmentation rules from :mod:`ml.rules` and a light‑weight neural
network classifier from :mod:`ml.inference_pointnet`.

The implementation here is deliberately simple.  For large datasets
you should add batching/streaming logic to avoid loading the entire
dataset into memory at once.  See the docstrings below for guidance.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import open3d as o3d
import torch

from .rules import segment_ground, cluster_points, heuristic_labels
from .inference_pointnet import load_model, classify_clusters


DEFAULT_MAX_NN_POINTS = 4096
KNOWN_CLASSES = [
    "ground",
    "vegetation",
    "car",
    "person",
    "pole",
    "wire",
    "other",
]
KNOWN_CLASS_SET = set(KNOWN_CLASSES)
DEFAULT_TARGET_CLASSES = ["car", "person", "vegetation", "wire", "pole"]


class PreviewResult:
    """Simple container for preview results.

    Parameters
    ----------
    mask: numpy.ndarray
        Boolean mask over all points indicating proposed removals.
    labels: list of str
        Predicted label for each cluster (same order as clusters).
    stats: dict[str, int]
        Counts of points by class.
    id: str
        Unique identifier for this preview.
    """

    def __init__(self, mask: np.ndarray, labels: List[str], stats: Dict[str, int]) -> None:
        self.mask = mask
        self.labels = labels
        self.stats = stats
        self.id = str(uuid.uuid4())
        # Indices of points per cluster (filled by build_preview)
        self.clusters: List[np.ndarray] = []
        # Classes that were selected for removal/highlighting during preview
        self.selected_classes: List[str] = []


def _limit_cluster_points(points: np.ndarray, max_points: int) -> np.ndarray:
    """Return at most ``max_points`` samples from ``points``.

    Uses deterministic uniform sampling so the same input produces the
    same reduced cluster, avoiding unnecessary randomness between
    preview runs.
    """
    if max_points <= 0 or points.shape[0] <= max_points:
        return points
    # Evenly spaced indices across the cluster
    indices = np.linspace(0, points.shape[0] - 1, num=max_points, dtype=np.int64)
    return points[indices]


def build_preview(
    dataset_path: Path | str,
    *,
    eps: float = 0.5,
    min_points: int = 30,
    voxel_size: float = 0.05,
    use_nn: bool = True,
    checkpoint: Optional[Path | str] = None,
    model_type: str = "pointnet",
    max_nn_points: int = DEFAULT_MAX_NN_POINTS,
    target_classes: Optional[Iterable[str]] = None,
) -> PreviewResult:
    """Generate a preview mask for objects to remove.

    Reads a point cloud from ``dataset_path``, segments ground and
    clusters non‑ground points, optionally classifies clusters with a
    neural network, and builds a boolean mask marking points that
    should be removed.  The returned :class:`PreviewResult` contains
    the mask, per‑cluster labels and a summary of point counts.

    Parameters
    ----------
    dataset_path: Path or str
        Path to a point cloud file (PCD, PLY, etc.).
    eps: float
        DBSCAN radius in metres.
    min_points: int
        Minimum number of points to form a cluster.
    voxel_size: float
        Size for voxel downsampling during preview (smaller yields
        more detail but slower processing).
    use_nn: bool
        Whether to classify clusters with the neural network.  If
        ``False`` then only heuristic rules are used.
    checkpoint: Path or str or None
        Optional path to a ``.pt`` file for loading model weights.
    max_nn_points: int
        Maximum number of points from each cluster that will be fed to
        the neural network classifier.  Larger clusters are
        deterministically sub-sampled to avoid excessive memory
        consumption when batching tensors.
    target_classes: iterable of str or None
        Classes that should be marked in the preview mask.  If ``None``
        the default (`car`, `person`, `vegetation`, `wire`, `pole`) is
        used.  Unknown class names are ignored.

    Returns
    -------
    PreviewResult
        A container with the preview mask and statistics.
    """
    dataset_path = Path(dataset_path)
    # Load point cloud using Open3D
    pcd = o3d.io.read_point_cloud(str(dataset_path))
    # Optionally downsample for preview
    if voxel_size > 0:
        pcd = pcd.voxel_down_sample(voxel_size=voxel_size)
    num_points = len(pcd.points)
    # Identify ground points
    ground_mask = segment_ground(pcd)
    non_ground_indices = np.where(~ground_mask)[0]
    non_ground_pcd = pcd.select_by_index(non_ground_indices)
    # Cluster non‑ground points
    clusters = cluster_points(non_ground_pcd, eps=eps, min_points=min_points)
    # Convert cluster indices back to full cloud indices
    global_clusters: List[np.ndarray] = [non_ground_indices[c] for c in clusters]
    if target_classes is None:
        target_class_set = set(DEFAULT_TARGET_CLASSES)
    else:
        target_class_set = {cls for cls in target_classes if cls in KNOWN_CLASS_SET}
    # Heuristic labels
    labels = heuristic_labels(pcd, global_clusters, ground_mask=ground_mask)
    # Neural network classification (optional)
    if use_nn and global_clusters:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        # Dynamically import the desired model and helper functions
        if model_type == "dgcnn":
            from .inference_dgcnn import load_model as load_fn, classify_clusters as classify_fn
        else:
            from .inference_pointnet import load_model as load_fn, classify_clusters as classify_fn
        model = load_fn(checkpoint, device=device)
        points_np = np.asarray(pcd.points)
        cluster_tensors = []
        for idx_array in global_clusters:
            pts = points_np[idx_array]
            limited = _limit_cluster_points(pts, max_nn_points)
            # Normalise cluster: centre and scale to unit sphere
            centre = limited.mean(axis=0)
            centred = limited - centre
            norm = np.linalg.norm(centred, axis=1).max()
            if norm > 0:
                normalised = centred / norm
            else:
                normalised = centred
            cluster_tensors.append(torch.from_numpy(normalised.astype(np.float32, copy=False)))
        nn_labels = classify_fn(model, cluster_tensors, device=device)
        # override heuristic labels
        for i, lbl in enumerate(nn_labels):
            labels[i] = lbl
    # Build boolean mask of points to remove (initially False)
    mask = np.zeros(num_points, dtype=bool)
    class_counts: Dict[str, int] = {}
    for i, idx_array in enumerate(global_clusters):
        label = labels[i]
        # Skip ground and other categories that should be kept
        if label in target_class_set:
            # Mark points for removal based on chosen classes
            mask[idx_array] = True
            class_counts[label] = class_counts.get(label, 0) + len(idx_array)
        else:
            # Unknown label – do not remove
            pass
    result = PreviewResult(
        mask=mask,
        labels=[labels[i] for i in range(len(global_clusters))],
        stats=class_counts,
    )
    result.clusters = global_clusters
    ordered_classes = [cls for cls in KNOWN_CLASSES if cls in target_class_set]
    result.selected_classes = ordered_classes
    return result


def apply_mask(
    dataset_path: Path | str,
    mask: np.ndarray,
    *,
    output_path: Path | str,
) -> None:
    """Apply a boolean mask to remove points from a dataset and save the result.

    This function reads a point cloud file, filters out points where
    ``mask`` is ``True`` and writes the cleaned cloud to
    ``output_path``.  The order of points is preserved.

    Parameters
    ----------
    dataset_path: Path or str
        Path to the original point cloud file.
    mask: numpy.ndarray
        A boolean mask with length equal to the number of points in the
        original cloud.  ``True`` values indicate points to remove.
    output_path: Path or str
        Destination path for the cleaned point cloud.  The file
        extension determines the format (``.pcd``, ``.ply``, etc.).
    """
    dataset_path = Path(dataset_path)
    output_path = Path(output_path)
    pcd = o3d.io.read_point_cloud(str(dataset_path))
    if len(mask) != len(pcd.points):
        raise ValueError(
            f"mask length {len(mask)} does not match number of points {len(pcd.points)}"
        )
    keep_indices = np.where(~mask)[0]
    cleaned = pcd.select_by_index(keep_indices)
    o3d.io.write_point_cloud(str(output_path), cleaned)
