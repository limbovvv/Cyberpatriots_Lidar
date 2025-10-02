"""Heuristic rules for segmenting and labeling LiDAR point clouds.

This module contains a collection of geometry‑based segmentation
functions and simple heuristics that can be used to identify and label
objects in a LiDAR point cloud without relying on machine learning.

The functions operate on Open3D ``PointCloud`` objects and return
NumPy arrays or lists of point indices.  They can be combined with
``ml.inference_pointnet`` to form a hybrid pipeline.
"""

from __future__ import annotations

from typing import Iterable, List, Tuple, Dict, Sequence

import numpy as np
import open3d as o3d


def segment_ground(
    pcd: o3d.geometry.PointCloud,
    distance_threshold: float = 0.2,
    ransac_n: int = 3,
    num_iterations: int = 1000,
) -> np.ndarray:
    """Segment ground points using RANSAC plane fitting.

    Parameters
    ----------
    pcd: open3d.geometry.PointCloud
        Input point cloud.
    distance_threshold: float
        Maximum distance from the plane for a point to be considered inlier.
    ransac_n: int
        Number of points to sample for each RANSAC iteration.
    num_iterations: int
        Number of RANSAC iterations.

    Returns
    -------
    numpy.ndarray of shape (num_points,)
        Boolean mask where ``True`` indicates a ground point.
    """
    plane_model, inliers = pcd.segment_plane(
        distance_threshold=distance_threshold,
        ransac_n=ransac_n,
        num_iterations=num_iterations,
    )
    mask = np.zeros(len(pcd.points), dtype=bool)
    mask[inliers] = True
    return mask


def cluster_points(
    pcd: o3d.geometry.PointCloud,
    eps: float = 0.5,
    min_points: int = 30,
) -> List[np.ndarray]:
    """Cluster non‑ground points using DBSCAN.

    Parameters
    ----------
    pcd: open3d.geometry.PointCloud
        Input point cloud (should be prefiltered to exclude ground).
    eps: float
        Radius for neighbourhood search in metres.
    min_points: int
        Minimum number of points to form a cluster.

    Returns
    -------
    list of numpy.ndarray
        List of arrays of point indices for each cluster.  Noise
        points (cluster id == -1) are ignored.
    """
    labels = np.array(
        pcd.cluster_dbscan(eps=eps, min_points=min_points, print_progress=False)
    )
    clusters: List[np.ndarray] = []
    for label in np.unique(labels):
        if label == -1:
            continue  # noise
        idx = np.where(labels == label)[0]
        clusters.append(idx)
    return clusters


def heuristic_labels(
    pcd: o3d.geometry.PointCloud,
    clusters: Sequence[np.ndarray],
    ground_mask: np.ndarray | None = None,
) -> Dict[int, str]:
    """Assign heuristic labels to clusters based on simple geometric cues.

    Parameters
    ----------
    pcd: open3d.geometry.PointCloud
        The input point cloud containing all points.
    clusters: sequence of numpy.ndarray
        A sequence of arrays of point indices for each cluster.
    ground_mask: numpy.ndarray or None
        Optional mask indicating ground points.  Points in clusters that
        intersect the ground mask will not be labelled as standalone objects.

    Returns
    -------
    dict[int, str]
        A mapping from cluster index (0‑based) to a heuristic class
        name.  Possible class names include ``"pole"``, ``"wire"``,
        ``"vegetation"``, and ``"other"``.  Unlabelled clusters
        default to ``"other"``.
    """
    points = np.asarray(pcd.points)
    labels: Dict[int, str] = {}
    for i, idx in enumerate(clusters):
        cluster_points = points[idx]
        # Compute bounding box extents
        min_bounds = cluster_points.min(axis=0)
        max_bounds = cluster_points.max(axis=0)
        extent = max_bounds - min_bounds
        # Height above ground
        if ground_mask is not None:
            # Height relative to ground plane approximated by minimum z of cluster
            height = cluster_points[:, 2].max() - cluster_points[:, 2].min()
        else:
            height = extent[2]
        # Slender vertical shapes likely poles
        slender = (extent[2] > 2.0) and (max(extent[0], extent[1]) < 0.3)
        # Very thin elongated shapes with large horizontal extent likely wires
        wire = (extent[2] < 0.2) and (max(extent[0], extent[1]) > 5.0)
        # Cluster roughness: use eigenvalues of covariance matrix
        cov = np.cov(cluster_points.T)
        eigvals, _ = np.linalg.eigh(cov)
        roughness = eigvals[0] / eigvals.sum() if eigvals.sum() > 0 else 0
        # Vegetation tends to have high roughness and moderate height
        vegetation = (height > 1.0) and (roughness > 0.3)
        if wire:
            labels[i] = "wire"
        elif slender:
            labels[i] = "pole"
        elif vegetation:
            labels[i] = "vegetation"
        else:
            labels[i] = "other"
    return labels
