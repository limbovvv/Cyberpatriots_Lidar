"""Simple PointNet-like inference module.

This module provides a light-weight, pure‑PyTorch implementation of a
PointNet‑style model for classifying clusters of points within a
LiDAR point cloud.  It exposes two functions: one for loading a model
and another for predicting labels for a list of point clusters.

The intent of this module is to avoid any compiled extensions or
bindings (e.g. `open3d.ml.torch`) so that it runs out of the box on
Windows or Linux without a custom build.  For production deployments
you can replace this implementation with a more sophisticated model as
long as it preserves the same public interface.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Sequence

import torch
import torch.nn as nn
import torch.nn.functional as F


class PointNetLite(nn.Module):
    """A minimal PointNet‑like network for cluster classification.

    This implementation maps a variable number of 3D points into a
    fixed‑size global feature using a simple shared MLP and max
    pooling.  It then predicts a class label via a small fully
    connected head.  The network expects input tensors of shape
    ``(batch_size, num_points, 3)`` with coordinates centred near
    zero.  The number of output classes is configurable at
    construction time.
    """

    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.mlp = nn.Sequential(
            nn.Linear(3, 64),
            nn.ReLU(),
            nn.Linear(64, 128),
            nn.ReLU(),
            nn.Linear(128, 256),
            nn.ReLU(),
        )
        self.fc = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, N, 3)
        batch_size, num_points, _ = x.shape
        features = self.mlp(x)  # (batch, N, 256)
        # aggregate by max pooling along the point dimension
        global_feat, _ = torch.max(features, dim=1)  # (batch, 256)
        logits = self.fc(global_feat)  # (batch, num_classes)
        return logits


def load_model(checkpoint_path: Path | str | None = None, *, device: str = "cpu") -> PointNetLite:
    """Load a classification model.

    Parameters
    ----------
    checkpoint_path: Path or str or None
        Optional path to a ``.pt`` file containing model weights.  If
        ``None`` (default), a randomly initialised model is returned.
    device: str
        The device to place the model on.  Default is ``"cpu"``.  You
        can specify ``"cuda"`` if a GPU is available and PyTorch has
        been installed with CUDA support.

    Returns
    -------
    PointNetLite
        The loaded or newly initialised model.
    """
    # Define the set of class names used by your application.  You can
    # adjust this list to match the number and order of classes you
    # wish to detect/remove.  The length of this list determines
    # ``num_classes``.
    class_names = [
        "ground",
        "vegetation",
        "car",
        "person",
        "pole",
        "wire",
        "other",
    ]
    num_classes = len(class_names)
    model = PointNetLite(num_classes)
    model.to(device)
    model.eval()
    if checkpoint_path:
        checkpoint_path = Path(checkpoint_path)
        state = torch.load(checkpoint_path, map_location=device)
        model.load_state_dict(state)
    return model


def classify_clusters(
    model: PointNetLite,
    clusters: Sequence[torch.Tensor],
    *,
    device: str = "cpu",
    batch_size: int = 64,
) -> List[str]:
    """Predict class labels for a sequence of point clusters.

    Each cluster is given as a tensor of shape ``(N_i, 3)``.  The
    coordinates should already be normalised/centred.  The function
    returns a list of string class labels of the same length.

    Parameters
    ----------
    model: PointNetLite
        The classification model returned by :func:`load_model`.
    clusters: sequence of torch.Tensor
        A sequence of point clouds representing individual object
        clusters.  Each tensor should have shape ``(num_points, 3)``.
    device: str
        Device for computation (``"cpu"`` or ``"cuda"``).

    Returns
    -------
    list of str
        Predicted class names for each cluster.
    """
    if not clusters:
        return []
    class_names = [
        "ground",
        "vegetation",
        "car",
        "person",
        "pole",
        "wire",
        "other",
    ]
    # Batch the clusters in manageable chunks; pad to the longest
    # cluster length within each batch so tensors align for PointNet.
    batch: list[torch.Tensor] = []
    batch_max_points = 0
    preds: List[int] = []

    def _run_batch(items: List[torch.Tensor], max_points: int) -> None:
        if not items:
            return
        padded = []
        for tensor in items:
            points = tensor
            num_points = points.shape[0]
            if num_points < max_points:
                padding = torch.zeros((max_points - num_points, 3), device=device, dtype=points.dtype)
                points = torch.cat([points, padding], dim=0)
            padded.append(points.unsqueeze(0))
        batch_tensor = torch.cat(padded, dim=0)  # (batch_size, max_points, 3)
        with torch.no_grad():
            logits = model(batch_tensor)
            preds.extend(logits.argmax(dim=1).tolist())

    for cluster in clusters:
        points = cluster.to(device)
        if points.ndim != 2 or points.shape[1] != 3:
            raise ValueError("each cluster must be a 2D tensor with shape (N, 3)")
        batch.append(points)
        batch_max_points = max(batch_max_points, points.shape[0])
        if len(batch) >= max(1, batch_size):
            _run_batch(batch, batch_max_points)
            batch = []
            batch_max_points = 0

    if batch:
        _run_batch(batch, batch_max_points)

    return [class_names[p] for p in preds]
