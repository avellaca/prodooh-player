import { http, HttpResponse } from 'msw';

const BASE_URL = 'http://localhost:8000/api';

export const handlers = [
  // Auth endpoints
  http.get(`${BASE_URL}/admin/user`, () => {
    return HttpResponse.json({
      id: '1',
      email: 'admin@example.com',
      role: 'super_admin',
      tenant_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
    });
  }),

  http.post(`${BASE_URL}/admin/login`, () => {
    return HttpResponse.json({
      token: 'mock-jwt-token',
      user: {
        id: '1',
        email: 'admin@example.com',
        role: 'super_admin',
        tenant_id: null,
        created_at: '2024-01-01T00:00:00.000Z',
      },
    });
  }),

  http.post(`${BASE_URL}/admin/logout`, () => {
    return new HttpResponse(null, { status: 200 });
  }),

  // Screens
  http.get(`${BASE_URL}/admin/screens`, () => {
    return HttpResponse.json([]);
  }),

  // Tenants
  http.get(`${BASE_URL}/admin/tenants`, () => {
    return HttpResponse.json([]);
  }),

  // Groups
  http.get(`${BASE_URL}/admin/groups`, () => {
    return HttpResponse.json([]);
  }),

  // Playlists
  http.get(`${BASE_URL}/admin/playlists`, () => {
    return HttpResponse.json([]);
  }),

  // Content
  http.get(`${BASE_URL}/admin/content`, () => {
    return HttpResponse.json([]);
  }),
];
