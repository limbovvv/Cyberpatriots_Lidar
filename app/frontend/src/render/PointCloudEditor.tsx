import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import type { Dataset, Session, Tile } from "../types/api";
import { RenderStats } from "../components/RenderStats";
import { createRenderHelpers } from "./rendering";
import { setupThreeSceneAndControls } from "./cameraControls";
import { loadTilesEffect } from "./tilesLoader";
import { InternalBuffers, Tool, SELECTION_COLOR, DELETED_COLOR, MAX_INDICES_PER_OP } from "./types";
import { setupBrushInteractions, resetSelection as toolsResetSelection, applySelection as toolsApplySelection } from "./tools";
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

type AppendOpsFn = (payload: {
  sessionId: string;
  baseVersion: number;
  ops: Array<{ action: string; indices: number[] }>;
}) => Promise<void>;

type ExportFn = () => Promise<void>;

interface PointCloudEditorProps {
  dataset: Dataset;
  tiles: Tile[];
  session: Session | undefined;
  onCreateSession: () => Promise<void>;
  appendOps: AppendOpsFn;
  isAppending: boolean;
  exportDataset: ExportFn;
  isExporting: boolean;
  tool?: Tool;
  onChangeTool?: (tool: Tool) => void;
  mlOverlayIndices?: number[];
  mlOverlayVisible?: boolean;
  onResetSelection?: () => void;
}

// constants/types moved to ./types

export function PointCloudEditor({
  dataset,
  tiles,
  session,
  onCreateSession,
  appendOps,
  isAppending,
  exportDataset,
  isExporting,
  tool: externalTool,
  onChangeTool,
  mlOverlayIndices,
  mlOverlayVisible,
  onResetSelection,
}: PointCloudEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<OrbitControls>();
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointsRef = useRef<THREE.Points>();
  const buffersRef = useRef<InternalBuffers | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry>();
  const brushCursorRef = useRef<THREE.Group | null>(null);
  // controls/threshold logic handled centrally in cameraControls + tools


  const selectionDirtyRef = useRef(false);
  const sessionRef = useRef<Session | undefined>(session);
  const renderPendingRef = useRef(false);
  const dirtyColorIndicesRef = useRef<Set<number>>(new Set());
  const colorAttrNeedsSyncRef = useRef(false);
  const [loadedPointCount, setLoadedPointCount] = useState(0);
  const [selectedForDelete, setSelectedForDelete] = useState(0);
  const [selectedForRestore, setSelectedForRestore] = useState(0);
  const [tool, setTool] = useState<Tool>("delete");
  const [brushRadius, setBrushRadius] = useState(0.5);
  const [pointSize, setPointSize] = useState(0.4);
  // если снаружи передан инструмент — синхронизируем
  useEffect(() => {
    if (externalTool && externalTool !== tool) {
      setTool(externalTool);
    }
  }, [externalTool]);
  const POINT_SIZE_MIN = 0.01;
  const POINT_SIZE_MAX = 5;
  const POINT_SIZE_STEP = 0.005;
  const [pixelStep, setPixelStep] = useState(1);
  const [cameraFarMultiplier, setCameraFarMultiplier] = useState(1);
  const PIXEL_STEP_MIN = 1;
  const PIXEL_STEP_MAX = 16;
  const [frameTime, setFrameTime] = useState(0);
  const deletedSetRef = useRef<Set<number>>(new Set());
  const pendingDeleteRef = useRef<Set<number>>(new Set());
  const pendingRestoreRef = useRef<Set<number>>(new Set());
  const sessionVersionRef = useRef(0);
  const tilesSignatureRef = useRef<string>("");
  const rotateActiveRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const lookDistanceRef = useRef(10);

  const { renderScene, scheduleRender, markColorDirty } = useMemo(() =>
    createRenderHelpers({
      rendererRef,
      sceneRef,
      cameraRef,
      geometryRef,
      buffersRef,
      dirtyColorIndicesRef,
      colorAttrNeedsSyncRef,
      setFrameTime,
    })
  , []);

  const activeTool: Tool = externalTool ?? tool;

  const totalPoints = useMemo(() => dataset.points_total ?? 0, [dataset.points_total]);

  useEffect(() => {
    sessionVersionRef.current = session?.version ?? 0;
  }, [session?.id, session?.version]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    // expose session state for cameraControls without prop drilling
    (window as any).__pcd_session_active__ = Boolean(sessionRef.current);
    const cleanup = setupThreeSceneAndControls({
      containerRef,
      rendererRef,
      sceneRef,
      cameraRef,
      controlsRef: controlsRef as React.MutableRefObject<OrbitControls | undefined>,
      geometryRef,
      pointsRef,
      scheduleRender,
      rotateActiveRef,
      lastPointerRef,
      yawRef,
      pitchRef,
      lookDistanceRef,
      brushCursorRef,
    });
    return cleanup;
  }, [scheduleRender]);
  // OrbitControls button mapping handled in cameraControls


  // Brush/controls coordination handled in cameraControls via pcd-brush events

  // Threshold scaling moved into tools.performRaycast


  // Sync point size with material
  useEffect(() => {
    const points = pointsRef.current;
    if (!points) return;
    const mat = points.material as THREE.ShaderMaterial | THREE.PointsMaterial | undefined;
    if (!mat) return;
    // Support both materials, but prefer shader material
    if ((mat as any).uniforms && (mat as any).uniforms.uSize) {
      const u = (mat as any).uniforms;
      if (u.uSize.value !== pointSize) {
        u.uSize.value = pointSize;
        scheduleRender();
      }
    } else if ((mat as THREE.PointsMaterial).size !== undefined) {
      const pm = mat as THREE.PointsMaterial;
      if (pm.size !== pointSize) {
        pm.size = pointSize;
        pm.needsUpdate = true;
        scheduleRender();
      }
    }
  }, [pointSize, scheduleRender]);

  // Sync pixel thinning step with shader
  useEffect(() => {
    const points = pointsRef.current;
    if (!points) return;
    const mat = points.material as any;
    if (!mat || !mat.uniforms || !mat.uniforms.uPixelStep) return;
    const val = Math.min(PIXEL_STEP_MAX, Math.max(PIXEL_STEP_MIN, Math.round(pixelStep)));
    if (mat.uniforms.uPixelStep.value !== val) {
      mat.uniforms.uPixelStep.value = val;
      scheduleRender();
    }
  }, [pixelStep, scheduleRender]);

  // ML overlay: tint points of selected classes
  const prevOverlayRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const buffers = buffersRef.current;
    if (!buffers || !geometryRef.current) return;
    const colors = buffers.colors;
    // cleanup previous overlay by marking indices as dirty so base color recalculates
    if (prevOverlayRef.current.size > 0) {
      prevOverlayRef.current.forEach((idx) => markColorDirty(idx));
      prevOverlayRef.current.clear();
    }
    if (!mlOverlayVisible || !mlOverlayIndices || mlOverlayIndices.length === 0) {
      scheduleRender();
      return;
    }
    // apply overlay color (blue-ish) without touching selection/status flags
    const overlayColor: [number, number, number] = [0.2, 0.6, 1.0];
    const setLocal = new Set<number>();
    for (let i = 0; i < mlOverlayIndices.length; i++) {
      const idx = mlOverlayIndices[i];
      if (idx < 0 || idx >= (buffers.positions.length / 3)) continue;
      const off = idx * 3;
      colors[off] = overlayColor[0];
      colors[off + 1] = overlayColor[1];
      colors[off + 2] = overlayColor[2];
      setLocal.add(idx);
    }
    prevOverlayRef.current = setLocal;
    colorAttrNeedsSyncRef.current = true;
    scheduleRender();
  }, [mlOverlayVisible, mlOverlayIndices, scheduleRender, markColorDirty]);

  useEffect(() => {
    (window as any).__pcd_session_active__ = Boolean(session);
  }, [session]);

  // Apply camera far multiplier whenever it changes
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const baseFar = ((cam as any).userData && (cam as any).userData.baseFar) || cam.far;
    const mul = Number.isFinite(cameraFarMultiplier) && cameraFarMultiplier > 0 ? cameraFarMultiplier : 1;
    cam.far = baseFar * mul;
    cam.updateProjectionMatrix();
    scheduleRender();
  }, [cameraFarMultiplier, scheduleRender]);
  // Sizing handled centrally in cameraControls

  // Context menu prevention handled in cameraControls


  useEffect(() => {
    if (!geometryRef.current || totalPoints === 0) return;
    const positions = new Float32Array(totalPoints * 3);
    const colors = new Float32Array(totalPoints * 3);
    const status = new Uint8Array(totalPoints);
    const selections = new Uint8Array(totalPoints);
    const lodIndex = new Float32Array(totalPoints);
    buffersRef.current = { positions, colors, status, selections, lodIndex };
    tilesSignatureRef.current = "";

    const positionAttr = new THREE.BufferAttribute(positions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    const indexAttr = new THREE.BufferAttribute(lodIndex, 1);
    indexAttr.setUsage(THREE.DynamicDrawUsage);

    geometryRef.current.setAttribute("position", positionAttr);
    geometryRef.current.setAttribute("color", colorAttr);
    geometryRef.current.setAttribute("aIndex", indexAttr);
    geometryRef.current.setDrawRange(0, 0);

    setLoadedPointCount(0);
    setSelectedForDelete(0);
    setSelectedForRestore(0);
    deletedSetRef.current.clear();
    pendingDeleteRef.current.clear();
    pendingRestoreRef.current.clear();
    colorAttrNeedsSyncRef.current = true;
    scheduleRender();
  }, [scheduleRender, totalPoints]);

  const poseInitializedRef = useRef(false);

  useEffect(() => {
    return loadTilesEffect({
      dataset,
      tiles,
      buffersRef,
      geometryRef,
      controlsRef: controlsRef as React.MutableRefObject<OrbitControls | undefined>,
      cameraRef,
      tilesSignatureRef,
      setLoadedPointCount,
      poseInitializedRef,
      scheduleRender,
    });
  }, [dataset, tiles]);

  useEffect(() => {
    // make pending sets available for the tools module without prop drilling
    (window as any).__pcd_pending_delete__ = pendingDeleteRef;
    (window as any).__pcd_pending_restore__ = pendingRestoreRef;
    (window as any).__pcd_session_active__ = Boolean(session);

    if (!session || activeTool === "ml") {
      const cursor = brushCursorRef.current;
      if (cursor && cursor.visible) {
        cursor.visible = false;
        scheduleRender();
      }
      return;
    }

    return setupBrushInteractions({
      session,
      tool: activeTool,
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
      brushCursorRef,
      scheduleRender,
    });
  }, [session, activeTool, brushRadius, scheduleRender]);

  useEffect(() => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (!session && cursor.visible) {
      cursor.visible = false;
      scheduleRender();
    }
  }, [session, scheduleRender]);

  const handleResetSelection = useCallback(() => {
    toolsResetSelection(
      buffersRef,
      pendingDeleteRef,
      pendingRestoreRef,
      geometryRef,
      setSelectedForDelete,
      setSelectedForRestore
    );
    onResetSelection?.();
  }, [onResetSelection]);

  const handleApplySelection = useCallback(async () => {
    await toolsApplySelection(
      dataset,              // 1) нужен первым
      session,              // 2)
      sessionRef,           // 3) ссылка на текущую сессию
      appendOps,            // 4)
      sessionVersionRef,    // 5)
      buffersRef,           // 6)
      pendingDeleteRef,     // 7)
      pendingRestoreRef,    // 8)
      deletedSetRef,        // 9)
      geometryRef,          // 10)
      setSelectedForDelete, // 11)
      setSelectedForRestore // 12)
    );
  }, [appendOps, dataset, session, setSelectedForDelete, setSelectedForRestore]);
  const handleExport = async () => {
    try {
      await exportDataset();
      const url = `${API_BASE}/datasets/${dataset.id}/export`;
      window.open(url, "_blank");
    } catch (error) {
      console.error("export.error", error);
    }
  };

  useEffect(() => {
    handleResetSelection();
    deletedSetRef.current.clear();
  }, [handleResetSelection, session?.id]);

  // Publish tool + options + selection control to app shell
  useEffect(() => {
    (window as any).__pcd_tool__ = {
      tool: activeTool,
      setTool: (t: Tool) => (onChangeTool ? onChangeTool(t) : setTool(t)),
    };
    (window as any).__pcd_tool_options__ = {
      brushRadius,
      setBrushRadius,
      pointSize,
      setPointSize,
      pixelStep,
      setPixelStep,
      cameraFarMultiplier,
      setCameraFarMultiplier,
    };
    (window as any).__pcd_selection__ = {
      canReset: selectedForDelete + selectedForRestore > 0,
      canApply: Boolean(session) && !isAppending && selectedForDelete + selectedForRestore > 0,
      reset: handleResetSelection,
      apply: handleApplySelection,
    };
    window.dispatchEvent(new Event("pcd-ui-update"));
  }, [
    activeTool,
    brushRadius,
    pointSize,
    pixelStep,
    selectedForDelete,
    selectedForRestore,
    session,
    isAppending,
    handleResetSelection,
    handleApplySelection,
  ]);

  return (
    <div className="editor">
      <div className="editor-canvas" ref={containerRef}>
        {!session && (
          <div className="editor-overlay">
            <p>Создайте сессию, чтобы редактировать облако.</p>
            <button type="button" onClick={onCreateSession}>
              Создать сессию
            </button>
          </div>
        )}
          <RenderStats
          pointsLoaded={loadedPointCount}
          totalPoints={totalPoints}
          tilesLoaded={Math.min(tiles.length, Math.ceil(loadedPointCount / 20000))}
          tilesTotal={tiles.length}
          frameTime={frameTime}
        />

      </div>
    </div>
  );
}

// chunkArray moved into tools module logic; not needed here
