// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { GameSystem } from "./common.model";


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

export interface CBTOptionalRules {
    forcedWithdrawal: boolean;
    extremeRange: boolean;
}

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
    CBTOptionalRules: CBTOptionalRules;
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