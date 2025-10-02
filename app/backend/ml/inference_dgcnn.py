"""
This module provides a Dynamic Graph Convolutional Neural Network (DGCNN)
implementation for point‑cloud classification.  The network follows the
architecture described in the paper "Dynamic Graph CNN for Learning on
Point Clouds" by Wang et al.  Unlike the original implementation
that relies on custom CUDA/C++ operators, this version uses only
PyTorch operations and thus can run on both CPU and GPU without
additional compilation.  Note that DGCNN expects a fixed number of
points per sample; when classifying clusters with a variable number of
points, this implementation uniformly samples or pads each cluster to
``num_points`` points before inference.

The exported functions `load_model` and `classify_clusters` conform to
the same interface as the PointNet module.  You can drop this file
into your project and select ``model_type='dgcnn'`` in the preview
request to use this network instead of PointNet.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import List, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

def knn(x: torch.Tensor, k: int) -> torch.Tensor:
    """Compute k‑nearest neighbor indices for each point in ``x``.

    Parameters
    ----------
    x: torch.Tensor
        Input tensor of shape ``(B, C, N)``, where ``B`` is the batch
        size, ``C`` the number of channels (typically 3 for xyz), and
        ``N`` the number of points.
    k: int
        Number of nearest neighbors to compute.

    Returns
    -------
    torch.Tensor
        Indices of shape ``(B, N, k)`` giving the indices of the k
        nearest neighbors for each point.
    """
    B, C, N = x.shape
    # pairwise distance: (x^2 + x^2 - 2*xy)
    x_flat = x.view(B, C, N)
    inner = -2 * torch.matmul(x_flat.transpose(2, 1), x_flat)  # (B, N, N)
    xx = torch.sum(x_flat ** 2, dim=1, keepdim=True)  # (B, 1, N)
    pairwise_distance = -xx.transpose(2, 1) - inner - xx  # (B, N, N)
    _, idx = pairwise_distance.topk(k=k, dim=-1)  # (B, N, k)
    return idx

def get_graph_feature(x: torch.Tensor, k: int) -> torch.Tensor:
    """Construct edge features for dynamic graph convolution.

    Given input points ``x`` of shape ``(B, C, N)``, this function
    builds a tensor of shape ``(B, 2*C, N, k)`` where each feature
    captures the difference between a point and its k nearest
    neighbors as well as the original point itself.  This follows
    the formulation in the DGCNN paper.
    """
    idx = knn(x, k)  # (B, N, k)
    B, C, N = x.shape

    idx_base = torch.arange(0, B, device=x.device).view(-1, 1, 1) * N
    idx = idx + idx_base  # (B, N, k)
    idx = idx.view(-1)

    # (B, C, N) -> (B*N, C)
    x_flat = x.transpose(2, 1).contiguous().view(B * N, C)
    # gather neighbor points
    feature = x_flat[idx, :].view(B, N, k, C)  # (B, N, k, C)
    x_expand = x.transpose(2, 1).view(B, N, 1, C).repeat(1, 1, k, 1)  # (B, N, k, C)
    # difference and original concatenated: (B, N, k, 2*C)
    feature = torch.cat((feature - x_expand, x_expand), dim=3)
    feature = feature.permute(0, 3, 1, 2).contiguous()  # (B, 2*C, N, k)
    return feature

class DGCNN(nn.Module):
    """
    Dynamic Graph CNN for point cloud classification.

    The network builds dynamic graphs on the fly using k‑nearest
    neighbors and applies a series of edge convolution layers to
    progressively build high‑level features.  A global max pooling
    aggregates features before classification via fully connected
    layers.

    Parameters
    ----------
    num_classes: int
        Number of output classes.
    k: int
        Number of neighbors for kNN graph construction.  The
        original DGCNN uses k=20 but smaller values work well for
        small clusters.
    emb_dims: int
        Size of the final embedding before the classifier.
    dropout: float
        Dropout probability applied before the final linear layer.
    """
    def __init__(self, num_classes: int = 7, k: int = 20, emb_dims: int = 1024, dropout: float = 0.5) -> None:
        super().__init__()
        self.k = k
        self.num_classes = num_classes
        # edge convolution layers
        self.conv1 = nn.Sequential(
            nn.Conv2d(6, 64, kernel_size=1, bias=False),
            nn.BatchNorm2d(64),
            nn.LeakyReLU(negative_slope=0.2)
        )
        self.conv2 = nn.Sequential(
            nn.Conv2d(128, 64, kernel_size=1, bias=False),
            nn.BatchNorm2d(64),
            nn.LeakyReLU(negative_slope=0.2)
        )
        self.conv3 = nn.Sequential(
            nn.Conv2d(128, 128, kernel_size=1, bias=False),
            nn.BatchNorm2d(128),
            nn.LeakyReLU(negative_slope=0.2)
        )
        self.conv4 = nn.Sequential(
            nn.Conv2d(256, 256, kernel_size=1, bias=False),
            nn.BatchNorm2d(256),
            nn.LeakyReLU(negative_slope=0.2)
        )
        # after concatenation of four layers, output channels = 64+64+128+256 = 512
        self.conv5 = nn.Sequential(
            nn.Conv1d(512, emb_dims, kernel_size=1, bias=False),
            nn.BatchNorm1d(emb_dims),
            nn.LeakyReLU(negative_slope=0.2)
        )
        # classifier
        self.linear1 = nn.Linear(emb_dims, 512, bias=False)
        self.bn1 = nn.BatchNorm1d(512)
        self.dp1 = nn.Dropout(p=dropout)
        self.linear2 = nn.Linear(512, 256)
        self.bn2 = nn.BatchNorm1d(256)
        self.dp2 = nn.Dropout(p=dropout)
        self.linear3 = nn.Linear(256, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Parameters
        ----------
        x: torch.Tensor
            Input tensor of shape ``(B, C, N)`` where ``C`` is
            typically 3 (xyz).  ``N`` should be a fixed number of
            points per sample.

        Returns
        -------
        torch.Tensor
            Class scores of shape ``(B, num_classes)``.
        """
        batch_size = x.size(0)
        x1 = self.conv1(get_graph_feature(x, self.k))
        x1 = x1.max(dim=-1, keepdim=False)[0]  # (B, 64, N)

        x2 = self.conv2(get_graph_feature(x1, self.k))
        x2 = x2.max(dim=-1, keepdim=False)[0]

        x3 = self.conv3(get_graph_feature(x2, self.k))
        x3 = x3.max(dim=-1, keepdim=False)[0]

        x4 = self.conv4(get_graph_feature(x3, self.k))
        x4 = x4.max(dim=-1, keepdim=False)[0]

        # concatenate features
        x_cat = torch.cat((x1, x2, x3, x4), dim=1)  # (B, 512, N)
        x_global = self.conv5(x_cat)  # (B, emb_dims, N)
        # global pooling
        x_pooled = F.adaptive_max_pool1d(x_global, 1).view(batch_size, -1)  # (B, emb_dims)

        x = F.leaky_relu(self.bn1(self.linear1(x_pooled)), negative_slope=0.2)
        x = self.dp1(x)
        x = F.leaky_relu(self.bn2(self.linear2(x)), negative_slope=0.2)
        x = self.dp2(x)
        x = self.linear3(x)  # (B, num_classes)
        return x

def load_model(checkpoint_path: Optional[str | Path] = None, device: Optional[str] = None) -> DGCNN:
    """Load a DGCNN model.

    Parameters
    ----------
    checkpoint_path: str or Path, optional
        Optional path to a saved model state dict.  If provided and
        the file exists, the model weights will be loaded.  If not
        provided or the file cannot be loaded, the model will be
        initialized randomly.
    device: str, optional
        Device string (e.g. "cpu" or "cuda").  If ``None`` is
        provided, the model will be placed on the default PyTorch
        device.

    Returns
    -------
    DGCNN
        The loaded model instance.
    """
    model = DGCNN()
    if device is None:
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = model.to(device)
    if checkpoint_path:
        cp = Path(checkpoint_path)
        if cp.is_file():
            try:
                state = torch.load(cp, map_location=device)
                # Some checkpoints may wrap the model in a dict with key 'model_state_dict'
                if isinstance(state, dict) and 'model_state_dict' in state:
                    state = state['model_state_dict']
                model.load_state_dict(state)
            except Exception:
                # Loading failed: silently ignore, user will train
                pass
    model.eval()
    return model

def _prepare_cluster(cluster: torch.Tensor, num_points: int) -> torch.Tensor:
    """Prepare a single cluster for inference.

    The DGCNN expects a fixed number of points per sample.  If the
    cluster has fewer than ``num_points`` points, the remaining points
    are filled by repeating existing ones.  If it has more, a
    random subset is chosen without replacement.
    """
    device = cluster.device
    num_cluster_points = cluster.shape[0]
    if num_cluster_points >= num_points:
        # randomly select without replacement
        idx = torch.randperm(num_cluster_points, device=device)[:num_points]
        prepared = cluster[idx]
    else:
        # repeat points to fill up
        repeat_times = math.ceil(num_points / num_cluster_points)
        prepared = cluster.repeat(repeat_times, 1)[:num_points]
    return prepared

def classify_clusters(model: DGCNN, clusters: List[torch.Tensor], device: Optional[str] = None) -> List[str]:
    """Classify a list of clusters using the provided DGCNN model.

    Parameters
    ----------
    model: DGCNN
        The DGCNN model returned by :func:`load_model`.
    clusters: List[torch.Tensor]
        List of point clusters, each of shape ``(N_i, 3)`` with xyz
        coordinates.  The number of points per cluster can vary.
    device: str, optional
        Device string.  If ``None``, uses the device of the model.

    Returns
    -------
    list of str
        List of predicted class names for each cluster.
    """
    if device is None:
        device = next(model.parameters()).device
    model.eval()
    num_points = 1024  # number of points per cluster for inference
    class_names = ['ground', 'vegetation', 'car', 'person', 'pole', 'wire', 'other']
    prepared_clusters = []
    for cluster in clusters:
        # ensure tensor on the right device
        if isinstance(cluster, torch.Tensor):
            cluster_tensor = cluster.to(device)
        else:
            cluster_tensor = torch.from_numpy(cluster).float().to(device)
        prepared = _prepare_cluster(cluster_tensor, num_points)
        prepared = prepared.unsqueeze(0).transpose(2, 1)  # (1, 3, num_points)
        prepared_clusters.append(prepared)
    if not prepared_clusters:
        return []
    batch = torch.cat(prepared_clusters, dim=0)  # (B, 3, num_points)
    with torch.no_grad():
        scores = model(batch)  # (B, num_classes)
        preds = scores.argmax(dim=1).tolist()
    return [class_names[p] for p in preds]