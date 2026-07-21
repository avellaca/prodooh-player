import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { InlineWeightEditor } from './InlineWeightEditor';

const BASE_URL = '/api';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const defaultProps = {
  creativeId: 'creative-1',
  weight: 100,
  targetId: 'target-1',
  orderLineId: 'order-line-1',
  playbackMode: 'round_robin' as const,
};

describe('InlineWeightEditor', () => {
  it('displays the weight value as clickable text', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Peso: 100/i })).toBeInTheDocument();
  });

  it('returns null when playbackMode is sequential', () => {
    const { container } = renderWithQuery(
      <InlineWeightEditor {...defaultProps} playbackMode="sequential" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('transforms into an input on click', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));

    expect(screen.getByLabelText('Editar peso del creativo')).toBeInTheDocument();
  });

  it('shows error for non-numeric input on blur', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('Debe ser un número entero');
  });

  it('shows error for value less than 1 on blur', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('El peso debe ser ≥ 1');
  });

  it('shows error for empty value on blur', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('Debe ser un número entero');
  });

  it('calls PUT /creatives/{id} on Enter with valid value', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.put(`${BASE_URL}/admin/creatives/creative-1`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'creative-1', weight: 200 } });
      }),
    );

    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(capturedBody).toEqual({ weight: 200 });
    });
  });

  it('does not call API when value is unchanged', async () => {
    const spy = vi.fn();

    server.use(
      http.put(`${BASE_URL}/admin/creatives/creative-1`, async () => {
        spy();
        return HttpResponse.json({ data: { id: 'creative-1', weight: 100 } });
      }),
    );

    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    // Value stays as 100, press Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Give time for any potential mutation to fire
    await new Promise((r) => setTimeout(r, 100));
    expect(spy).not.toHaveBeenCalled();
  });

  it('reverts to display mode on Escape', () => {
    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    expect(screen.getByLabelText('Editar peso del creativo')).toBeInTheDocument();

    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(screen.getByRole('button', { name: /Peso: 100/i })).toBeInTheDocument();
  });

  it('calls PUT /creatives/{id} on blur with valid changed value', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.put(`${BASE_URL}/admin/creatives/creative-1`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 'creative-1', weight: 50 } });
      }),
    );

    renderWithQuery(<InlineWeightEditor {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Peso: 100/i }));
    const input = screen.getByLabelText('Editar peso del creativo');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(capturedBody).toEqual({ weight: 50 });
    });
  });
});
