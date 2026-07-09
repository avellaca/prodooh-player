import axios from 'axios';

export const TOKEN_KEY = 'admin_token';
export const TENANT_STORAGE_KEY = 'selected_tenant_id';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Request interceptor: agrega Authorization header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Request interceptor: agrega tenant_id query param si hay tenant seleccionado
api.interceptors.request.use((config) => {
  const tenantId = localStorage.getItem(TENANT_STORAGE_KEY);
  if (tenantId) {
    // Don't overwrite if tenant_id already present in params
    if (!config.params?.tenant_id) {
      config.params = { ...config.params, tenant_id: tenantId };
    }
  }
  return config;
});

// Response interceptor: maneja 401 → logout automático
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
