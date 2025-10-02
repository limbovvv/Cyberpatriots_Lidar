import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

export function formClient() {
  return axios.create({
    baseURL: API_BASE,
  });
}
