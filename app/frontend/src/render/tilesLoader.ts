import * as THREE from "three";
import type { Dataset, Tile } from "../types/api";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { InternalBuffers } from "./types";
import { tryInitializeCameraPose } from "./cameraInit";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const MAGIC = 0x50544344;

export function parseTile(
  buffer: ArrayBuffer,
  tile: Tile,
  buffers: InternalBuffers,
  boundingBox: THREE.Box3
) {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Unexpected tile magic 0x${magic.toString(16)}`);
  }
  const count = view.getUint32(6, true);
  let offset = 10;

  const { positions, colors, status, selections, intensities, lodIndex } = buffers;

  const tempVec = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    const r = view.getUint8(offset + 12);
    const g = view.getUint8(offset + 13);
    const b = view.getUint8(offset + 14);
    const intensity = view.getUint8(offset + 15);
    offset += 16;

    const globalIndex = tile.base_index + i;
    const posOffset = globalIndex * 3;
    positions[posOffset] = x;
    positions[posOffset + 1] = y;
    positions[posOffset + 2] = z;

    const baseColor = intensities
      ? intensity > 0
        ? intensity / 255
        : Math.max(Math.max(r, g, b) / 255, 0.35)
      : Math.max(Math.max(r, g, b) / 255, 0.35);
    colors[posOffset] = baseColor;
    colors[posOffset + 1] = baseColor;
    colors[posOffset + 2] = baseColor;

    if (intensities) {
      intensities[globalIndex] = intensity;
    }
    status[globalIndex] = 0;
    selections[globalIndex] = 0;
    if (lodIndex) {
      lodIndex[globalIndex] = globalIndex;
    }

    tempVec.set(x, y, z);
    boundingBox.expandByPoint(tempVec);
  }
}

export function fitCameraToBounds(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3
) {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z, 1);
  const distance = maxSize * 1.8;

  camera.position.set(center.x + distance, center.y + distance, center.z + distance);
  camera.near = Math.max(0.05, distance / 500);
  const baseFar = distance * 15;
  (camera as any).userData = (camera as any).userData || {};
  (camera as any).userData.baseFar = baseFar;
  const farMul = (window as any)?.__pcd_tool_options__?.cameraFarMultiplier ?? 1;
  camera.far = baseFar * (Number.isFinite(farMul) && farMul > 0 ? farMul : 1);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

type LoadTilesArgs = {
  dataset: Dataset;
  tiles: Tile[];
  buffersRef: React.MutableRefObject<InternalBuffers | null>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  controlsRef: React.MutableRefObject<OrbitControls | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  tilesSignatureRef: React.MutableRefObject<string>;
  setLoadedPointCount: (n: number) => void;
  poseInitializedRef?: React.MutableRefObject<boolean>;
  scheduleRender?: () => void;
};

export function loadTilesEffect({
  dataset,
  tiles,
  buffersRef,
  geometryRef,
  controlsRef,
  cameraRef,
  tilesSignatureRef,
  setLoadedPointCount,
  poseInitializedRef,
  scheduleRender,
}: LoadTilesArgs) {
  if (!dataset || tiles.length === 0 || !buffersRef.current || !geometryRef.current) return () => {};

  const signature = tiles.map((tile) => tile.id).join("|");
  if (signature === tilesSignatureRef.current) {
    return () => {};
  }
  tilesSignatureRef.current = signature;

  let cancelled = false;
  const positionAttr = geometryRef.current.getAttribute("position") as THREE.BufferAttribute;
  const colorAttr = geometryRef.current.getAttribute("color") as THREE.BufferAttribute;
  const aIndexAttr = geometryRef.current.getAttribute("aIndex") as THREE.BufferAttribute | undefined;
  const controls = controlsRef.current;
  const camera = cameraRef.current;

  const buffers = buffersRef.current!;
  buffers.status.fill(0);
  buffers.selections.fill(0);

  const boundingBox = new THREE.Box3();
  let totalLoaded = 0;
  let lastSetCount = -1;

  // Prepare contiguous draw-range computation
  const sortedTiles = [...tiles].sort((a, b) => a.base_index - b.base_index);
  const indexById = new Map(sortedTiles.map((t, i) => [t.id, i] as const));
  const loadedFlags = new Array(sortedTiles.length).fill(false) as boolean[];
  let headIdx = 0; // first not-yet-loaded tile in sorted order

  const updateDrawRangeForContiguousPrefix = () => {
    while (headIdx < sortedTiles.length && loadedFlags[headIdx]) headIdx += 1;
    const contiguousCount = headIdx < sortedTiles.length ? sortedTiles[headIdx].base_index : dataset.points_total;
    geometryRef.current!.setDrawRange(0, contiguousCount);
  };

  // Parallel fetch with a small concurrency limit
  const CONCURRENCY = Math.min(8, (typeof navigator !== "undefined" && (navigator as any).hardwareConcurrency) || 4);
  let startIdx = 0;
  const controllers: AbortController[] = [];

  const runOne = async (tile: Tile) => {
    try {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const response = await fetch(
        `${API_BASE}/datasets/${dataset.id}/tiles/${tile.z}/${tile.x}/${tile.y}`,
        { signal: ctrl.signal }
      );
      if (!response.ok) throw new Error(`Failed to load tile ${tile.id}`);
      const buffer = await response.arrayBuffer();
      if (cancelled) return;

      parseTile(buffer, tile, buffers, boundingBox);

      // Upload only the subrange for this tile to the GPU
      const compOffset = tile.base_index * 3;
      const compCount = tile.points * 3;
      const addRange = (attr: THREE.BufferAttribute, offset: number, count: number) => {
        const anyAttr = attr as any;
        if (typeof anyAttr.addUpdateRange === "function") {
          anyAttr.addUpdateRange(offset, count);
        } else {
          // fallback for older three versions
          attr.updateRange.offset = offset;
          attr.updateRange.count = count;
        }
        attr.needsUpdate = true;
      };
      addRange(positionAttr, compOffset, compCount);
      addRange(colorAttr, compOffset, compCount);
      if (aIndexAttr) {
        const offset = tile.base_index;
        const count = tile.points;
        addRange(aIndexAttr, offset, count);
      }

      totalLoaded += tile.points;
      if (totalLoaded !== lastSetCount) {
        setLoadedPointCount(totalLoaded);
        lastSetCount = totalLoaded;
      }

      // Try to initialize camera pose once we have enough data
      if (poseInitializedRef && !poseInitializedRef.current) {
        tryInitializeCameraPose({
          buffersRef,
          geometryRef,
          cameraRef,
          controlsRef,
          poseInitializedRef,
          scheduleRender,
        });
      }

      // Mark tile as loaded and update contiguous draw range
      const idx = indexById.get(tile.id);
      if (idx !== undefined) {
        loadedFlags[idx] = true;
        updateDrawRangeForContiguousPrefix();
      }
    } catch (error) {
      if (!cancelled) console.error("tile.load.error", tile, error);
    }
  };

  const worker = async () => {
    for (;;) {
      if (cancelled) break;
      const myIdx = startIdx++;
      if (myIdx >= tiles.length) break;
      await runOne(tiles[myIdx]);
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  Promise.all(workers).then(() => {
    if (!cancelled && camera && controls && totalLoaded > 0) {
      // If custom pose not set, fall back to bounding box fit
      if (!(poseInitializedRef && poseInitializedRef.current)) {
        fitCameraToBounds(camera, controls, boundingBox);
      }
    }
  });

  return () => {
    cancelled = true;
    controllers.forEach((c) => {
      try {
        c.abort();
      } catch {}
    });
  };
}
