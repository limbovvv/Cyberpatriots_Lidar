import * as THREE from "three";
import { InternalBuffers } from "./types";

type CreateRenderHelpersArgs = {
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | undefined>;
  sceneRef: React.MutableRefObject<THREE.Scene | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  buffersRef: React.MutableRefObject<InternalBuffers | null>;
  dirtyColorIndicesRef: React.MutableRefObject<Set<number>>;
  colorAttrNeedsSyncRef: React.MutableRefObject<boolean>;
  setFrameTime: (ms: number) => void;
};

export function applyBaseColor(index: number, buffers: InternalBuffers, useSelectionColors = true) {
  const { colors, intensities, selections, status } = buffers;
  const base = intensities ? Math.max(intensities[index] / 255, 0.15) : 0.35;
  let r = base, g = base, b = base;

  if (status[index] === 1) {
    [r, g, b] = [0.2, 0.2, 0.2];
  }
  if (useSelectionColors && selections[index] !== 0) {
    const map: Record<number, [number, number, number]> = {
      0: [1, 1, 1],
      1: [1, 0.25, 0.25],
      2: [0.2, 1, 0.2],
    };
    [r, g, b] = map[selections[index]];
  }
  const offset = index * 3;
  colors[offset] = r; colors[offset + 1] = g; colors[offset + 2] = b;
}

export function createRenderHelpers({
  rendererRef,
  sceneRef,
  cameraRef,
  geometryRef,
  buffersRef,
  dirtyColorIndicesRef,
  colorAttrNeedsSyncRef,
  setFrameTime,
}: CreateRenderHelpersArgs) {
  const applyColorForIndex = (index: number, buffers: InternalBuffers) => applyBaseColor(index, buffers, true);

  const flushColorUpdates = () => {
    const buffers = buffersRef.current;
    if (!buffers) return;

    const dirty = dirtyColorIndicesRef.current;
    if (dirty.size === 0) return;

    dirty.forEach((idx) => {
      applyColorForIndex(idx, buffers);
    });
    dirty.clear();
    colorAttrNeedsSyncRef.current = true;
  };

  const renderScene = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    flushColorUpdates();

    if (colorAttrNeedsSyncRef.current) {
      const colorAttr = geometryRef.current?.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (colorAttr) {
        colorAttr.needsUpdate = true;
      }
      colorAttrNeedsSyncRef.current = false;
    }

    const start = performance.now();
    renderer.render(scene, camera);
    setFrameTime(performance.now() - start);
  };

  const renderPendingRef = { current: false } as React.MutableRefObject<boolean>;
  const scheduleRender = () => {
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    requestAnimationFrame(() => {
      renderPendingRef.current = false;
      renderScene();
    });
  };

  const markColorDirty = (index: number) => {
    dirtyColorIndicesRef.current.add(index);
  };

  return { renderScene, scheduleRender, markColorDirty, flushColorUpdates };
}
