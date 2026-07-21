import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DurationWarningBadge } from './DurationWarningBadge';

describe('DurationWarningBadge', () => {
  it('renders nothing when content is null', () => {
    const { container } = render(
      <DurationWarningBadge content={null} slotDurationSeconds={10} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when content is undefined', () => {
    const { container } = render(
      <DurationWarningBadge content={undefined} slotDurationSeconds={10} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for image content', () => {
    const content = { duration_seconds: 20, mime_type: 'image/png' };
    const { container } = render(
      <DurationWarningBadge content={content} slotDurationSeconds={10} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when video duration is within slot', () => {
    const content = { duration_seconds: 8, mime_type: 'video/mp4' };
    const { container } = render(
      <DurationWarningBadge content={content} slotDurationSeconds={10} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders warning badge when video exceeds slot duration', () => {
    const content = { duration_seconds: 15, mime_type: 'video/mp4' };
    render(
      <DurationWarningBadge content={content} slotDurationSeconds={10} />
    );
    const badge = screen.getByTitle('Video de 15s excede el slot de 10s');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('15s');
    expect(badge.textContent).toContain('10s');
  });

  it('uses default 10s slot when slotDurationSeconds not provided', () => {
    const content = { duration_seconds: 12, mime_type: 'video/mp4' };
    render(<DurationWarningBadge content={content} />);
    const badge = screen.getByTitle('Video de 12s excede el slot de 10s');
    expect(badge).toBeInTheDocument();
  });

  it('renders nothing when video duration equals slot', () => {
    const content = { duration_seconds: 10, mime_type: 'video/mp4' };
    const { container } = render(
      <DurationWarningBadge content={content} slotDurationSeconds={10} />
    );
    expect(container.innerHTML).toBe('');
  });
});
