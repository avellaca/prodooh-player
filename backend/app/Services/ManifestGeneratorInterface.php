<?php

namespace App\Services;

use App\Models\Screen;
use App\Models\ScreenManifest;

interface ManifestGeneratorInterface
{
    /**
     * Generate the complete manifest from the interleaver sequence.
     *
     * @param Screen $screen The screen to generate the manifest for
     * @param array<array{position: int, order_line_id: string}> $sequence Output from BresenhamInterleaver
     * @param int $sspSlots Number of SSP slots to insert
     * @param int $playlistSlots Number of playlist slots to insert
     * @return ScreenManifest The persisted manifest
     */
    public function generate(Screen $screen, array $sequence, int $sspSlots, int $playlistSlots): ScreenManifest;

    /**
     * Compute a deterministic version hash from the manifest items.
     *
     * @param array $items The array of manifest items
     * @return string SHA-256 hash of the serialized items
     */
    public function computeVersion(array $items): string;
}
