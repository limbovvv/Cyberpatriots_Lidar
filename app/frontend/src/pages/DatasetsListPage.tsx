import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useDatasets } from "../hooks/useDatasets";

export function DatasetsListPage() {
  const { listQuery, createMutation } = useDatasets();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const datasets = listQuery.data ?? [];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || !name) {
      alert("Выберите файл и укажите название");
      return;
    }
    const dataset = await createMutation.mutateAsync({ name, file });
    setName("");
    setFile(null);
    event.currentTarget.reset();
    navigate(`/datasets/${dataset.id}`);
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Датасеты</h2>
        {listQuery.isLoading ? (
          <p>Загрузка...</p>
        ) : (
          <ul className="dataset-list">
            {datasets.map((dataset) => (
              <li key={dataset.id}>
                <button onClick={() => navigate(`/datasets/${dataset.id}`)}>
                  <strong>{dataset.name}</strong>
                  <span>{dataset.points_total.toLocaleString()} точек</span>
                  <span>{dataset.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="upload-form" onSubmit={handleSubmit}>
          <h3>Создать новый</h3>
          <label>
            Название
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Пример: Локация 001"
            />
          </label>
          <label>
            Файл PCD (ASCII)
            <input type="file" accept=".pcd" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Загрузка..." : "Загрузить"}
          </button>
          {createMutation.isError && <p className="error">{(createMutation.error as Error).message}</p>}
        </form>
      </aside>
      <main className="content">
        <p>Выберите датасет слева, чтобы перейти в редактор.</p>
      </main>
    </div>
  );
}

