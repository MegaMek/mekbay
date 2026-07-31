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
export type RecordSheetDoubleTapZoomResetMode = 'disabled' | 'fit-to-screen' | 'full-width' | 'contextual';
export type ColorScheme = 'default' | 'night';
export type UnitSearchViewMode = 'list' | 'card' | 'chassis' | 'table';

export interface SkillRangeOption {
    min: number;
    max: number;
}

export interface ForceBudgetOptimizerLastSkills {
    gunnery: SkillRangeOption;
    piloting: SkillRangeOption;
    skill: SkillRangeOption;
    maxDelta: number;
}

export interface ForceGeneratorOptions {
    lastBudget: {
        classic: SkillRangeOption;
        alphaStrike: SkillRangeOption;
    };
    lastUnitCount: SkillRangeOption;
    lastSkills: {
        gunnery: SkillRangeOption;
        piloting: SkillRangeOption;
        maxDelta: number;
    };
    failureSearchWindowMs: number;
    preventDuplicateChassis: boolean;
    useTaggedQuantities: boolean;
    useUnitTagsAsChassisTags: boolean;
}

export type ForceViewerBVPVDisplay = 'adjusted' | 'base' | 'both';

export interface Options {
    colorScheme: ColorScheme;
    pickerStyle: 'default' | 'radial' | 'linear';
    canvasInput: 'all' | 'touch' | 'pen';
    swipeToNextSheet: 'vertical' | 'horizontal' | 'disabled';
    syncZoomBetweenSheets: boolean;
    unitDisplayName: 'chassisModel' | 'alias' | 'both';
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    megaMekAvailabilityFiltersUseAllScopedOptions: boolean;
    forceViewerBVPVDisplay: ForceViewerBVPVDisplay;
    recordSheetCenterPanelContent: 'fluffImage' | 'clusterTable';
    recordSheetDoubleTapZoomReset: RecordSheetDoubleTapZoomResetMode;
    lastCanvasState?: {
        brushSize: number;
        eraserSize: number;
    },
    sidebarLipPosition?: string;
    trackPhaseAndTurn: boolean;
    cbtAutomations: boolean;
    CBTExtremeRange: boolean;
    CBTRules: 'tw' | `core2026`;
    ASUseHex: boolean;
    ASPrintPageBreakOnGroups: boolean;
    c3NetworkConnectionsAboveNodes: boolean;
    automaticallyConvertFiltersToSemantic: boolean;
    allowMultipleActiveSheets: boolean;
    unitSearchExpandedViewLayout: 'panel-list-filters' | 'filters-list-panel';
    showFilteredComponents: boolean;
    unitSearchViewMode: UnitSearchViewMode;
    forceOverviewViewMode: 'expanded' | 'compact' | 'table';
    ASUseAutomations: boolean;
    ASVehiclesCriticalHitTable: 'default' | 'scouringSands';
    ASUnifiedDamagePicker: boolean;
    printRosterSummary: boolean;
    printMargin: 'none' | 'browserDefined';
    performanceMode: boolean;

    // Additional user-supplied unit database servers (base URLs). db.mekbay.com is always
    // the primary source; these servers may only contribute additional (new-named) units,
    // their record-sheet SVGs, and their unit fluff art.
    unitServers: string[];

    // Force Generator
    forceGenerator: ForceGeneratorOptions;

    // Force Budget Optimizer
    forceBudgetOptimizerLastSkills: ForceBudgetOptimizerLastSkills;
}