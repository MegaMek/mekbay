// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from "./common.model";
import type { CBTRuleset } from './cbt-ruleset.model';
import type { PrintAllOptions } from './print-options.model';

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
    unitSearchExpandedViewLayout: ['panel-list-filters', 'filters-list-panel'],
    unitSearchViewMode: ['list', 'card', 'chassis', 'table'],
    forceOverviewViewMode: ['expanded', 'compact', 'table'],
    ASVehiclesCriticalHitTable: ['default', 'scouringSands'],
    automationMode: ['yes', 'ask', 'no'],
} as const;


export type AvailabilitySource = 'mul' | 'megamek';
export type RecordSheetDoubleTapZoomResetMode = 'disabled' | 'fit-to-screen' | 'full-width' | 'contextual';
export type ColorScheme = 'default' | 'night';
export type UnitSearchViewMode = 'list' | 'card' | 'chassis' | 'table';
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

export type ForceViewerBVPVDisplay = 'adjusted' | 'base' | 'both';

export interface CBTOptionalRules {
    floatingCriticals: boolean;
    forcedWithdrawal: boolean;
    extremeRange: boolean;
    sprinting: boolean;
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
    CBTRules: CBTRuleset;
    ASUseHex: boolean;
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
    performanceMode: boolean;
    enableForceSyncConflictDialog: boolean;

    // Force Generator
    forceGenerator: ForceGeneratorOptions;

    // Force Budget Optimizer
    forceBudgetOptimizerLastSkills: ForceBudgetOptimizerLastSkills;
}
