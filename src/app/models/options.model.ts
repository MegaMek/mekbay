// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from "./common.model";
import type { PrintAllOptions } from "./print-options.model";


export const OPTION_VALUES = {
    colorScheme: ['default', 'night'],
    pickerStyle: ['default', 'radial', 'linear'],
    canvasInput: ['all', 'touch', 'pen'],
    swipeToNextSheet: ['vertical', 'horizontal', 'disabled'],
    unitDisplayName: ['chassisModel', 'alias', 'both'],
    gameSystem: [GameSystem.CLASSIC, GameSystem.ALPHA_STRIKE],
    availabilitySource: ['mul', 'megamek'],
    forceViewerBVPVDisplay: ['adjusted', 'base', 'both'],
    recordSheetDoubleTapZoomReset: ['disabled', 'fit-to-screen', 'full-width', 'contextual'],
    CBTRules: ['tw', 'core2026'],
    unitSearchExpandedViewLayout: ['panel-list-filters', 'filters-list-panel'],
    unitSearchViewMode: ['list', 'card', 'chassis', 'table'],
    forceOverviewViewMode: ['expanded', 'compact', 'table'],
    ASVehiclesCriticalHitTable: ['default', 'scouringSands'],
    automationMode: ['yes', 'ask', 'no'],
} as const;

export type AvailabilitySource = typeof OPTION_VALUES.availabilitySource[number];
export type RecordSheetDoubleTapZoomResetMode = typeof OPTION_VALUES.recordSheetDoubleTapZoomReset[number];
export type ColorScheme = typeof OPTION_VALUES.colorScheme[number];
export type UnitSearchViewMode = typeof OPTION_VALUES.unitSearchViewMode[number];
export type AutomationMode = typeof OPTION_VALUES.automationMode[number];

export const CBT_AUTOMATION_KEYS = [
    'pilotSkillCheck',
    'heatAndDissipationResolution',
    'heatEffectsCheck',
    'pilotHitsAndConsciousnessCheck',
    'internalExplosionsCheck',
    'criticalHitChanceCheck',
    'breachAndFloodCheck',
    'fallingCheck',
] as const;

export type CBTAutomationKey = typeof CBT_AUTOMATION_KEYS[number];
export type CBTAutomationOptions = Record<CBTAutomationKey, AutomationMode>;

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
    ignoreRarityWeight: boolean;
    preventDuplicateChassis: boolean;
    useTaggedQuantities: boolean;
    useUnitTagsAsChassisTags: boolean;
}

export type ForceViewerBVPVDisplay = typeof OPTION_VALUES.forceViewerBVPVDisplay[number];

export interface CBTOptionalRules {
    floatingCriticals: boolean;
    forcedWithdrawal: boolean;
    extremeRange: boolean;
    sprinting: boolean;
}

export interface Options {
    colorScheme: ColorScheme;
    pickerStyle: typeof OPTION_VALUES.pickerStyle[number];
    canvasInput: typeof OPTION_VALUES.canvasInput[number];
    swipeToNextSheet: typeof OPTION_VALUES.swipeToNextSheet[number];
    syncZoomBetweenSheets: boolean;
    unitDisplayName: typeof OPTION_VALUES.unitDisplayName[number];
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    megaMekAvailabilityFiltersUseAllScopedOptions: boolean;
    forceViewerBVPVDisplay: ForceViewerBVPVDisplay;
    printAllOptions: PrintAllOptions;
    recordSheetDoubleTapZoomReset: RecordSheetDoubleTapZoomResetMode;
    lastCanvasState?: {
        brushSize: number;
        eraserSize: number;
    },
    sidebarLipPosition?: string;
    trackPhaseAndTurn: boolean;
    cbtAutomationOptions: CBTAutomationOptions;
    CBTOptionalRules: CBTOptionalRules;
    CBTRules: typeof OPTION_VALUES.CBTRules[number];
    ASUseHex: boolean;
    c3NetworkConnectionsAboveNodes: boolean;
    automaticallyConvertFiltersToSemantic: boolean;
    allowMultipleActiveSheets: boolean;
    unitSearchExpandedViewLayout: typeof OPTION_VALUES.unitSearchExpandedViewLayout[number];
    showFilteredComponents: boolean;
    unitSearchViewMode: UnitSearchViewMode;
    forceOverviewViewMode: typeof OPTION_VALUES.forceOverviewViewMode[number];
    ASUseAutomations: boolean;
    ASVehiclesCriticalHitTable: typeof OPTION_VALUES.ASVehiclesCriticalHitTable[number];
    ASUnifiedDamagePicker: boolean;
    performanceMode: boolean;
    enableForceSyncConflictDialog: boolean;

    // Additional user-supplied unit database servers (base URLs). db.mekbay.com is always
    // the primary source; these servers may only contribute additional (new-named) units,
    // their record-sheet SVGs, and their unit fluff art.
    unitServers: string[];

    // Force Generator
    forceGenerator: ForceGeneratorOptions;

    // Force Budget Optimizer
    forceBudgetOptimizerLastSkills: ForceBudgetOptimizerLastSkills;
}
