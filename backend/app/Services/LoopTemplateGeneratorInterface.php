<?php

namespace App\Services;

use App\Models\Screen;
use App\Models\ScreenManifest;

interface LoopTemplateGeneratorInterface
{
    /**
     * Genera el Loop Template completo para una pantalla.
     * Resuelve num_slots por herencia, ejecuta SlotAllocator,
     * aplica RotationScheduler, y persiste en screen_manifests.
     */
    public function generate(Screen $screen): ScreenManifest;

    /**
     * Regenera templates para todas las pantallas afectadas por un cambio.
     * Debe completar en < 30 segundos.
     */
    public function regenerateAffected(array $screenIds): void;

    /**
     * Resuelve num_slots efectivo por herencia: Screen → ScreenGroup → Tenant → 10.
     */
    public function resolveNumSlots(Screen $screen): int;
}
