import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import { DatasetsListPage } from "./pages/DatasetsListPage";
import { EditorPage } from "./pages/EditorPage";

const queryClient = new QueryClient();

interface MlToolControls {
  params: {
    eps: number;
    min_points: number;
    voxel_size: number;
    use_nn: boolean;
    model_type: "pointnet" | "dgcnn";
  };
  setEps: (value: number) => void;
  setMinPoints: (value: number) => void;
  setVoxelSize: (value: number) => void;
  setUseNN: (value: boolean) => void;
  setModelType: (value: "pointnet" | "dgcnn") => void;
  detectSummary: string;
  detectDropdownOpen: boolean;
  toggleDetectDropdown: () => void;
  setDetectDropdownOpen: (value: boolean) => void;
  detectDropdownRef: React.RefObject<HTMLDivElement>;
  detectClasses: string[];
  toggleDetectClass: (value: string, checked: boolean) => void;
  resetDetectClasses: () => void;
  runPreview: () => Promise<void>;
  mlLoading: boolean;
  canRunPreview: boolean;
  canApplyMask: boolean;
  applyMask: () => Promise<void>;
  mlStats: Record<string, number> | null;
  detectableClasses: Array<{ value: string; label: string }>;
}

export function App() {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [editorMenuState, setEditorMenuState] = useState<any>(null);
  const [toolState, setToolState] = useState<any>(null);
  const [toolOptions, setToolOptions] = useState<any>(null);
  const [mlControls, setMlControls] = useState<MlToolControls | null>(null);
  const fileBtnRef = useRef<HTMLButtonElement | null>(null);
  const editBtnRef = useRef<HTMLButtonElement | null>(null);
  const viewBtnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownLeft, setDropdownLeft] = useState<number>(90);
  const TOPBAR_HEIGHT = 44;

  const computeDropdownLeft = (btn: HTMLButtonElement | null) => {
    const minWidth = 340;
    const padding = 8;
    const rect = btn?.getBoundingClientRect();
    let left = rect ? rect.left : 90;
    const maxLeft = Math.max(0, (window.innerWidth || 0) - minWidth - padding);
    if (left > maxLeft) left = maxLeft;
    return Math.max(padding, left);
  };

  useEffect(() => {
    const handler = () => setEditorMenuState((window as any).__pcd_menu__ ?? null);
    handler();
    window.addEventListener("pcd-menu-update", handler as any);
    return () => window.removeEventListener("pcd-menu-update", handler as any);
  }, []);

  useEffect(() => {
    const handler = () => {
      setToolState((window as any).__pcd_tool__ ?? null);
      setToolOptions((window as any).__pcd_tool_options__ ?? null);
    };
    handler();
    window.addEventListener("pcd-ui-update", handler as any);
    window.addEventListener("pcd-menu-update", handler as any);
    return () => {
      window.removeEventListener("pcd-ui-update", handler as any);
      window.removeEventListener("pcd-menu-update", handler as any);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const controls = (window as any).__pcd_ml_controls__ as MlToolControls | null;
      setMlControls(controls ? { ...controls } : null);
    };
    handler();
    window.addEventListener("pcd-ml-update", handler as EventListener);
    return () => {
      window.removeEventListener("pcd-ml-update", handler as EventListener);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!fileMenuOpen && !editMenuOpen && !viewMenuOpen) return;
      const t = ev.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(t)) return;
      if (fileBtnRef.current && fileBtnRef.current.contains(t)) return;
      if (editBtnRef.current && editBtnRef.current.contains(t)) return;
      if (viewBtnRef.current && viewBtnRef.current.contains(t)) return;
      setFileMenuOpen(false);
      setEditMenuOpen(false);
      setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [fileMenuOpen]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-root">
        <header className="topbar">
          <div className="topbar-left">
            <strong>PointCloud Studio</strong>
          </div>
          <nav className="topbar-menu">
            <button
              type="button"
              className="menu-item"
              title="Файл"
              onClick={() => {
                setDropdownLeft(computeDropdownLeft(fileBtnRef.current));
                setFileMenuOpen((v) => !v);
                setEditMenuOpen(false);
                setViewMenuOpen(false);
              }}
              ref={fileBtnRef}
            >
              Файл
            </button>
            <button
              type="button"
              className="menu-item"
              title="Правка"
              onClick={() => {
                setDropdownLeft(computeDropdownLeft(editBtnRef.current));
                setEditMenuOpen((v) => !v);
                setFileMenuOpen(false);
                setViewMenuOpen(false);
              }}
              ref={editBtnRef}
            >
              Правка
            </button>
            <button
              type="button"
              className="menu-item"
              title="Вид"
              onClick={() => {
                setDropdownLeft(computeDropdownLeft(viewBtnRef.current));
                setViewMenuOpen((v) => !v);
                setFileMenuOpen(false);
                setEditMenuOpen(false);
              }}
              ref={viewBtnRef}
            >
              Вид
            </button>
            <button type="button" className="menu-item" title="Справка">
              Справка
            </button>
          </nav>
          <div className="topbar-right" />
          {fileMenuOpen && (
            <div className="dropdown" ref={dropdownRef} style={{ left: dropdownLeft, top: TOPBAR_HEIGHT }}>
              <div className="dropdown-section">
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={!editorMenuState || editorMenuState?.isCreating}
                  onClick={async () => {
                    try {
                      await editorMenuState?.onCreateSession?.();
                      (window as any).dispatchEvent?.(new Event("pcd-menu-update"));
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  {editorMenuState?.isCreating ? "Создание сессии..." : "Новая сессия"}
                </button>
              </div>
              <div className="dropdown-section">
                <div className="dropdown-title">Сессии</div>
                <div className="dropdown-list">
                  {editorMenuState?.sessions?.length ? (
                    editorMenuState.sessions.map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`dropdown-item ${s.id === editorMenuState.activeSessionId ? "active" : ""}`}
                        onClick={() => editorMenuState?.setActiveSessionId?.(s.id)}
                      >
                        Версия {s.version} · {new Date(s.created_at).toLocaleString()}
                      </button>
                    ))
                  ) : (
                    <div className="dropdown-empty">Нет сессий</div>
                  )}
                </div>
              </div>
              <div className="dropdown-section">
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={!editorMenuState || editorMenuState?.isExporting}
                  onClick={async () => {
                    try {
                      await editorMenuState?.onExport?.();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  {editorMenuState?.isExporting ? "Экспорт..." : "Экспорт processed_points.pcd"}
                </button>
              </div>
            </div>
          )}
          {editMenuOpen && (
            <div className="dropdown" ref={dropdownRef} style={{ left: dropdownLeft, top: TOPBAR_HEIGHT }}>
              <div className="dropdown-section">
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={!((window as any).__pcd_selection__?.canReset)}
                  onClick={() => (window as any).__pcd_selection__?.reset?.()}
                >
                  Сбросить выделение
                </button>
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={!((window as any).__pcd_selection__?.canApply)}
                  onClick={() => (window as any).__pcd_selection__?.apply?.()}
                >
                  Применить к сессии
                </button>
              </div>
            </div>
          )}
          {viewMenuOpen && (
            <div className="dropdown" ref={dropdownRef} style={{ left: dropdownLeft, top: TOPBAR_HEIGHT }}>
              <div className="dropdown-section">
                <div className="dropdown-title">Отображение</div>
                {/* Point size */}
                <div className="dropdown-row">
                  <label className="row-label">Размер точек</label>
                  <input
                    type="range"
                    min={0.01}
                    max={5}
                    step={0.01}
                    className="row-range"
                    value={Number.isFinite(toolOptions?.pointSize) ? toolOptions?.pointSize : 0.4}
                    onChange={(e) => {
                      const v = Math.min(5, Math.max(0.01, Number(e.target.value)));
                      toolOptions?.setPointSize?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                  <input
                    type="number"
                    className="row-number"
                    value={Number.isFinite(toolOptions?.pointSize) ? toolOptions?.pointSize : 0.4}
                    onChange={(e) => {
                      const v = Math.min(5, Math.max(0.01, Number(e.target.value)));
                      toolOptions?.setPointSize?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                </div>
                {/* Pixel step */}
                <div className="dropdown-row">
                  <label className="row-label">Шаг по пикселям</label>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    step={1}
                    className="row-range"
                    value={Number.isFinite(toolOptions?.pixelStep) ? Math.round(toolOptions?.pixelStep) : 1}
                    onChange={(e) => {
                      const v = Math.round(Math.min(16, Math.max(1, Number(e.target.value))));
                      toolOptions?.setPixelStep?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                  <input
                    type="number"
                    className="row-number"
                    value={Number.isFinite(toolOptions?.pixelStep) ? Math.round(toolOptions?.pixelStep) : 1}
                    onChange={(e) => {
                      const v = Math.round(Math.min(16, Math.max(1, Number(e.target.value))));
                      toolOptions?.setPixelStep?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                </div>
                {/* Render distance multiplier */}
                <div className="dropdown-row">
                  <label className="row-label">Дальность прорисовки</label>
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.5}
                    className="row-range"
                    value={Number.isFinite(toolOptions?.cameraFarMultiplier) ? toolOptions?.cameraFarMultiplier : 1}
                    onChange={(e) => {
                      const v = Math.min(10, Math.max(0.5, Number(e.target.value)));
                      toolOptions?.setCameraFarMultiplier?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                  <input
                    type="number"
                    className="row-number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={Number.isFinite(toolOptions?.cameraFarMultiplier) ? toolOptions?.cameraFarMultiplier : 1}
                    onChange={(e) => {
                      const v = Math.min(10, Math.max(0.5, Number(e.target.value)));
                      toolOptions?.setCameraFarMultiplier?.(v);
                    }}
                    disabled={!toolOptions}
                  />
                </div>
              </div>
            </div>
          )}
        </header>
        {/* Tool options row under topbar */}
        <div className="tool-options">
          {toolState ? (
            <>
              <span className="muted">Инструмент:</span>
              <strong style={{ marginRight: 12 }}>
                {toolState?.tool === "delete"
                  ? "Удаление"
                  : toolState?.tool === "restore"
                  ? "Восстановление"
                  : "ML анализ"}
              </strong>
              {toolState?.tool === "delete" || toolState?.tool === "restore" ? (
                <label>
                  Радиус кисти: {toolOptions?.brushRadius?.toFixed?.(2) ?? "—"}
                  <input
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={toolOptions?.brushRadius ?? 0.5}
                    onChange={(e) => toolOptions?.setBrushRadius?.(Number(e.target.value))}
                    style={{ marginLeft: 8 }}
                  />
                </label>
              ) : toolState?.tool === "ml" ? (
                mlControls ? <MlToolOptions controls={mlControls} /> : <span className="muted">Загрузка настроек ML...</span>
              ) : null}
            </>
          ) : (
            <span className="muted">Нет активного редактора</span>
          )}
        </div>
        <main className="app-content">
          <BrowserRouter>
            <RouteAwareWorkspace>
              <Routes>
                <Route path="/" element={<DatasetsListPage />} />
                <Route path="/datasets/:id" element={<EditorPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RouteAwareWorkspace>
          </BrowserRouter>
        </main>
      </div>
    </QueryClientProvider>
  );
}

function RouteAwareWorkspace({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isEditor = location.pathname.startsWith("/datasets/");
  const tool = (window as any).__pcd_tool__;
  return (
    <div className={`workspace ${isEditor ? "with-dock" : ""}`}>
          {isEditor && (
            <aside className="left-dock" aria-label="Инструменты">
              <button
                type="button"
                className={`tool-btn ${tool?.tool === "delete" ? "active" : ""}`}
            title="Кисть удаления (E)"
            onClick={() => tool?.setTool?.("delete")}
          >
            🩹
          </button>
              <button
                type="button"
                className={`tool-btn ${tool?.tool === "restore" ? "active" : ""}`}
                title="Кисть восстановления (R)"
                onClick={() => tool?.setTool?.("restore")}
              >
                🖌️
              </button>
              <button
                type="button"
                className={`tool-btn ${tool?.tool === "ml" ? "active" : ""}`}
                title="ML-инструмент"
                onClick={() => tool?.setTool?.("ml")}
              >
                🤖
              </button>
            </aside>
          )}
      <div className="workspace-main">{children}</div>
    </div>
  );
}

function MlToolOptions({ controls }: { controls: MlToolControls }) {
  const {
    params,
    setEps,
    setMinPoints,
    setVoxelSize,
    setUseNN,
    setModelType,
    detectSummary,
    detectDropdownOpen,
    toggleDetectDropdown,
    setDetectDropdownOpen,
    detectDropdownRef,
    detectClasses,
    toggleDetectClass,
    resetDetectClasses,
    runPreview,
    mlLoading,
    canRunPreview,
    canApplyMask,
    applyMask,
    mlStats,
    detectableClasses,
  } = controls;

  return (
    <div
      className="ml-panel"
      style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
    >
      <strong>ML:</strong>
      <label>
        eps
        <input
          type="number"
          step={0.1}
          value={params.eps}
          onChange={(e) => setEps(parseFloat(e.target.value))}
          style={{ width: 70, marginLeft: 4 }}
        />
      </label>
      <label>
        min_points
        <input
          type="number"
          step={1}
          value={params.min_points}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            setMinPoints(Number.isNaN(parsed) ? 0 : parsed);
          }}
          style={{ width: 70, marginLeft: 4 }}
        />
      </label>
      <label>
        voxel_size
        <input
          type="number"
          step={0.01}
          value={params.voxel_size}
          onChange={(e) => setVoxelSize(parseFloat(e.target.value))}
          style={{ width: 80, marginLeft: 4 }}
        />
      </label>
      <label>
        NN
        <input
          type="checkbox"
          checked={params.use_nn}
          onChange={(e) => setUseNN(e.target.checked)}
          style={{ marginLeft: 4 }}
        />
      </label>
      <label>
        модель
        <select
          value={params.model_type}
          onChange={(e) => setModelType(e.target.value as "pointnet" | "dgcnn")}
          style={{ marginLeft: 4 }}
        >
          <option value="pointnet">pointnet</option>
          <option value="dgcnn">dgcnn</option>
        </select>
      </label>
      <div ref={detectDropdownRef} className="ml-dropdown">
        <button
          type="button"
          className="ml-dropdown-button"
          onClick={() => {
            if (detectDropdownOpen) {
              setDetectDropdownOpen(false);
            } else {
              toggleDetectDropdown();
            }
          }}
        >
          <span>Поиск</span>
          <span className="ml-dropdown-summary">{detectSummary}</span>
        </button>
        {detectDropdownOpen && (
          <div className="ml-dropdown-menu">
            {detectableClasses.map((option) => {
              const checked = detectClasses.includes(option.value);
              return (
                <label key={`detect-${option.value}`} className="ml-dropdown-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleDetectClass(option.value, e.target.checked)}
                  />
                  {option.label}
                </label>
              );
            })}
            <button
              type="button"
              className="ml-dropdown-reset"
              onClick={resetDetectClasses}
            >
              Сбросить к умолчанию
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={!canRunPreview || mlLoading}
        onClick={() => {
          void runPreview();
        }}
      >
        Выделить
      </button>
      <button
        type="button"
        disabled={!canApplyMask}
        onClick={() => {
          void applyMask();
        }}
      >
        Удалить
      </button>
      {mlStats && (
        <span style={{ opacity: 0.8 }}>
          {Object.entries(mlStats)
            .map(([k, v]) => `${k}:${v}`)
            .join("  ")}
        </span>
      )}
    </div>
  );
}
