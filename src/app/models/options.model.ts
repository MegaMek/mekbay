// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from "./common.model";
import type { CBTRuleset } from './cbt-ruleset.model';
import type { PrintAllOptions } from './print-options.model';
import { INITIATIVE_ORDER_MODES, type InitiativeOrderMode } from './rules/initiative-rules';

export const OPTION_VALUES = {
    colorScheme: ['default', 'night'],
    pickerStyle: ['default', 'radial', 'linear'],
    canvasInput: ['all', 'touch', 'pen'],
    mouseWheelAction: ['scroll', 'zoom'],
    swipeToNextSheet: ['vertical', 'horizontal', 'disabled'],
    unitDisplayName: ['chassisModel', 'alias', 'both'],
    displayUnitNameFormat: ['innerSphereClan', 'clanInnerSphere', 'innerSphereOnly', 'clanOnly'],
    gameSystem: [GameSystem.CBT, GameSystem.AS],
    availabilitySource: ['mul', 'megamek'],
    forceViewerBVPVDisplay: ['adjustedPostSkill', 'adjustedPreSkill', 'both'],
    forceViewerBVPVDisplayDamage: ['damaged', 'pristine'],
    recordSheetDoubleTapZoomReset: ['disabled', 'fit-to-screen', 'full-width', 'contextual'],
    recordSheetPipLayout: ['classic', 'distributed', 'rail'],
    unitSearchExpandedViewLayout: ['panel-list-filters', 'filters-list-panel'],
    unitSearchViewMode: ['list', 'card', 'chassis', 'table'],
    factionAvailabilityViewMode: ['list', 'grid'],
    forceOverviewViewMode: ['expanded', 'compact', 'table'],
    cbtUnitViewMode: ['sheet', 'tactical'],
    ASVehiclesCriticalHitTable: ['default', 'scouringSands'],
    automationMode: ['yes', 'ask', 'no'],
    initiativeOrder: INITIATIVE_ORDER_MODES,
} as const;

/** The Unequal Numbers order choices, shared by the options and lobby dialogs. Only Total Warfare games use them. */
export const INITIATIVE_ORDER_CHOICES: readonly { readonly value: InitiativeOrderMode; readonly label: string; readonly hint: string }[] = [
    { value: 'rules', label: 'By the rules', hint: 'Total Warfare: extra units act last' },
    { value: 'front-loaded', label: 'Front-loaded', hint: 'extra units act first' },
    { value: 'back-loaded', label: 'Back-loaded', hint: 'extra units act last' },
    { value: 'spread', label: 'Spread evenly', hint: 'extra units spread over the phase' },
];

type OptionValue<K extends keyof typeof OPTION_VALUES> = (typeof OPTION_VALUES)[K][number];

export type MouseWheelAction = OptionValue<'mouseWheelAction'>;
export type AvailabilitySource = OptionValue<'availabilitySource'>;
export type RecordSheetDoubleTapZoomResetMode = OptionValue<'recordSheetDoubleTapZoomReset'>;
export type RecordSheetPipLayout = OptionValue<'recordSheetPipLayout'>;
export type ColorScheme = OptionValue<'colorScheme'>;
export type UnitSearchViewMode = OptionValue<'unitSearchViewMode'>;
export type AutomationMode = OptionValue<'automationMode'>;
export type CBTUnitViewMode = OptionValue<'cbtUnitViewMode'>;
export type DisplayUnitNameFormat = OptionValue<'displayUnitNameFormat'>;

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
    quirks: boolean;
    floatingCriticals: boolean;
    forcedWithdrawal: boolean;
    extremeRange: boolean;
    sprinting: boolean;
    hotLoadedAmmo: boolean;
    allowMixedTechBaseAmmo: boolean;
}

export interface Options {
    colorScheme: ColorScheme;
    pickerStyle: OptionValue<'pickerStyle'>;
    canvasInput: OptionValue<'canvasInput'>;
    mouseWheelAction: MouseWheelAction;
    swipeToNextSheet: OptionValue<'swipeToNextSheet'>;
    syncZoomBetweenSheets: boolean;
    unitDisplayName: OptionValue<'unitDisplayName'>;
    displayUnitNameFormat: DisplayUnitNameFormat;
    gameSystem: GameSystem;
    availabilitySource: AvailabilitySource;
    megaMekAvailabilityFiltersUseAllScopedOptions: boolean;
    forceViewerBVPVDisplay: ForceViewerBVPVDisplay;
    forceViewerBVPVDisplayDamage: ForceViewerBVPVDisplayDamage;
    printAllOptions: PrintAllOptions;
    recordSheetDoubleTapZoomReset: RecordSheetDoubleTapZoomResetMode;
    recordSheetPipLayout: RecordSheetPipLayout;
    lastCanvasState?: {
        brushSize: number;
        eraserSize: number;
    },
    sidebarLipPosition?: string;
    trackPhaseAndTurn: boolean;
    /** Units share a real turn/phase clock and advance step by step (requires trackPhaseAndTurn). */
    realPhases: boolean;
    /** Firing opens the attack resolution dialog, which can send the hits to the target's owner. */
    attackResolution: boolean;
    /** How a side with more units spreads them over a phase (Total Warfare only; Core fixes it). */
    initiativeOrder: InitiativeOrderMode;
    /** The optional Initiative Die (Core p.39): a losing side gains +1 per consecutive loss, up to +6. */
    initiativeDie: boolean;
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
    factionAvailabilityViewMode: OptionValue<'factionAvailabilityViewMode'>;
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
