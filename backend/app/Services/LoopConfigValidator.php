<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

class LoopConfigValidator
{
    /**
     * Validate loop configuration values and calculate ad_slots.
     *
     * @param array $config Configuration array with keys:
     *   - num_slots (required): int [1, 100]
     *   - ssp_slots (required): int [0, num_slots]
     *   - playlist_slots (required): int [0, num_slots]
     *   - sync_interval_seconds (optional): int [30, 900]
     *   - cache_flush_interval_hours (optional): int [1, 720]
     *
     * @return array{is_valid: bool, errors: array, ad_slots: int|null}
     *
     * @throws ValidationException when validation fails
     */
    public function validate(array $config): array
    {
        $errors = [];

        // Validate num_slots: required, integer, [1, 100]
        if (!array_key_exists('num_slots', $config)) {
            $errors['num_slots'][] = 'El campo num_slots es obligatorio.';
        } elseif (!is_int($config['num_slots'])) {
            $errors['num_slots'][] = 'El campo num_slots debe ser un entero.';
        } elseif ($config['num_slots'] < 1 || $config['num_slots'] > 100) {
            $errors['num_slots'][] = 'El campo num_slots debe estar entre 1 y 100.';
        }

        $numSlots = is_int($config['num_slots'] ?? null) ? $config['num_slots'] : null;

        // Validate ssp_slots: required, integer, [0, num_slots]
        if (!array_key_exists('ssp_slots', $config)) {
            $errors['ssp_slots'][] = 'El campo ssp_slots es obligatorio.';
        } elseif (!is_int($config['ssp_slots'])) {
            $errors['ssp_slots'][] = 'El campo ssp_slots debe ser un entero.';
        } elseif ($config['ssp_slots'] < 0) {
            $errors['ssp_slots'][] = 'El campo ssp_slots debe ser mayor o igual a 0.';
        } elseif ($numSlots !== null && $config['ssp_slots'] > $numSlots) {
            $errors['ssp_slots'][] = 'El campo ssp_slots no puede ser mayor que num_slots.';
        }

        // Validate playlist_slots: required, integer, [0, num_slots]
        if (!array_key_exists('playlist_slots', $config)) {
            $errors['playlist_slots'][] = 'El campo playlist_slots es obligatorio.';
        } elseif (!is_int($config['playlist_slots'])) {
            $errors['playlist_slots'][] = 'El campo playlist_slots debe ser un entero.';
        } elseif ($config['playlist_slots'] < 0) {
            $errors['playlist_slots'][] = 'El campo playlist_slots debe ser mayor o igual a 0.';
        } elseif ($numSlots !== null && $config['playlist_slots'] > $numSlots) {
            $errors['playlist_slots'][] = 'El campo playlist_slots no puede ser mayor que num_slots.';
        }

        // Validate sync_interval_seconds: optional, integer, [30, 900]
        if (array_key_exists('sync_interval_seconds', $config)) {
            if (!is_int($config['sync_interval_seconds'])) {
                $errors['sync_interval_seconds'][] = 'El campo sync_interval_seconds debe ser un entero.';
            } elseif ($config['sync_interval_seconds'] < 30 || $config['sync_interval_seconds'] > 900) {
                $errors['sync_interval_seconds'][] = 'El campo sync_interval_seconds debe estar entre 30 y 900.';
            }
        }

        // Validate cache_flush_interval_hours: optional, integer, [1, 720]
        if (array_key_exists('cache_flush_interval_hours', $config)) {
            if (!is_int($config['cache_flush_interval_hours'])) {
                $errors['cache_flush_interval_hours'][] = 'El campo cache_flush_interval_hours debe ser un entero.';
            } elseif ($config['cache_flush_interval_hours'] < 1 || $config['cache_flush_interval_hours'] > 720) {
                $errors['cache_flush_interval_hours'][] = 'El campo cache_flush_interval_hours debe estar entre 1 y 720.';
            }
        }

        // If there are field-level errors, throw before checking cross-field constraints
        if (!empty($errors)) {
            throw ValidationException::withMessages($errors);
        }

        // Cross-field constraint: ssp_slots + playlist_slots < num_slots (at least 1 ad_slot)
        $adSlots = $config['num_slots'] - $config['ssp_slots'] - $config['playlist_slots'];

        if ($adSlots < 1) {
            $errors['num_slots'][] = 'Debe quedar al menos 1 ad_slot. Actualmente ssp_slots + playlist_slots >= num_slots.';
            throw ValidationException::withMessages($errors);
        }

        return [
            'is_valid' => true,
            'errors' => [],
            'ad_slots' => $adSlots,
        ];
    }

    /**
     * Calculate ad_slots from valid configuration values.
     * Does NOT validate — assumes input has already been validated.
     *
     * @param int $numSlots
     * @param int $sspSlots
     * @param int $playlistSlots
     * @return int
     */
    public function calculateAdSlots(int $numSlots, int $sspSlots, int $playlistSlots): int
    {
        return $numSlots - $sspSlots - $playlistSlots;
    }
}
