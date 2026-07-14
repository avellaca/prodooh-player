import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DirectUploadDialog } from './DirectUploadDialog';

// Mock the API modules
vi.mock('@/features/content/api', () => ({
  contentApi: {
    upload: vi.fn(),
  },
}));

vi.mock('../api', () => ({
  bulkCreativesApi: {
    createByResolution: vi.fn(),
  },
  creativesApi: {
    createForTarget: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { contentApi } from '@/features/content/api';
import { bulkCreativesApi, creativesApi } from '../api';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  orderLineId: 'ol-1',
  onSuccess: vi.fn(),
};

describe('DirectUploadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with file drop zone when open', () => {
    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('Subir archivo')).toBeInTheDocument();
    expect(screen.getByText(/Arrastra un archivo aquí/)).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG, WebP, MP4, WebM/)).toBeInTheDocument();
    expect(screen.getByText(/Resolución: /)).toBeInTheDocument();
  });

  it('shows bulk description when no targetId', () => {
    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    expect(
      screen.getByText(/para asignar a todas las pantallas del grupo/)
    ).toBeInTheDocument();
  });

  it('shows individual description when targetId is provided', () => {
    render(
      <DirectUploadDialog {...defaultProps} targetId="target-1" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText(/para esta pantalla/)).toBeInTheDocument();
  });

  it('accepts file input via click', () => {
    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    const selectButton = screen.getByRole('button', { name: /Seleccionar archivo/ });
    expect(selectButton).toBeInTheDocument();
  });

  it('shows upload phase when file is selected', async () => {
    const mockContent = {
      id: 'content-1',
      tenant_id: 'tenant-1',
      filename: 'test.jpg',
      mime_type: 'image/jpeg',
      storage_path: '/path/test.jpg',
      file_size_bytes: 1024,
      width: 1920,
      height: 1080,
      duration_seconds: null,
      orientation: 'landscape',
      rotation: 0,
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(contentApi.upload).mockImplementation((_file, options) => {
      options?.onUploadProgress?.(50);
      return Promise.resolve(mockContent);
    });

    vi.mocked(bulkCreativesApi.createByResolution).mockResolvedValue({
      creatives_created: 5,
      affected_screens: ['s1', 's2', 's3', 's4', 's5'],
    });

    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    // Get the hidden file input and simulate selection
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(contentApi.upload).toHaveBeenCalledWith(file, expect.any(Object));
    });
  });

  it('shows error when resolution mismatch', async () => {
    const mockContent = {
      id: 'content-1',
      tenant_id: 'tenant-1',
      filename: 'wrong-res.jpg',
      mime_type: 'image/jpeg',
      storage_path: '/path/wrong-res.jpg',
      file_size_bytes: 1024,
      width: 1080,
      height: 1920,
      duration_seconds: null,
      orientation: 'portrait',
      rotation: 0,
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(contentApi.upload).mockResolvedValue(mockContent);

    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'wrong-res.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText(/La resolución del archivo \(1080×1920\) no coincide/)
      ).toBeInTheDocument();
    });

    // Bulk assign should NOT be called
    expect(bulkCreativesApi.createByResolution).not.toHaveBeenCalled();
  });

  it('calls createForTarget when targetId is provided', async () => {
    const mockContent = {
      id: 'content-2',
      tenant_id: 'tenant-1',
      filename: 'single.jpg',
      mime_type: 'image/jpeg',
      storage_path: '/path/single.jpg',
      file_size_bytes: 2048,
      width: 1920,
      height: 1080,
      duration_seconds: null,
      orientation: 'landscape',
      rotation: 0,
      created_at: '2025-01-01T00:00:00Z',
    };

    vi.mocked(contentApi.upload).mockResolvedValue(mockContent);
    vi.mocked(creativesApi.createForTarget).mockResolvedValue({
      id: 'creative-1',
      order_line_target_id: 'target-1',
      content_id: 'content-2',
      weight: 100,
      active_dates: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    });

    render(
      <DirectUploadDialog {...defaultProps} targetId="target-1" />,
      { wrapper: createWrapper() }
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'single.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(creativesApi.createForTarget).toHaveBeenCalledWith('target-1', {
        content_id: 'content-2',
        weight: 100,
      });
    });
  });

  it('shows retry button after error', async () => {
    vi.mocked(contentApi.upload).mockRejectedValue({
      response: { data: { message: 'Upload failed' } },
    });

    render(<DirectUploadDialog {...defaultProps} />, { wrapper: createWrapper() });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Upload failed')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Intentar de nuevo/ });
    expect(retryButton).toBeInTheDocument();

    // Click retry should go back to idle
    fireEvent.click(retryButton);
    expect(screen.getByText(/Arrastra un archivo aquí/)).toBeInTheDocument();
  });
});
