import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, formClient } from "../api/client";
import type { Dataset } from "../types/api";

export function useDatasets() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      const response = await apiClient.get<Dataset[]>("/datasets/");
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; file: File }) => {
      const payload = new FormData();
      payload.append("name", input.name);
      payload.append("file", input.file);
      const client = formClient();
      const response = await client.post<Dataset>('/datasets/upload', payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  return { listQuery, createMutation };
}
