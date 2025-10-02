const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export type PreviewParams = {
  dataset_path: string;
  eps?: number;
  min_points?: number;
  voxel_size?: number; // 0.0 to keep 1:1 mapping
  use_nn?: boolean;
  checkpoint?: string | null;
  model_type?: 'pointnet' | 'dgcnn';
  target_classes?: string[] | null;
};

export type PreviewResponse = { preview_id: string; stats: Record<string, number> };
export type PreviewDetail = { num_points: number; labels: string[]; clusters: number[][]; selected_classes?: string[] };

export async function createPreview(params: PreviewParams): Promise<PreviewResponse> {
  const res = await fetch(`${API_BASE}/ml/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_path: params.dataset_path,
      eps: params.eps ?? 0.5,
      min_points: params.min_points ?? 30,
      voxel_size: params.voxel_size ?? 0.0,
      use_nn: params.use_nn ?? true,
      checkpoint: params.checkpoint ?? null,
      model_type: params.model_type ?? 'pointnet',
      target_classes: params.target_classes ?? null,
    }),
  });
  if (!res.ok) throw new Error(`preview failed: ${res.status}`);
  return res.json();
}

export async function getPreviewDetail(previewId: string): Promise<PreviewDetail> {
  const res = await fetch(`${API_BASE}/ml/preview/${encodeURIComponent(previewId)}/detail`);
  if (!res.ok) throw new Error(`preview detail failed: ${res.status}`);
  return res.json();
}

export async function applyPreview(payload: {
  preview_id: string;
  classes_to_remove?: string[] | null;
  output_path: string;
}): Promise<{ output_path: string }> {
  const res = await fetch(`${API_BASE}/ml/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preview_id: payload.preview_id,
      classes_to_remove: payload.classes_to_remove ?? null,
      output_path: payload.output_path,
    }),
  });
  if (!res.ok) throw new Error(`apply failed: ${res.status}`);
  return res.json();
}
