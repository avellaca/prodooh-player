import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvailabilityAlertModal } from './AvailabilityAlertModal';
import type { AvailabilityInfo } from '../api';

const mockAvailability: AvailabilityInfo = {
  is_sufficient: false,
  target_spots: 5000,
  available_capacity: 3000,
  saturation_percent: 166.7,
  warning_message: 'El inventario disponible es insuficiente para esta línea.',
};

describe('AvailabilityAlertModal', () => {
  it('renders saturation information when open', () => {
    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={vi.fn()}
        onModify={vi.fn()}
      />,
    );

    expect(screen.getByText('Disponibilidad insuficiente')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('3,000')).toBeInTheDocument();
    expect(screen.getByText('166.7%')).toBeInTheDocument();
    expect(screen.getByText('El inventario disponible es insuficiente para esta línea.')).toBeInTheDocument();
  });

  it('renders "Estoy de acuerdo" and "Modificar" buttons', () => {
    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={vi.fn()}
        onModify={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Estoy de acuerdo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modificar' })).toBeInTheDocument();
  });

  it('calls onConfirm when "Estoy de acuerdo" is clicked', () => {
    const onConfirm = vi.fn();

    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={onConfirm}
        onModify={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Estoy de acuerdo' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onModify when "Modificar" is clicked', () => {
    const onModify = vi.fn();

    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={vi.fn()}
        onModify={onModify}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Modificar' }));
    expect(onModify).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when isConfirming is true', () => {
    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={vi.fn()}
        onModify={vi.fn()}
        isConfirming={true}
      />,
    );

    expect(screen.getByRole('button', { name: 'Activando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Modificar' })).toBeDisabled();
  });

  it('shows default message when warning_message is null', () => {
    const availabilityNoMessage: AvailabilityInfo = {
      ...mockAvailability,
      warning_message: null,
    };

    render(
      <AvailabilityAlertModal
        open={true}
        onOpenChange={vi.fn()}
        availability={availabilityNoMessage}
        onConfirm={vi.fn()}
        onModify={vi.fn()}
      />,
    );

    expect(
      screen.getByText('El inventario disponible podría ser insuficiente para cumplir los spots objetivo de esta línea.'),
    ).toBeInTheDocument();
  });

  it('does not render content when open is false', () => {
    render(
      <AvailabilityAlertModal
        open={false}
        onOpenChange={vi.fn()}
        availability={mockAvailability}
        onConfirm={vi.fn()}
        onModify={vi.fn()}
      />,
    );

    expect(screen.queryByText('Disponibilidad insuficiente')).not.toBeInTheDocument();
  });
});
