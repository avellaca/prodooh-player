import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusToggle } from './StatusToggle';

describe('StatusToggle', () => {
  it('renders nothing when status is draft', () => {
    const { container } = render(
      <StatusToggle status="draft" onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when status is finished', () => {
    const { container } = render(
      <StatusToggle status="finished" onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a pause button when status is active', () => {
    render(<StatusToggle status="active" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  });

  it('renders a play button when status is paused', () => {
    render(<StatusToggle status="paused" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Activar' })).toBeInTheDocument();
  });

  it('calls onToggle with "paused" when clicking an active status toggle', () => {
    const onToggle = vi.fn();

    render(<StatusToggle status="active" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));

    expect(onToggle).toHaveBeenCalledWith('paused');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggle with "active" when clicking a paused status toggle', () => {
    const onToggle = vi.fn();

    render(<StatusToggle status="paused" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));

    expect(onToggle).toHaveBeenCalledWith('active');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables the button when isLoading is true', () => {
    render(<StatusToggle status="active" onToggle={vi.fn()} isLoading />);
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled();
  });

  it('does not call onToggle when loading and clicked', () => {
    const onToggle = vi.fn();

    render(<StatusToggle status="active" onToggle={onToggle} isLoading />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));

    expect(onToggle).not.toHaveBeenCalled();
  });
});
