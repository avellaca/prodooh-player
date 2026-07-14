import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentLightbox } from "./ContentLightbox";
import type { Content } from "@/types/models";

function createContent(overrides: Partial<Content> = {}): Content {
  return {
    id: "content-1",
    tenant_id: "tenant-1",
    filename: "photo.jpg",
    mime_type: "image/jpeg",
    storage_path: "/storage/photo.jpg",
    file_size_bytes: 1024,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    orientation: "landscape",
    rotation: 0,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("ContentLightbox", () => {
  const items: Content[] = [
    createContent({ id: "1", filename: "photo1.jpg", mime_type: "image/jpeg" }),
    createContent({ id: "2", filename: "video1.mp4", mime_type: "video/mp4" }),
    createContent({ id: "3", filename: "photo2.png", mime_type: "image/png" }),
  ];

  it("renders nothing when open is false", () => {
    const { container } = renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={false}
        onOpenChange={() => {}}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the lightbox overlay when open is true", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Lightbox de contenido")).toBeInTheDocument();
  });

  it("shows navigation buttons when there are multiple items", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByLabelText("Contenido anterior")).toBeInTheDocument();
    expect(screen.getByLabelText("Contenido siguiente")).toBeInTheDocument();
  });

  it("hides navigation buttons when there is only one item", () => {
    renderWithProviders(
      <ContentLightbox
        items={[items[0]]}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.queryByLabelText("Contenido anterior")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contenido siguiente")).not.toBeInTheDocument();
  });

  it("shows counter indicator with correct position", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={1}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when close button is clicked", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByLabelText("Cerrar lightbox"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    // The backdrop is the element with bg-black/80
    const backdrop = screen.getByRole("dialog").querySelector("[aria-hidden='true']");
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape key is pressed", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates to next item when right arrow key is pressed", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("navigates to previous item when left arrow key is pressed", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={1}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("wraps around from last to first (next)", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={2}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("wraps around from first to last (prev)", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("navigates when clicking next/prev buttons", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText("Contenido siguiente"));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Contenido anterior"));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("shows loading state while blob is being fetched", () => {
    renderWithProviders(
      <ContentLightbox
        items={items}
        initialIndex={0}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });
});
