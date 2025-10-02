import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDatasetDetail } from "../hooks/useDatasetDetail";
import { PointCloudEditor } from "../render/PointCloudEditor";
import { MAX_INDICES_PER_OP, type Tool } from "../render/types";
import type { Session } from "../types/api";
import { createPreview, getPreviewDetail, type PreviewDetail } from "../api/ml";

const DETECTABLE_CLASSES: Array<{ value: string; label: string }> = [
  { value: "car", label: "car" },
  { value: "person", label: "person" },
  { value: "vegetation", label: "vegetation" },
  { value: "wire", label: "wire" },
  { value: "pole", label: "pole" },
  { value: "ground", label: "ground" },
  { value: "other", label: "other" },
];

const CLASS_ORDER = DETECTABLE_CLASSES.map((opt) => opt.value);

function normaliseClasses(values: Iterable<string>): string[] {
  const set = new Set(values);
  return CLASS_ORDER.filter((value) => set.has(value));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const DEFAULT_CLASS_SELECTION = normaliseClasses(["car", "person", "vegetation", "wire", "pole"]);

interface Props {
  datasetId: string;
}

export function DatasetDetail({ datasetId }: Props) {
  const { datasetQuery, tilesQuery, sessionsQuery, createSessionMutation, appendOpsMutation, exportMutation } =
    useDatasetDetail(datasetId);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detectDropdownOpen, setDetectDropdownOpen] = useState(false);
  const detectDropdownRef = useRef<HTMLDivElement | null>(null);

  const sessions = sessionsQuery.data ?? [];
  const activeSession: Session | undefined = useMemo(() => {
    if (!selectedSessionId) return sessions[0];
    return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  }, [selectedSessionId, sessions]);

  const datasetInfo = datasetQuery.data;
  const tiles = tilesQuery.data ?? [];
  // ML preview UI state
  const [mlParams, setMlParams] = useState({ eps: 0.5, min_points: 30, voxel_size: 0.05, use_nn: true, model_type: "pointnet" as "pointnet" | "dgcnn" });
  const [mlLoading, setMlLoading] = useState(false);
  const [mlStats, setMlStats] = useState<Record<string, number> | null>(null);
  const [mlDetail, setMlDetail] = useState<PreviewDetail | null>(null);
  const [mlDetectClasses, setMlDetectClasses] = useState<string[]>(() => [...DEFAULT_CLASS_SELECTION]);
  const [mlOverlayClasses, setMlOverlayClasses] = useState<string[]>(() => [...DEFAULT_CLASS_SELECTION]);
  const [tool, setTool] = useState<Tool>("delete");

  const setMlEps = useCallback((value: number) => {
    setMlParams((prev) => ({ ...prev, eps: value }));
  }, []);

  const setMlMinPoints = useCallback((value: number) => {
    setMlParams((prev) => ({ ...prev, min_points: value }));
  }, []);

  const setMlVoxelSize = useCallback((value: number) => {
    setMlParams((prev) => ({ ...prev, voxel_size: value }));
  }, []);

  const setMlUseNN = useCallback((value: boolean) => {
    setMlParams((prev) => ({ ...prev, use_nn: value }));
  }, []);

  const setMlModelType = useCallback((value: "pointnet" | "dgcnn") => {
    setMlParams((prev) => ({ ...prev, model_type: value }));
  }, []);

  const detectSummary = useMemo(() => {
    if (mlDetectClasses.length === 0) return "нет";
    if (mlDetectClasses.length === DETECTABLE_CLASSES.length) return "все";
    return `${mlDetectClasses.length} выбрано`;
  }, [mlDetectClasses]);

  const mlOverlayIndices: number[] = useMemo(() => {
    if (!mlDetail) return [];
    const allowed = new Set(mlOverlayClasses);
    if (allowed.size === 0) return [];
    const aggregated = new Set<number>();
    for (let i = 0; i < mlDetail.labels.length; i++) {
      if (!allowed.has(mlDetail.labels[i])) continue;
      const arr = mlDetail.clusters[i] || [];
      for (let j = 0; j < arr.length; j++) {
        aggregated.add(arr[j]);
      }
    }
    return Array.from(aggregated).sort((a, b) => a - b);
  }, [mlDetail, mlOverlayClasses]);

  const mlOverlayActive = mlDetail !== null && mlOverlayIndices.length > 0;

  const handleCreateSession = useCallback(async (): Promise<Session> => {
    const newSession = await createSessionMutation.mutateAsync();
    setSelectedSessionId(newSession.id);
    return newSession;
  }, [createSessionMutation, setSelectedSessionId]);

  useEffect(() => {
    if (mlDetail) return;
    setMlOverlayClasses((prev) => (arraysEqual(prev, mlDetectClasses) ? prev : [...mlDetectClasses]));
  }, [mlDetail, mlDetectClasses]);

  useEffect(() => {
    if (!detectDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!detectDropdownRef.current) return;
      if (!detectDropdownRef.current.contains(event.target as Node)) {
        setDetectDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetectDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [detectDropdownOpen]);

  const toggleDetectDropdown = useCallback(() => {
    setDetectDropdownOpen((prev) => !prev);
  }, []);

  const toggleDetectClass = useCallback((value: string, checked: boolean) => {
    setMlDetectClasses((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(value);
      } else {
        next.delete(value);
      }
      return normaliseClasses(next);
    });
  }, []);

  const resetDetectClasses = useCallback(() => {
    setMlDetectClasses([...DEFAULT_CLASS_SELECTION]);
  }, []);

  const handleRunPreview = useCallback(async () => {
    if (!datasetInfo) return;
    setMlLoading(true);
    try {
      const validClasses = normaliseClasses(mlDetectClasses);
      const resp = await createPreview({
        dataset_path: datasetInfo.raw_uri,
        eps: mlParams.eps,
        min_points: mlParams.min_points,
        voxel_size: mlParams.voxel_size,
        use_nn: mlParams.use_nn,
        model_type: mlParams.model_type,
        target_classes: validClasses.length > 0 ? validClasses : null,
      });
      setMlStats(resp.stats);
      const detail = await getPreviewDetail(resp.preview_id);
      setMlDetail(detail);
      if (detail.selected_classes && detail.selected_classes.length > 0) {
        setMlOverlayClasses(normaliseClasses(detail.selected_classes));
      } else {
        setMlOverlayClasses(validClasses);
      }
    } catch (error) {
      console.error("ml.preview", error);
    } finally {
      setMlLoading(false);
    }
  }, [datasetInfo, mlDetectClasses, mlParams]);

  const handleApplyMask = useCallback(async () => {
    if (!mlDetail) return;
    if (mlOverlayClasses.length === 0) return;
    if (mlOverlayIndices.length === 0) return;

    let sessionToUse = activeSession;
    try {
      if (!sessionToUse) {
        sessionToUse = await handleCreateSession();
      }
    } catch (error) {
      console.error("ml.delete-mask.session", error);
      return;
    }
    if (!sessionToUse) return;

    const sortedIndices = mlOverlayIndices;
    let baseVersion = sessionToUse.version;

    try {
      for (let i = 0; i < sortedIndices.length; i += MAX_INDICES_PER_OP) {
        const chunk = sortedIndices.slice(i, i + MAX_INDICES_PER_OP);
        await appendOpsMutation.mutateAsync({
          sessionId: sessionToUse.id,
          baseVersion,
          ops: [{ action: "delete", indices: chunk }],
        });
        baseVersion += 1;
      }
    } catch (error) {
      console.error("ml.delete-mask", error);
    }
  }, [activeSession, appendOpsMutation, handleCreateSession, mlDetail, mlOverlayClasses, mlOverlayIndices]);

  const handleResetMlSelection = useCallback(() => {
    setMlDetail(null);
    setMlStats(null);
    setMlOverlayClasses(normaliseClasses(mlDetectClasses));
  }, [mlDetectClasses]);

  useEffect(() => {
    const controls = {
      params: mlParams,
      setEps: setMlEps,
      setMinPoints: setMlMinPoints,
      setVoxelSize: setMlVoxelSize,
      setUseNN: setMlUseNN,
      setModelType: setMlModelType,
      detectSummary,
      detectDropdownOpen,
      toggleDetectDropdown,
      setDetectDropdownOpen,
      detectDropdownRef,
      detectClasses: mlDetectClasses,
      toggleDetectClass,
      resetDetectClasses,
      runPreview: handleRunPreview,
      mlLoading,
      canRunPreview: Boolean(datasetInfo),
      canApplyMask: !appendOpsMutation.isPending && Boolean(mlDetail) && mlOverlayIndices.length > 0,
      applyMask: handleApplyMask,
      mlStats,
      detectableClasses: DETECTABLE_CLASSES,
    };
    (window as any).__pcd_ml_controls__ = controls;
    window.dispatchEvent(new Event("pcd-ml-update"));
    return () => {
      if ((window as any).__pcd_ml_controls__ === controls) {
        (window as any).__pcd_ml_controls__ = null;
        window.dispatchEvent(new Event("pcd-ml-update"));
      }
    };
  }, [
    appendOpsMutation,
    appendOpsMutation.isPending,
    detectDropdownOpen,
    detectSummary,
    datasetInfo,
    handleApplyMask,
    handleRunPreview,
    mlDetail,
    mlDetectClasses,
    mlLoading,
    mlOverlayIndices.length,
    mlParams,
    mlStats,
    resetDetectClasses,
    setDetectDropdownOpen,
    setMlEps,
    setMlMinPoints,
    setMlModelType,
    setMlUseNN,
    setMlVoxelSize,
    toggleDetectClass,
    toggleDetectDropdown,
  ]);

  // Экспортируем действия в верхнее меню «Файл» через глобальный контекст
  useEffect(() => {
    (window as any).__pcd_menu__ = {
      sessions,
      activeSessionId: activeSession?.id ?? null,
      setActiveSessionId: (id: string) => setSelectedSessionId(id),
      onCreateSession: handleCreateSession,
      isCreating: createSessionMutation.isPending,
      onExport: async () => {
        await exportMutation.mutateAsync();
        window.open(`${import.meta.env.VITE_API_BASE ?? "/api"}/datasets/${datasetId}/export/`, "_blank");
      },
      isExporting: exportMutation.isPending,
    };
    window.dispatchEvent(new Event("pcd-menu-update"));
    return () => {
      (window as any).__pcd_menu__ = null;
      window.dispatchEvent(new Event("pcd-menu-update"));
    };
  }, [
    sessions,
    activeSession?.id,
    createSessionMutation,
    createSessionMutation.isPending,
    exportMutation.isPending,
    datasetId,
    handleCreateSession,
    exportMutation,
  ]);

  return (
    <div className="dataset-detail full">
      <div className="detail-main">
        {!datasetInfo ? (
          <p>Загрузка данных датасета...</p>
        ) : (
          <PointCloudEditor
            dataset={datasetInfo}
            tiles={tiles}
            session={activeSession}
            onCreateSession={handleCreateSession}
            appendOps={async ({ sessionId, baseVersion, ops }) => {
              await appendOpsMutation.mutateAsync({ sessionId, baseVersion, ops });
            }}
            isAppending={appendOpsMutation.isPending}
            exportDataset={async () => {
              await exportMutation.mutateAsync();
            }}
            isExporting={exportMutation.isPending}
            tool={tool}
            onChangeTool={setTool}
            mlOverlayIndices={mlOverlayIndices}
            mlOverlayVisible={mlOverlayActive}
            onResetSelection={handleResetMlSelection}
          />
        )}
      </div>
    </div>
  );
}
