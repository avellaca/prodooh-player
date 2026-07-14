/**
 * Main entry point — Auto-boots the player and wires rendering.
 *
 * This file is the actual entry point loaded by index.html in the browser.
 * It calls bootPlayer() with callbacks that drive the FullscreenRenderer,
 * displaying content in #player-root.
 *
 * Works in both:
 * - Raspberry Pi (Chromium kiosk mode)
 * - Developer browser (localStorage shim via esbuild plugin)
 */

import { bootPlayer } from './boot';
import { FullscreenRenderer } from './display/FullscreenRenderer';
import type { ManifestItem } from './sync/ManifestSyncManager';

// ─── Configuration ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'prodooh_db_./player.db';

/** Check if the device is configured (has venue_id in localStorage) */
function isConfigured(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const db = JSON.parse(raw) as Record<string, Array<{ key: string; value: string }>>;
    const config = db['device_config'] ?? [];
    const venueId = config.find((r) => r.key === 'venue_id')?.value;
    return !!venueId && venueId.length > 0;
  } catch {
    return false;
  }
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

/** Show a status/error message on screen */
function showMessage(root: HTMLElement, title: string, subtitle: string): void {
  root.innerHTML = '';
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.flexDirection = 'column';
  root.style.background = '#1a1a2e';
  root.style.color = '#eee';
  root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const h1 = document.createElement('h1');
  h1.textContent = title;
  h1.style.fontSize = '2rem';
  h1.style.marginBottom = '0.5rem';

  const p = document.createElement('p');
  p.textContent = subtitle;
  p.style.fontSize = '1rem';
  p.style.color = '#888';

  root.appendChild(h1);
  root.appendChild(p);
}

/** Reset root element styles for player display */
function resetRootForPlayer(root: HTMLElement): void {
  root.innerHTML = '';
  root.style.display = '';
  root.style.alignItems = '';
  root.style.justifyContent = '';
  root.style.flexDirection = '';
  root.style.background = '#000';
  root.style.color = '';
  root.style.fontFamily = '';
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = document.getElementById('player-root');
  if (!root) {
    console.error('[main] #player-root not found in DOM');
    return;
  }

  // Check if device is configured
  if (!isConfigured()) {
    showMessage(root, '⚙️ Player no configurado', 'Redirigiendo a setup...');
    console.warn('[main] Device not configured. Redirecting to setup...');
    setTimeout(() => {
      window.location.href = './setup.html';
    }, 2000);
    return;
  }

  // Show loading state
  showMessage(root, '⏳ Iniciando...', 'Conectando con el backend y sincronizando playlist...');

  try {
    // Prepare the renderer (created after boot succeeds)
    let renderer: FullscreenRenderer | null = null;

    const result = await bootPlayer({
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    });

    if (!result.success) {
      showMessage(root, '❌ Error de inicio', result.error ?? 'No se pudo iniciar el engine');
      return;
    }

    console.log(`[main] Boot OK. Mode: ${result.mode}`);

    // Set up the renderer
    resetRootForPlayer(root);
    renderer = new FullscreenRenderer(root, { type: 'cut', durationMs: 0 });

    // Start the ManifestEngine with renderer wired
    if (result.manifestEngine && result.manifestSyncManager) {
      const syncMgr = result.manifestSyncManager;

      // Wire onItemStart to display content via the renderer
      result.manifestEngine.onItemStartCallback = (item) => {
        if (!renderer) return;
        if (!item.asset_url) return; // SSP calls without prefetched content

        const localUrl = syncMgr.getLocalUrl(item.asset_url);

        // Determine content type: from sync manager (downloaded assets) or URL extension (SSP)
        const isVideo = syncMgr.isVideo(item.asset_url) ||
          /\.(mp4|webm|ogg|mov|mpeg|mpg)(\?.*)?$/i.test(item.asset_url);

        renderer.transitionTo({
          id: item.creative_id ?? item.playlist_item_id ?? `pos-${item.position}`,
          type: isVideo ? 'video' : 'image',
          source: item.type === 'playlist_item' ? 'playlist' : 'prodooh',
          mediaUrl: localUrl,
          duration: item.duration_seconds,
          metadata: {
            order_line_id: item.order_line_id,
            position: item.position,
          },
        });
      };

      console.log('[main] Starting ManifestEngine...');
      void result.manifestEngine.run();
    } else {
      showMessage(root, '⏳ Esperando manifiesto', 'El player se activará cuando reciba el manifiesto del backend');
    }

  } catch (error) {
    console.error('[main] Boot failed:', error);
    showMessage(root, '❌ Error fatal', String(error));
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[main] Unhandled error:', err);
});
