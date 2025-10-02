import * as THREE from "three";

// Shared types and constants for the point cloud editor

export type Tool = "delete" | "restore" | "ml";

export interface InternalBuffers {
  positions: Float32Array;
  colors: Float32Array;
  status: Uint8Array; // 0 normal, 1 deleted
  selections: Uint8Array; // 0 none, 1 delete, 2 restore
  intensities?: Uint8Array;
  // For simple LOD (shader-side sampling by index)
  lodIndex: Float32Array;
}

export const TOOL_CODE: Partial<Record<Tool, number>> = {
  delete: 1,
  restore: 2,
};

export const SELECTION_COLOR: Record<number, [number, number, number]> = {
  0: [1, 1, 1],
  1: [1, 0.25, 0.25],
  2: [0.2, 1, 0.2],
};

export const DELETED_COLOR: [number, number, number] = [0.2, 0.2, 0.2];

export const MAX_INDICES_PER_OP = 20000;
export const RAYCAST_CHUNK_SIZE = 50000; // reserved for potential future chunking

export type ThreeRefs = {
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | undefined>;
  sceneRef: React.MutableRefObject<THREE.Scene | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  controlsRef: React.MutableRefObject<any>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  pointsRef: React.MutableRefObject<THREE.Points | undefined>;
};
