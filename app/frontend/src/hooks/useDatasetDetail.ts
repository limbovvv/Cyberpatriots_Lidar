import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../api/client";
import type { Dataset, Job, Session, Tile } from "../types/api";

interface OperationPayload {
  sessionId: string;
  baseVersion: number;
  ops: Array<Record<string, unknown>>;
}

export function useDatasetDetail(datasetId: string | null) {
  const queryClient = useQueryClient();

  const [datasetQuery, tilesQuery, sessionsQuery] = useQueries({
    queries: [
      {
        queryKey: ["dataset", datasetId],
        queryFn: async () => {
          if (!datasetId) return null;
          const response = await apiClient.get<Dataset>(`/datasets/${datasetId}`);
          return response.data;
        },
        enabled: !!datasetId,
      },
      {
        queryKey: ["tiles", datasetId],
        queryFn: async () => {
          if (!datasetId) return [] as Tile[];
          const response = await apiClient.get<Tile[]>(`/datasets/${datasetId}/tiles/`);
          return response.data;
        },
        enabled: !!datasetId,
      },
      {
        queryKey: ["sessions", datasetId],
        queryFn: async () => {
          if (!datasetId) return [] as Session[];
          const response = await apiClient.get<Session[]>(`/datasets/${datasetId}/sessions/`);
          return response.data;
        },
        enabled: !!datasetId,
      },
    ],
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      if (!datasetId) throw new Error("datasetId is required");
      const response = await apiClient.post<Session>(`/datasets/${datasetId}/sessions/`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions", datasetId] });
    },
  });

  const appendOpsMutation = useMutation({
    mutationFn: async ({ sessionId, ...payload }: OperationPayload) => {
      if (!datasetId) throw new Error("datasetId is required");
      const response = await apiClient.patch(
        `/datasets/${datasetId}/sessions/${sessionId}/ops`,
        payload
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
      queryClient.invalidateQueries({ queryKey: ["sessions", datasetId] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!datasetId) throw new Error("datasetId is required");
      const response = await apiClient.post<Job>(`/datasets/${datasetId}/export/`);
      return response.data;
    },
  });

  return {
    datasetQuery,
    tilesQuery,
    sessionsQuery,
    createSessionMutation,
    appendOpsMutation,
    exportMutation,
  };
}
