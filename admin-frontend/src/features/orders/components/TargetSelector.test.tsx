import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { TargetSelector } from './TargetSelector';

const BASE_URL = 'http://localhost:8000/api';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockScreens = [
  { id: 'screen-1', tenant_id: 't1', name: 'Pantalla Centro', status: 'online', orientation: 'landscape', resolution_width: 1920, resolution_height: 1080, venue_id: 'v1', group_id: null, last_heartbeat: null, created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: 'screen-2', tenant_id: 't1', name: 'Pantalla Norte', status: 'online', orientation: 'landscape', resolution_width: 1920, resolution_height: 1080, venue_id: 'v1', group_id: null, last_heartbeat: null, created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: 'screen-3', tenant_id: 't1', name: 'Pantalla Sur', status: 'offline', orientation: 'portrait', resolution_width: 1080, resolution_height: 1920, venue_id: 'v1', group_id: null, last_heartbeat: null, created_at: '2024-01-01', updated_at: '2024-01-01' },
];

const mockGroups = [
  { id: 'group-1', tenant_id: 't1', name: 'Grupo A', duration_seconds: null, created_at: '2024-01-01', screens_count: 3 },
  { id: 'group-2', tenant_id: 't1', name: 'Grupo B', duration_seconds: null, created_at: '2024-01-01', screens_count: 2 },
];

const mockTargets = [
  { id: 'target-1', order_line_id: 'ol-1', screen_id: 'screen-1', screen_group_id: null, created_at: '2024-01-01', screen: { id: 'screen-1', name: 'Pantalla Centro' } },
  { id: 'target-2', order_line_id: 'ol-1', screen_id: null, screen_group_id: 'group-1', created_at: '2024-01-01', screen_group: { id: 'group-1', name: 'Grupo A' } },
];

describe('TargetSelector', () => {
  it('shows loading state initially', () => {
    server.use(
      http.get(`${BASE_URL}/admin/order-lines/ol-1`, () => {
        return new Promise(() => {}); // never resolves
      }),
    );

    render(<TargetSelector orderLineId="ol-1" />, { wrapper: createWrapper() });
    expect(screen.getByText('Cargando targets…')).toBeInTheDocument();
  });

  it('displays assigned targets with their names and types', async () => {
    server.use(
      http.get(`${BASE_URL}/admin/order-lines/ol-1`, () => {
        return HttpResponse.json({ data: { id: 'ol-1', targets: mockTargets } });
      }),
      http.get(`${BASE_URL}/admin/screens`, () => {
        return HttpResponse.json({ data: mockScreens });
      }),
      http.get(`${BASE_URL}/admin/groups`, () => {
        return HttpResponse.json(mockGroups);
      }),
    );

    render(<TargetSelector orderLineId="ol-1" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Pantalla Centro')).toBeInTheDocument();
    });

    expect(screen.getByText('Grupo A')).toBeInTheDocument();
    expect(screen.getByText('Pantalla')).toBeInTheDocument();
    expect(screen.getByText('Grupo')).toBeInTheDocument();
  });

  it('shows remove buttons for each assigned target', async () => {
    server.use(
      http.get(`${BASE_URL}/admin/order-lines/ol-1`, () => {
        return HttpResponse.json({ data: { id: 'ol-1', targets: mockTargets } });
      }),
      http.get(`${BASE_URL}/admin/screens`, () => {
        return HttpResponse.json({ data: mockScreens });
      }),
      http.get(`${BASE_URL}/admin/groups`, () => {
        return HttpResponse.json(mockGroups);
      }),
    );

    render(<TargetSelector orderLineId="ol-1" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Desasignar Pantalla Centro')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Desasignar Grupo A')).toBeInTheDocument();
  });

  it('shows empty state when no targets are assigned', async () => {
    server.use(
      http.get(`${BASE_URL}/admin/order-lines/ol-1`, () => {
        return HttpResponse.json({ data: { id: 'ol-1', targets: [] } });
      }),
      http.get(`${BASE_URL}/admin/screens`, () => {
        return HttpResponse.json({ data: mockScreens });
      }),
      http.get(`${BASE_URL}/admin/groups`, () => {
        return HttpResponse.json(mockGroups);
      }),
    );

    render(<TargetSelector orderLineId="ol-1" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('No hay pantallas ni grupos asignados.')).toBeInTheDocument();
    });
  });

  it('renders selector triggers for assigning screens and groups', async () => {
    server.use(
      http.get(`${BASE_URL}/admin/order-lines/ol-1`, () => {
        return HttpResponse.json({ data: { id: 'ol-1', targets: [] } });
      }),
      http.get(`${BASE_URL}/admin/screens`, () => {
        return HttpResponse.json({ data: mockScreens });
      }),
      http.get(`${BASE_URL}/admin/groups`, () => {
        return HttpResponse.json(mockGroups);
      }),
    );

    render(<TargetSelector orderLineId="ol-1" />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Asignar pantalla')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Asignar grupo')).toBeInTheDocument();
  });
});
