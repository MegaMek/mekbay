/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

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
