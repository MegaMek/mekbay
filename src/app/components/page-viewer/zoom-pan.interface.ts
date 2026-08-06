// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { InjectionToken } from '@angular/core';

/**
 * Minimal interface for zoom-pan services that need to work with SvgInteractionService.
 * Both SvgZoomPanService and PageViewerZoomPanService implement this interface.
 */
export interface ZoomPanServiceInterface {
    /** Whether the pointer has moved during the current gesture */
    pointerMoved: boolean;
    /** Whether a pan gesture is currently active */
    isPanning: boolean;
    /** Cancel any in-progress pan, swipe, or pinch gesture */
    cancelGesture(): void;
}

/**
 * Full interface for zoom-pan services that need to work with overlay components.
 * Provides access to transform state for positioning overlays.
 */
export interface ZoomPanStateInterface {
    /** Get the current transform state for positioning overlays */
    getState(): {
        scale: () => number;
        translate: () => { x: number; y: number };
    };
}

/**
 * Injection token for providing a zoom-pan service that implements ZoomPanServiceInterface.
 */
export const ZOOM_PAN_SERVICE = new InjectionToken<ZoomPanServiceInterface>('ZoomPanService');

/**
 * Injection token for providing a zoom-pan service with full state access.
 */
export const ZOOM_PAN_STATE_SERVICE = new InjectionToken<ZoomPanStateInterface>('ZoomPanStateService');
