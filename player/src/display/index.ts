/**
 * Display module — Rendering and transition components.
 */
export {
  TransitionAnimator,
  validateTransitionConfig,
  isValidTransitionType,
  clampDuration,
  DEFAULT_TRANSITION_CONFIG,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
} from './TransitionAnimator';
export type { TransitionType, TransitionConfig } from './TransitionAnimator';

export { FullscreenRenderer } from './FullscreenRenderer';

export {
  ImageRenderer,
  isValidRotation,
  normalizeRotation,
} from './ImageRenderer';
export type { RotationDegrees, ImageRendererConfig } from './ImageRenderer';

export { VideoRenderer } from './VideoRenderer';
export type { VideoRendererConfig, VideoRenderOptions } from './VideoRenderer';

export { WebviewRenderer } from './WebviewRenderer';
export type { WebviewRendererConfig, WebviewLoadResult } from './WebviewRenderer';
