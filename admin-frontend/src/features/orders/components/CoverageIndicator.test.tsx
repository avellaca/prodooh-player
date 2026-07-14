import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageIndicator } from './CoverageIndicator';

describe('CoverageIndicator', () => {
  it('shows "Completo" with check icon when all screens have creatives', () => {
    render(<CoverageIndicator coverage={{ with_creative: 5, total: 5 }} />);
    expect(screen.getByText('Completo')).toBeInTheDocument();
  });

  it('shows warning with count when some screens lack creatives', () => {
    render(<CoverageIndicator coverage={{ with_creative: 3, total: 5 }} />);
    expect(screen.getByText('3 de 5 pantallas con creativo')).toBeInTheDocument();
  });

  it('shows warning when no screens have creatives', () => {
    render(<CoverageIndicator coverage={{ with_creative: 0, total: 10 }} />);
    expect(screen.getByText('0 de 10 pantallas con creativo')).toBeInTheDocument();
  });

  it('shows "Completo" when coverage is 1/1', () => {
    render(<CoverageIndicator coverage={{ with_creative: 1, total: 1 }} />);
    expect(screen.getByText('Completo')).toBeInTheDocument();
  });
});
