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
    gameSystem: [GameSystem.CBT, GameSystem.AS],
    availabilitySource: ['mul', 'megamek'],
    forceViewerBVPVDisplay: ['adjusted', 'base', 'both'],
    forceViewerBVPVDisplayDamage: ['damaged', 'pristine'],
    recordSheetDoubleTapZoomReset: ['disabled', 'fit-to-screen', 'full-width', 'contextual'],
    unitSearchExpandedViewLayout: ['panel-list-filters', 'filters-list-panel'],
    unitSearchViewMode: ['list', 'card', 'chassis', 'table'],
    forceOverviewViewMode: ['expanded', 'compact', 'table'],
    cbtUnitViewMode: ['sheet', 'tactical'],
    ASVehiclesCriticalHitTable: ['default', 'scouringSands'],
    automationMode: ['yes', 'ask', 'no'],
} as const;

type OptionValue<K extends keyof typeof OPTION_VALUES> = (typeof OPTION_VALUES)[K][number];

export type AvailabilitySource = OptionValue<'availabilitySource'>;
export type RecordSheetDoubleTapZoomResetMode = OptionValue<'recordSheetDoubleTapZoomReset'>;
export type ColorScheme = OptionValue<'colorScheme'>;
export type UnitSearchViewMode = OptionValue<'unitSearchViewMode'>;
export type AutomationMode = OptionValue<'automationMode'>;
export type CBTUnitViewMode = OptionValue<'cbtUnitViewMode'>;

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

export type ForceViewerBVPVDisplay = OptionValue<'forceViewerBVPVDisplay'>;
export type ForceViewerBVPVDisplayDamage = OptionValue<'forceViewerBVPVDisplayDamage'>;

export interface CBTOptionalRules {
    floatingCriticals: boolean;
    forcedWithdrawal: boolean;
    extremeRange: boolean;
    sprinting: boolean;
}

export interface Options {
    colorScheme: ColorScheme;
    pickerStyle: OptionValue<'pickerStyle'>;
    canvasInput: OptionValue<'canvasInput'>;
    swipeToNextSheet: OptionValue<'swipeToNextSheet'>;
    syncZoomBetweenSheets: boolean;
    unitDisplayName: OptionValue<'unitDisplayName'>;
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    megaMekAvailabilityFiltersUseAllScopedOptions: boolean;
    forceViewerBVPVDisplay: ForceViewerBVPVDisplay;
    forceViewerBVPVDisplayDamage: ForceViewerBVPVDisplayDamage;
    printAllOptions: PrintAllOptions;
    recordSheetDoubleTapZoomReset: RecordSheetDoubleTapZoomResetMode;
    lastCanvasState?: {
        brushSize: number;
        eraserSize: number;
    },
    sidebarLipPosition?: string;
    trackPhaseAndTurn: boolean;
    cbtUnitViewMode: CBTUnitViewMode;
    cbtAutomationOptions: CBTAutomationOptions;
    CBTOptionalRules: CBTOptionalRules;
    CBTRules: CBTRuleset;
    ASUseHex: boolean;
    c3NetworkConnectionsAboveNodes: boolean;
    automaticallyConvertFiltersToSemantic: boolean;
    allowMultipleActiveSheets: boolean;
    unitSearchExpandedViewLayout: OptionValue<'unitSearchExpandedViewLayout'>;
    showFilteredComponents: boolean;
    unitSearchViewMode: UnitSearchViewMode;
    forceOverviewViewMode: OptionValue<'forceOverviewViewMode'>;
    ASUseAutomations: boolean;
    ASVehiclesCriticalHitTable: OptionValue<'ASVehiclesCriticalHitTable'>;
    ASUnifiedDamagePicker: boolean;
    performanceMode: boolean;
    enableForceSyncConflictDialog: boolean;

    // Force Generator
    forceGenerator: ForceGeneratorOptions;

    // Force Budget Optimizer
    forceBudgetOptimizerLastSkills: ForceBudgetOptimizerLastSkills;
}
