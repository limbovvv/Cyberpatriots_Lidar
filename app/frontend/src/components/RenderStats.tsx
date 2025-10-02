import { useEffect, useMemo, useState } from "react";

interface RenderStatsProps {
  pointsLoaded: number;
  totalPoints: number;
  tilesLoaded: number;
  tilesTotal: number;
  frameTime: number;
}

export function RenderStats({
  pointsLoaded,
  totalPoints,
  tilesLoaded,
  tilesTotal,
  frameTime,
}: RenderStatsProps) {
  const [expanded, setExpanded] = useState(false);

  const fps = useMemo(() => {
    if (frameTime <= 0) return 0;
    return Math.round(1000 / frameTime);
  }, [frameTime]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "f") {
        setExpanded((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className={`render-stats ${expanded ? "expanded" : ""}`}>
      <div className="render-stats-header" onClick={() => setExpanded((prev) => !prev)}>
        <span>
          Points: {pointsLoaded.toLocaleString()} / {totalPoints.toLocaleString()}
        </span>
        <span>
          Tiles: {tilesLoaded} / {tilesTotal}
        </span>
      </div>
      {expanded && (
        <div className="render-stats-body">
          <p>F — показать/скрыть панель.</p>
          <p>
            Рендерится {pointsLoaded.toLocaleString()} из {totalPoints.toLocaleString()} точек.
          </p>
          <p>
            Тайлов загружено {tilesLoaded} из {tilesTotal}; используйте LOD, чтобы сократить объём.
          </p>
          <p>Последнее время кадра: {frameTime.toFixed(2)} ms (~{fps} FPS).</p>
        </div>
      )}
    </div>
  );
}
