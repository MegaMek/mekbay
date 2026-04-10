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

import type { GameSystem } from "./common.model";

/*
 * Author: Drake
 */
export type AvailabilitySource = 'mul' | 'megamek';

export interface Options {
    sheetsColor: 'normal' | 'night';
    pickerStyle: 'default' | 'radial' | 'linear';
    quickActions: 'enabled' | 'disabled';
    canvasInput: 'all' | 'touch' | 'pen';
    swipeToNextSheet: 'vertical' | 'horizontal' | 'disabled';
    syncZoomBetweenSheets: boolean;
    unitDisplayName: 'chassisModel' | 'alias' | 'both';
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    recordSheetCenterPanelContent: 'fluffImage' | 'clusterTable';
    lastCanvasState?: {
        brushSize: number;
        eraserSize: number;
    },
    sidebarLipPosition?: string;
    useAutomations: boolean;
    ASUseHex: boolean;
    ASCardStyle: 'colored' | 'monochrome';
    ASPrintPageBreakOnGroups: boolean;
    c3NetworkConnectionsAboveNodes: boolean;
    automaticallyConvertFiltersToSemantic: boolean;
    allowMultipleActiveSheets: boolean;
    unitSearchExpandedViewLayout: 'panel-list-filters' | 'filters-list-panel';
    unitSearchViewMode: 'list' | 'card' | 'chassis' | 'table';
    forceOverviewViewMode: 'expanded' | 'compact' | 'table';
    ASUseAutomations: boolean;
    ASVehiclesCriticalHitTable: 'default' | 'scouringSands';
    ASUnifiedDamagePicker: boolean;
    printRosterSummary: boolean;
    printMargin: 'none' | 'browserDefined';

    // Force Generator
    forceGenLastBVMin: number;
    forceGenLastBVMax: number;
    forceGenLastPVMin: number;
    forceGenLastPVMax: number;
    forceGenLastMinUnitCount: number;
    forceGenLastMaxUnitCount: number;
}