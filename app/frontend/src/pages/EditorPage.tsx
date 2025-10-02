import { useParams, useNavigate } from "react-router-dom";
import { DatasetDetail } from "./DatasetDetail";

export function EditorPage() {
  const params = useParams();
  const navigate = useNavigate();
  const id = params.id as string | undefined;

  if (!id) {
    // Некорректный URL — возвращаемся на список
    navigate("/", { replace: true });
    return null;
  }

  return <DatasetDetail datasetId={id} />;
}

