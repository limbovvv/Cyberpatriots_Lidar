import * as THREE from "three";
import { InternalBuffers, TOOL_CODE, Tool, MAX_INDICES_PER_OP } from "./types";
import { applyBaseColor } from "./rendering";

// --- helper: normalize any ref.current to Set<T> (protects against HMR / serialization) ---
function normalizeSetRef<T>(ref: React.MutableRefObject<any>): React.MutableRefObject<Set<T>> {
  if (!(ref.current instanceof Set)) {
    if (Array.isArray(ref.current)) {
      ref.current = new Set<T>(ref.current as T[]);
    } else if (ref.current && typeof ref.current[Symbol.iterator] === "function") {
      ref.current = new Set<T>(Array.from(ref.current as Iterable<T>));
    } else {
      ref.current = new Set<T>();
    }
    console.warn("normalizeSetRef: ref.current was not a Set, fixed");
  }
  return ref as React.MutableRefObject<Set<T>>;
}

type SetupBrushArgs = {
  session: { id: string } | undefined;
  tool: Tool;
  brushRadius: number;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  controlsRef: React.MutableRefObject<any>;
  pointsRef: React.MutableRefObject<THREE.Points | undefined>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  raycasterRef: React.MutableRefObject<THREE.Raycaster>;
  rotateActiveRef: React.MutableRefObject<boolean>;
  buffersRef: React.MutableRefObject<InternalBuffers | null>;
  setSelectedForDelete: (n: number) => void;
  setSelectedForRestore: (n: number) => void;
  scheduleRender: () => void;
  brushCursorRef: React.MutableRefObject<THREE.Group | null>;
};

export function setupBrushInteractions({
  session,
  tool,
  brushRadius,
  rendererRef,
  cameraRef,
  controlsRef,
  pointsRef,
  geometryRef,
  raycasterRef,
  rotateActiveRef,
  buffersRef,
  setSelectedForDelete,
  setSelectedForRestore,
  scheduleRender,
  brushCursorRef,
}: SetupBrushArgs) {
  console.log("tools.setup", { hasSession: !!session, tool, brushRadius });

  const renderer = rendererRef.current;
  const camera = cameraRef.current;
  const points = pointsRef.current;
  const container = renderer?.domElement;
  if (!renderer || !camera || !points || !container) return () => {};

  // pull pending sets from window and normalize them to Set
  const pendingDeleteRefWin = (window as any).__pcd_pending_delete__ as React.MutableRefObject<any>;
  const pendingRestoreRefWin = (window as any).__pcd_pending_restore__ as React.MutableRefObject<any>;
  const pendingDeleteRef = normalizeSetRef<number>(pendingDeleteRefWin);
  const pendingRestoreRef = normalizeSetRef<number>(pendingRestoreRefWin);

  let selectionDirty = false;
  let brushActive = false;
  let activePointerId: number | null = null;

  const baseNormal = new THREE.Vector3(0, 0, 1);
  const cameraNormal = new THREE.Vector3();
  const brushQuaternion = new THREE.Quaternion();

  const hideBrushCursor = () => {
    const r = brushCursorRef.current;
    if (r && r.visible) {
      r.visible = false;
      scheduleRender();
    }
  };

  const updateBrushCursorFromIntersections = (
    intersections: Array<THREE.Intersection<THREE.Object3D>>
  ) => {
    const r = brushCursorRef.current;
    if (!r) return;

    if (intersections.length > 0) {
      const hit = intersections[0];
      if (hit && (hit as any).point) {
        const hitPoint = (hit as any).point as THREE.Vector3;
        r.position.copy(hitPoint);

        cameraNormal.copy(camera.position).sub(hitPoint);
        if (cameraNormal.lengthSq() === 0) {
          hideBrushCursor();
          return;
        }
        cameraNormal.normalize();
        if (!Number.isFinite(cameraNormal.x) || !Number.isFinite(cameraNormal.y) || !Number.isFinite(cameraNormal.z)) {
          hideBrushCursor();
          return;
        }
        brushQuaternion.setFromUnitVectors(baseNormal, cameraNormal);
        r.quaternion.copy(brushQuaternion);
        r.visible = true;
        scheduleRender();
      } else {
        hideBrushCursor();
      }
    } else {
      hideBrushCursor();
    }
  };

  const performRaycast = (event: PointerEvent) => {
    if (!session) {
      hideBrushCursor();
      return [] as THREE.Intersection<THREE.Object3D>[];
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // sync matrices / bounds / layers before raycast
    try {
      camera.updateMatrixWorld(true);
      points.updateMatrixWorld(true);
      const g = geometryRef.current;
      if (g && (!g.boundingSphere || g.boundingSphere.radius === 0)) {
        g.computeBoundingSphere();
        console.log("geom.boundingSphere.fix", g.boundingSphere);
      }
      // align layers (common source of no-hits)
      // @ts-ignore
      (raycasterRef.current.layers as any).mask = points.layers.mask;
    } catch {}

    console.time("raycast");
    // Adapt threshold by camera distance to target (improves UX across scales)
    const controls = controlsRef.current;
    const dist = controls?.target ? camera.position.distanceTo(controls.target) : camera.position.length();
    const scale = Math.max(0.5, Math.min(2, dist / 50));
    raycasterRef.current.params.Points.threshold = Math.max(brushRadius * scale, 0.0001);
    console.log("raycast.params", {
      threshold: raycasterRef.current.params.Points.threshold,
      layers: (raycasterRef.current.layers as any).mask,
      visible: (points as any).visible,
    });

    raycasterRef.current.setFromCamera(mouse, camera);

    const intersections = raycasterRef.current.intersectObject(
      points,
      false
    ) as Array<THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>>;

    console.timeEnd("raycast");

    if (!(window as any).__once_geom_dump__) {
      (window as any).__once_geom_dump__ = 1;
      const g = geometryRef.current as any;
      console.log("geom.dump", {
        drawRange: g?.getDrawRange?.() ?? g?.drawRange,
        posCount: g?.attributes?.position?.count,
        sphere: g?.boundingSphere && { r: g.boundingSphere.radius, c: g.boundingSphere.center?.toArray?.() },
      });
    }

    console.log("raycast.hits", { hits: intersections.length });
    if (intersections.length === 0) console.warn("raycast: no hits");

    updateBrushCursorFromIntersections(intersections);
    return intersections;
  };

  const colorPoint = (index: number, buffers: InternalBuffers) => applyBaseColor(index, buffers, true);

  const updateSelection = (index: number, toolCode: number | undefined, buffers: InternalBuffers) => {
    const { selections } = buffers;
    if (toolCode === undefined) return;
    if (index < 0 || index >= selections.length) return;

    if (toolCode === TOOL_CODE.delete) {
      pendingRestoreRef.current.delete(index);
      pendingDeleteRef.current.add(index);
      selections[index] = TOOL_CODE.delete;
    } else if (toolCode === TOOL_CODE.restore) {
      pendingDeleteRef.current.delete(index);
      pendingRestoreRef.current.add(index);
      selections[index] = TOOL_CODE.restore;
    }
  };

  const applyBrush = (
    intersections: Array<THREE.Intersection<THREE.Object3D<THREE.Object3DEventMap>>>,
    activeTool: Tool
  ) => {
    console.time("applyBrush");
    console.log("applyBrush.before", { tool: activeTool, intersections: intersections.length });

    const buffers = buffersRef.current;
    if (!buffers || intersections.length === 0) {
      console.timeEnd("applyBrush");
      console.log("applyBrush.done", {
        changedCount: 0,
        pendingDelete: pendingDeleteRef?.current?.size ?? 0,
        pendingRestore: pendingRestoreRef?.current?.size ?? 0,
      });
      return;
    }

    const indices = new Set<number>();
    intersections.forEach((intersection) => {
      if (typeof intersection.index === "number") indices.add(intersection.index);
    });
    if (indices.size === 0) {
      console.timeEnd("applyBrush");
      console.log("applyBrush.done", { changedCount: 0, pendingDelete: pendingDeleteRef?.current?.size ?? 0, pendingRestore: pendingRestoreRef?.current?.size ?? 0 });
      return;
    }

    const toolCode = TOOL_CODE[activeTool];
    if (toolCode === undefined) {
      console.timeEnd("applyBrush");
      console.log("applyBrush.skip", { tool: activeTool });
      return;
    }
    indices.forEach((index) => {
      updateSelection(index, toolCode, buffers);
      colorPoint(index, buffers);
    });

    setSelectedForDelete(pendingDeleteRef.current.size);
    setSelectedForRestore(pendingRestoreRef.current.size);

    const colorAttr = geometryRef.current?.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (colorAttr) colorAttr.needsUpdate = true;

    console.timeEnd("applyBrush");
    console.log("applyBrush.done", {
      changedCount: indices.size,
      pendingDelete: pendingDeleteRef.current.size,
      pendingRestore: pendingRestoreRef.current.size,
    });
  };

  const finishBrush = (event?: PointerEvent) => {
    console.log("brush.finish");
    if (!brushActive) return;
    brushActive = false;
    const pointerId = event?.pointerId ?? activePointerId;
    if (pointerId !== null) {
      try { container.releasePointerCapture(pointerId); } catch {}
    }
    activePointerId = null;
    window.dispatchEvent(new Event("pcd-brush-end"));
    console.groupEnd();
  };

  const handlePointerDown = (event: PointerEvent) => {
    console.log("pointer.down", { button: event.button, shift: event.shiftKey, tool, hasSession: !!session });

    if (!session || tool === "ml") { hideBrushCursor(); return; }
    if (event.button !== 0) { hideBrushCursor(); return; }
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) { hideBrushCursor(); return; }

    const intersections = performRaycast(event);

    container.setPointerCapture(event.pointerId);
    activePointerId = event.pointerId;

    if (!brushActive) {
      console.groupCollapsed("brush.start");
      console.log("brush.start", { tool, pointerId: event.pointerId });
      brushActive = true;
      window.dispatchEvent(new Event("pcd-brush-start"));
    }

    applyBrush(intersections, tool);
    selectionDirty = true;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!session || tool === "ml") { hideBrushCursor(); return; }

    if (event.buttons !== 1 && !brushActive) {
      const intersections = performRaycast(event);
      if (intersections.length === 0) hideBrushCursor();
      return;
    }

    const intersections = performRaycast(event);
    if (selectionDirty && event.buttons === 1) applyBrush(intersections, tool);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (selectionDirty) selectionDirty = false;
    finishBrush(event);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    selectionDirty = false;
    hideBrushCursor();
    finishBrush(event);
  };

  const handlePointerLeave = (event: PointerEvent) => {
    selectionDirty = false;
    hideBrushCursor();
    finishBrush(event);
  };

  if (tool === "ml") {
    hideBrushCursor();
    return () => {};
  }

  container.addEventListener("pointerdown", handlePointerDown);
  container.addEventListener("pointermove", handlePointerMove);
  container.addEventListener("pointerup", handlePointerUp);
  container.addEventListener("pointercancel", handlePointerCancel);
  container.addEventListener("pointerleave", handlePointerLeave);

  return () => {
    container.removeEventListener("pointerdown", handlePointerDown);
    container.removeEventListener("pointermove", handlePointerMove);
    container.removeEventListener("pointerup", handlePointerUp);
    container.removeEventListener("pointercancel", handlePointerCancel);
    container.removeEventListener("pointerleave", handlePointerLeave);
  };
}

// --- safe resetSelection (не падает, если геометрия/буферы ещё не готовы)
export function resetSelection(
  buffersRef: React.MutableRefObject<InternalBuffers | null>,
  pendingDeleteRefIn: React.MutableRefObject<Set<number> | any>,
  pendingRestoreRefIn: React.MutableRefObject<Set<number> | any>,
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>,
  setSelectedForDelete: (n: number) => void,
  setSelectedForRestore: (n: number) => void
) {
  const pendingDeleteRef = normalizeSetRef<number>(pendingDeleteRefIn);
  const pendingRestoreRef = normalizeSetRef<number>(pendingRestoreRefIn);

  console.log("selection.reset", {
    beforeDelete: pendingDeleteRef.current.size,
    beforeRestore: pendingRestoreRef.current.size,
  });

  const buffers = buffersRef.current;
  const geom: any = geometryRef.current;

  const clearSetsAndCounters = () => {
    pendingDeleteRef.current.clear();
    pendingRestoreRef.current.clear();
    setSelectedForDelete(0);
    setSelectedForRestore(0);
  };

  if (!buffers) {
    console.warn("resetSelection: buffers not ready; clearing sets only");
    clearSetsAndCounters();
    return;
  }

  const rebaseColor = (idx: number) => {
    const base = buffers.intensities ? Math.max(buffers.intensities[idx] / 255, 0.15) : 0.35;
    const o = idx * 3;
    buffers.colors[o] = base; buffers.colors[o + 1] = base; buffers.colors[o + 2] = base;
    buffers.selections[idx] = 0;
  };

  pendingDeleteRef.current.forEach(rebaseColor);
  pendingRestoreRef.current.forEach(rebaseColor);

  clearSetsAndCounters();

  if (geom && typeof geom.getAttribute === "function") {
    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (colorAttr) colorAttr.needsUpdate = true;
  } else {
    console.warn("resetSelection: geometry not ready or invalid; skip colorAttr.needsUpdate", { geom });
  }
}

// --- компактация: реально удаляем все status===1 из геометрии и буферов
function compactBuffersAfterApply(
  buffersRef: React.MutableRefObject<InternalBuffers | null>,
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>
): number {
  const buffers = buffersRef.current;
  const geom = geometryRef.current;
  if (!buffers || !geom) {
    console.warn("compact: buffers/geometry not ready");
    return 0;
  }

  const N = buffers.positions.length / 3;
  const keepIdx: number[] = [];
  keepIdx.reserve ? (keepIdx as any).reserve(N) : null; // hint for V8 (optional)
  for (let i = 0; i < N; i++) if (buffers.status[i] === 0) keepIdx.push(i);

  const newCount = keepIdx.length;
  if (newCount === N) {
    console.log("compact: nothing to remove");
    return 0;
  }

  console.time("compact.copy");

  const newPos = new Float32Array(newCount * 3);
  const newCol = new Float32Array(newCount * 3);
  const newStatus = new Uint8Array(newCount);
  const newSel = new Uint8Array(newCount);
  const hasInt = !!buffers.intensities;
  const newInt = hasInt ? new Float32Array(newCount) : undefined;
  const hasLod = (buffers as any).lodIndex instanceof Float32Array;
  const newLod = hasLod ? new Float32Array(newCount) : undefined;

  let j = 0;
  for (let k = 0; k < keepIdx.length; k++) {
    const i = keepIdx[k];
    const offS = i * 3;
    const offD = j * 3;
    newPos[offD] = buffers.positions[offS];
    newPos[offD + 1] = buffers.positions[offS + 1];
    newPos[offD + 2] = buffers.positions[offS + 2];

    newCol[offD] = buffers.colors[offS];
    newCol[offD + 1] = buffers.colors[offS + 1];
    newCol[offD + 2] = buffers.colors[offS + 2];

    newStatus[j] = 0;
    newSel[j] = 0;

    if (hasInt && newInt) newInt[j] = (buffers.intensities as Float32Array)[i];
    if (hasLod && newLod) newLod[j] = j; // простой пересчёт LOD-индекса

    j++;
  }

  console.timeEnd("compact.copy");

  // обновляем refs (в одно место)
  (buffersRef as any).current = {
    positions: newPos,
    colors: newCol,
    status: newStatus,
    selections: newSel,
    intensities: newInt,
    lodIndex: newLod,
  } as InternalBuffers;

  // обновляем геометрию
  geom.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(newCol, 3));
  geom.setDrawRange(0, newCount);
  geom.computeBoundingSphere();

  // помечаем dirty
  (geom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  (geom.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

  console.log("compact: removed", N - newCount, "points; newCount =", newCount);
  return N - newCount;
}

export async function applySelection(
  dataset: any, // kept for signature compatibility
  session: { id: string } | undefined,
  sessionRef: React.MutableRefObject<any>,
  appendOps: AppendOpsFn,
  sessionVersionRef: React.MutableRefObject<number>,
  buffersRef: React.MutableRefObject<InternalBuffers | null>,
  pendingDeleteRefIn: React.MutableRefObject<Set<number> | any>,
  pendingRestoreRefIn: React.MutableRefObject<Set<number> | any>,
  deletedSetRef: React.MutableRefObject<Set<number>>,
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>,
  setSelectedForDelete: (n: number) => void,
  setSelectedForRestore: (n: number) => void
) {
  const pendingDeleteRef = normalizeSetRef<number>(pendingDeleteRefIn);
  const pendingRestoreRef = normalizeSetRef<number>(pendingRestoreRefIn);

  if (!session || (pendingDeleteRef.current.size === 0 && pendingRestoreRef.current.size === 0)) return;

  const ops: Array<{ action: string; indices: number[] }> = [];
  if (pendingDeleteRef.current.size > 0) {
    ops.push({ action: "delete", indices: Array.from(pendingDeleteRef.current) });
  }
  if (pendingRestoreRef.current.size > 0) {
    ops.push({ action: "restore", indices: Array.from(pendingRestoreRef.current) });
  }

  console.log("applySelection.submit", { delete: pendingDeleteRef.current.size, restore: pendingRestoreRef.current.size });

  try {
    let currentVersion = sessionVersionRef.current;

    for (const op of ops) {
      for (let i = 0; i < op.indices.length; i += MAX_INDICES_PER_OP) {
        const chunk = op.indices.slice(i, i + MAX_INDICES_PER_OP);

        await appendOps({
          sessionId: session.id,
          baseVersion: currentVersion,
          ops: [{ action: op.action, indices: chunk }],
        });

        currentVersion += 1;
        sessionVersionRef.current = currentVersion;
      }
    }

    const buffers = buffersRef.current;
    if (buffers) {
      if (pendingDeleteRef.current.size > 0) {
        pendingDeleteRef.current.forEach((idx) => {
          deletedSetRef.current.add(idx);
          buffers.status[idx] = 1; // deleted
          buffers.selections[idx] = 0;
          const o = idx * 3;
          buffers.colors[o] = 0.2; buffers.colors[o + 1] = 0.2; buffers.colors[o + 2] = 0.2;
        });
      }

      if (pendingRestoreRef.current.size > 0) {
        pendingRestoreRef.current.forEach((idx) => {
          deletedSetRef.current.delete(idx);
          buffers.status[idx] = 0; // alive
          buffers.selections[idx] = 0;
          const base = buffers.intensities ? Math.max(buffers.intensities[idx] / 255, 0.15) : 0.35;
          const o = idx * 3;
          buffers.colors[o] = base; buffers.colors[o + 1] = base; buffers.colors[o + 2] = base;
        });
      }
    }

    // очистка выделений и UI-счётчиков
    pendingDeleteRef.current.clear();
    pendingRestoreRef.current.clear();
    setSelectedForDelete(0);
    setSelectedForRestore(0);

    // прокинем изменения в GPU
    const colorAttr = geometryRef.current?.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (colorAttr) colorAttr.needsUpdate = true;

    // 🔥 ДОПОЛНИТЕЛЬНО: физически удаляем точки из геометрии (меняется drawRange/буфера)
    const removed = compactBuffersAfterApply(buffersRef, geometryRef);
    if (removed > 0) {
      // уведомим остальной UI (если нужно обновить счётчики) — можно слушать это событие снаружи
      window.dispatchEvent(new CustomEvent("pcd-geometry-compacted", { detail: { removed } }));
    }

    console.log("applySelection.ok", { newVersion: sessionVersionRef.current });
  } catch (error) {
    console.error("apply.selection.error", error);
  }
}

type AppendOpsFn = (req: {
  sessionId: string;
  baseVersion: number;
  ops: Array<{ action: string; indices: number[] }>;
}) => Promise<void>;
