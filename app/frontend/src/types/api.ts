export interface Dataset {
  id: string;
  name: string;
  raw_uri: string;
  status: "uploaded" | "tiled" | "ready";
  points_total: number;
  created_at: string;
}

export interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  uri: string;
  points: number;
  base_index: number;
}

export interface Session {
  id: string;
  dataset_id: string;
  version: number;
  closed: boolean;
  created_at: string;
}

export interface Operation {
  id: string;
  version: number;
  op: Record<string, unknown>;
  created_at: string;
}

export interface Job {
  id: string;
  dataset_id: string;
  kind: "tiling" | "apply" | "export";
  status: "pending" | "running" | "done" | "error";
  meta: Record<string, unknown>;
  created_at: string;
}
