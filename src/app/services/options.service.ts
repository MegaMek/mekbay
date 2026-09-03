// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable, signal } from '@angular/core';
import { DbService } from './db.service';
import { CBT_AUTOMATION_KEYS, OPTION_VALUES, type AutomationMode, type CBTAutomationKey, type CBTAutomationOptions, type CBTOptionalRules, type ColorScheme, type ForceBudgetOptimizerLastSkills, type ForceGeneratorOptions, type Options } from '../models/options.model';
import { PRINT_OPTION_VALUES, type PrintAllOptions } from '../models/print-options.model';
import { GameSystem, normalizeUnitServerUrl } from '../models/common.model';



const DEFAULT_OPTIONS: Options = {
    canvasInput: 'all',
    unitDisplayName: 'both',
    gameSystem: GameSystem.CLASSIC,
    availabilitySource: 'mul',
    forceViewerBVPVDisplay: 'adjusted',
    megaMekAvailabilityFiltersUseAllScopedOptions: true,
    c3NetworkConnectionsAboveNodes: false,
    automaticallyConvertFiltersToSemantic: false,
    unitSearchExpandedViewLayout: 'panel-list-filters',
    showFilteredComponents: false,
    unitSearchViewMode: 'list',
    forceOverviewViewMode: 'compact',
    printAllOptions: {
        clean: false,
        printPilotData: true,
        recordSheetCenterPanelContent: 'clusterTable',
        ASPrintPageBreakOnGroups: true,
        ASPrintCardSize: 'standard',
        printMargin: 'browserDefined',
    },
    performanceMode: false,
    enableForceSyncConflictDialog: false,
    unitServers: [],

    // Theme
    colorScheme: 'default',
    pickerStyle: 'default',
    swipeToNextSheet: 'horizontal',
    recordSheetDoubleTapZoomReset: 'contextual',
    syncZoomBetweenSheets: true,
    trackPhaseAndTurn: true,
    cbtAutomationOptions: {
        pilotSkillCheck: 'no',
        heatAndDissipationResolution: 'no',
        heatEffectsCheck: 'no',
        pilotHitsAndConsciousnessCheck: 'no',
        internalExplosionsCheck: 'ask',
        criticalHitChanceCheck: 'no',
        breachAndFloodCheck: 'no',
        fallingCheck: 'no',
    },
    CBTOptionalRules: {
        floatingCriticals: false,
        forcedWithdrawal: true,
        extremeRange: false,
        sprinting: false,
        allowMixedTechBaseAmmo: false,
    },
    allowMultipleActiveSheets: false,
    CBTRules: 'tw',

    // Alpha Strike
    ASUseHex: false,
    ASUseAutomations: true,
    ASVehiclesCriticalHitTable: 'default',
    ASUnifiedDamagePicker: true,
    forceGenerator: {
        lastBudget: {
            classic: { min: 7900, max: 8000 },
            alphaStrike: { min: 290, max: 300 },
        },
        lastUnitCount: { min: 4, max: 8 },
        lastSkills: {
            gunnery: { min: 4, max: 4 },
            piloting: { min: 5, max: 5 },
            maxDelta: 2,
        },
        failureSearchWindowMs: 300,
        ignoreRarityWeight: false,
        preventDuplicateChassis: false,
        useTaggedQuantities: false,
        useUnitTagsAsChassisTags: false,
    },
    forceBudgetOptimizerLastSkills: {
        gunnery: { min: 2, max: 4 },
        piloting: { min: 3, max: 5 },
        skill: { min: 2, max: 5 },
        maxDelta: 2,
    },
};

function resolveSavedValue<T extends string | number | boolean>(
    saved: unknown,
    fallback: T,
    validValues?: readonly T[],
): T {
    const validType = typeof saved === typeof fallback;
    const validNumber = typeof saved !== 'number' || Number.isFinite(saved);
    const validValue = !validValues || validValues.includes(saved as T);
    return validType && validNumber && validValue ? saved as T : fallback;
}

function resolvePrintAllOptions(saved: Options | null | undefined): PrintAllOptions {
    const defaults = DEFAULT_OPTIONS.printAllOptions;
    const printOptions = saved?.printAllOptions;
    return {
        clean: resolveSavedValue(printOptions?.clean, defaults.clean),
        printPilotData: resolveSavedValue(printOptions?.printPilotData, defaults.printPilotData),
        recordSheetCenterPanelContent: resolveSavedValue(
            printOptions?.recordSheetCenterPanelContent,
            defaults.recordSheetCenterPanelContent,
            PRINT_OPTION_VALUES.recordSheetCenterPanelContent,
        ),
        ASPrintPageBreakOnGroups: resolveSavedValue(
            printOptions?.ASPrintPageBreakOnGroups,
            defaults.ASPrintPageBreakOnGroups,
        ),
        ASPrintCardSize: resolveSavedValue(
            printOptions?.ASPrintCardSize,
            defaults.ASPrintCardSize,
            PRINT_OPTION_VALUES.ASPrintCardSize,
        ),
        printMargin: resolveSavedValue(
            printOptions?.printMargin,
            defaults.printMargin,
            PRINT_OPTION_VALUES.printMargin,
        ),
    };
}

function resolveForceBudgetOptimizerLastSkills(saved: Options | null | undefined): ForceBudgetOptimizerLastSkills {
    const defaults = DEFAULT_OPTIONS.forceBudgetOptimizerLastSkills;
    const skills = saved?.forceBudgetOptimizerLastSkills;
    return {
        gunnery: {
            min: resolveSavedValue(skills?.gunnery?.min, defaults.gunnery.min),
            max: resolveSavedValue(skills?.gunnery?.max, defaults.gunnery.max),
        },
        piloting: {
            min: resolveSavedValue(skills?.piloting?.min, defaults.piloting.min),
            max: resolveSavedValue(skills?.piloting?.max, defaults.piloting.max),
        },
        skill: {
            min: resolveSavedValue(skills?.skill?.min, defaults.skill.min),
            max: resolveSavedValue(skills?.skill?.max, defaults.skill.max),
        },
        maxDelta: resolveSavedValue(skills?.maxDelta, defaults.maxDelta),
    };
}

function resolveForceGeneratorOptions(saved: Options | null | undefined): ForceGeneratorOptions {
    const defaults = DEFAULT_OPTIONS.forceGenerator;
    const forceGenerator = saved?.forceGenerator;
    return {
        lastBudget: {
            classic: {
                min: resolveSavedValue(forceGenerator?.lastBudget?.classic?.min, defaults.lastBudget.classic.min),
                max: resolveSavedValue(forceGenerator?.lastBudget?.classic?.max, defaults.lastBudget.classic.max),
            },
            alphaStrike: {
                min: resolveSavedValue(forceGenerator?.lastBudget?.alphaStrike?.min, defaults.lastBudget.alphaStrike.min),
                max: resolveSavedValue(forceGenerator?.lastBudget?.alphaStrike?.max, defaults.lastBudget.alphaStrike.max),
            },
        },
        lastUnitCount: {
            min: resolveSavedValue(forceGenerator?.lastUnitCount?.min, defaults.lastUnitCount.min),
            max: resolveSavedValue(forceGenerator?.lastUnitCount?.max, defaults.lastUnitCount.max),
        },
        lastSkills: {
            gunnery: {
                min: resolveSavedValue(forceGenerator?.lastSkills?.gunnery?.min, defaults.lastSkills.gunnery.min),
                max: resolveSavedValue(forceGenerator?.lastSkills?.gunnery?.max, defaults.lastSkills.gunnery.max),
            },
            piloting: {
                min: resolveSavedValue(forceGenerator?.lastSkills?.piloting?.min, defaults.lastSkills.piloting.min),
                max: resolveSavedValue(forceGenerator?.lastSkills?.piloting?.max, defaults.lastSkills.piloting.max),
            },
            maxDelta: resolveSavedValue(forceGenerator?.lastSkills?.maxDelta, defaults.lastSkills.maxDelta),
        },
        failureSearchWindowMs: resolveSavedValue(forceGenerator?.failureSearchWindowMs, defaults.failureSearchWindowMs),
        ignoreRarityWeight: resolveSavedValue(forceGenerator?.ignoreRarityWeight, defaults.ignoreRarityWeight),
        preventDuplicateChassis: resolveSavedValue(forceGenerator?.preventDuplicateChassis, defaults.preventDuplicateChassis),
        useTaggedQuantities: resolveSavedValue(forceGenerator?.useTaggedQuantities, defaults.useTaggedQuantities),
        useUnitTagsAsChassisTags: resolveSavedValue(forceGenerator?.useUnitTagsAsChassisTags, defaults.useUnitTagsAsChassisTags),
    };
}

function resolveCBTOptionalRules(saved: Options | null | undefined): CBTOptionalRules {
    const defaults = DEFAULT_OPTIONS.CBTOptionalRules;
    return {
        floatingCriticals: resolveSavedValue(saved?.CBTOptionalRules?.floatingCriticals, defaults.floatingCriticals),
        forcedWithdrawal: resolveSavedValue(saved?.CBTOptionalRules?.forcedWithdrawal, defaults.forcedWithdrawal),
        extremeRange: resolveSavedValue(saved?.CBTOptionalRules?.extremeRange, defaults.extremeRange),
        sprinting: resolveSavedValue(saved?.CBTOptionalRules?.sprinting, defaults.sprinting),
        allowMixedTechBaseAmmo: resolveSavedValue(saved?.CBTOptionalRules?.allowMixedTechBaseAmmo, defaults.allowMixedTechBaseAmmo),
    };
}

function resolveCBTAutomationOptions(saved: Options | null | undefined): CBTAutomationOptions {
    const defaults = DEFAULT_OPTIONS.cbtAutomationOptions;
    return Object.fromEntries(CBT_AUTOMATION_KEYS.map(key => [
        key,
        resolveSavedValue(saved?.cbtAutomationOptions?.[key], defaults[key], OPTION_VALUES.automationMode),
    ])) as CBTAutomationOptions;
}

function resolveLastCanvasState(saved: unknown): Options['lastCanvasState'] {
    if (!saved || typeof saved !== 'object') {
        return undefined;
    }

    const state = saved as Record<string, unknown>;
    if (typeof state['brushSize'] !== 'number' || !Number.isFinite(state['brushSize'])
        || typeof state['eraserSize'] !== 'number' || !Number.isFinite(state['eraserSize'])) {
        return undefined;
    }

    return {
        brushSize: state['brushSize'],
        eraserSize: state['eraserSize'],
    };
}

function resolveUnitServers(saved: unknown): string[] {
    if (!Array.isArray(saved)) {
        return [...DEFAULT_OPTIONS.unitServers];
    }

    const normalized = saved.map(server => typeof server === 'string' ? normalizeUnitServerUrl(server) : '');
    return normalized.every(Boolean) ? normalized : [...DEFAULT_OPTIONS.unitServers];
}

@Injectable({ providedIn: 'root' })
export class OptionsService {
    private dbService = inject(DbService);
    readonly initialized = signal(false);

    public options = signal<Options>({
        colorScheme: DEFAULT_OPTIONS.colorScheme,
        pickerStyle: DEFAULT_OPTIONS.pickerStyle,
        canvasInput: DEFAULT_OPTIONS.canvasInput,
        swipeToNextSheet: DEFAULT_OPTIONS.swipeToNextSheet,
        syncZoomBetweenSheets: DEFAULT_OPTIONS.syncZoomBetweenSheets,
        unitDisplayName: DEFAULT_OPTIONS.unitDisplayName,
        gameSystem: DEFAULT_OPTIONS.gameSystem,
        availabilitySource: DEFAULT_OPTIONS.availabilitySource,
        forceViewerBVPVDisplay: DEFAULT_OPTIONS.forceViewerBVPVDisplay,
        megaMekAvailabilityFiltersUseAllScopedOptions: DEFAULT_OPTIONS.megaMekAvailabilityFiltersUseAllScopedOptions,
        printAllOptions: { ...DEFAULT_OPTIONS.printAllOptions },
        recordSheetDoubleTapZoomReset: DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset,
        trackPhaseAndTurn: DEFAULT_OPTIONS.trackPhaseAndTurn,
        cbtAutomationOptions: { ...DEFAULT_OPTIONS.cbtAutomationOptions },
        CBTOptionalRules: { ...DEFAULT_OPTIONS.CBTOptionalRules },
        CBTRules: DEFAULT_OPTIONS.CBTRules,
        ASUseHex: DEFAULT_OPTIONS.ASUseHex,
        c3NetworkConnectionsAboveNodes: DEFAULT_OPTIONS.c3NetworkConnectionsAboveNodes,
        automaticallyConvertFiltersToSemantic: DEFAULT_OPTIONS.automaticallyConvertFiltersToSemantic,
        allowMultipleActiveSheets: DEFAULT_OPTIONS.allowMultipleActiveSheets,
        unitSearchExpandedViewLayout: DEFAULT_OPTIONS.unitSearchExpandedViewLayout,
        showFilteredComponents: DEFAULT_OPTIONS.showFilteredComponents,
        unitSearchViewMode: DEFAULT_OPTIONS.unitSearchViewMode,
        forceOverviewViewMode: DEFAULT_OPTIONS.forceOverviewViewMode,
        ASVehiclesCriticalHitTable: DEFAULT_OPTIONS.ASVehiclesCriticalHitTable,
        ASUseAutomations: DEFAULT_OPTIONS.ASUseAutomations,
        ASUnifiedDamagePicker: DEFAULT_OPTIONS.ASUnifiedDamagePicker,
        performanceMode: DEFAULT_OPTIONS.performanceMode,
        enableForceSyncConflictDialog: DEFAULT_OPTIONS.enableForceSyncConflictDialog,
        unitServers: DEFAULT_OPTIONS.unitServers,
        forceGenerator: DEFAULT_OPTIONS.forceGenerator,
        forceBudgetOptimizerLastSkills: DEFAULT_OPTIONS.forceBudgetOptimizerLastSkills,
    });

    constructor() {
        this.initOptions();
    }

    async initOptions() {
        const saved = await this.dbService.getOptions();
        const cbtAutomationOptions = resolveCBTAutomationOptions(saved);
        this.options.set({
            colorScheme: resolveSavedValue(saved?.colorScheme, DEFAULT_OPTIONS.colorScheme, OPTION_VALUES.colorScheme),
            pickerStyle: resolveSavedValue(saved?.pickerStyle, DEFAULT_OPTIONS.pickerStyle, OPTION_VALUES.pickerStyle),
            canvasInput: resolveSavedValue(saved?.canvasInput, DEFAULT_OPTIONS.canvasInput, OPTION_VALUES.canvasInput),
            swipeToNextSheet: resolveSavedValue(saved?.swipeToNextSheet, DEFAULT_OPTIONS.swipeToNextSheet, OPTION_VALUES.swipeToNextSheet),
            syncZoomBetweenSheets: resolveSavedValue(saved?.syncZoomBetweenSheets, DEFAULT_OPTIONS.syncZoomBetweenSheets),
            unitDisplayName: resolveSavedValue(saved?.unitDisplayName, DEFAULT_OPTIONS.unitDisplayName, OPTION_VALUES.unitDisplayName),
            gameSystem: resolveSavedValue(saved?.gameSystem, DEFAULT_OPTIONS.gameSystem, OPTION_VALUES.gameSystem),
            availabilitySource: resolveSavedValue(saved?.availabilitySource, DEFAULT_OPTIONS.availabilitySource, OPTION_VALUES.availabilitySource),
            forceViewerBVPVDisplay: resolveSavedValue(saved?.forceViewerBVPVDisplay, DEFAULT_OPTIONS.forceViewerBVPVDisplay, OPTION_VALUES.forceViewerBVPVDisplay),
            megaMekAvailabilityFiltersUseAllScopedOptions: resolveSavedValue(saved?.megaMekAvailabilityFiltersUseAllScopedOptions, DEFAULT_OPTIONS.megaMekAvailabilityFiltersUseAllScopedOptions),
            printAllOptions: resolvePrintAllOptions(saved),
            recordSheetDoubleTapZoomReset: resolveSavedValue(saved?.recordSheetDoubleTapZoomReset, DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset, OPTION_VALUES.recordSheetDoubleTapZoomReset),
            lastCanvasState: resolveLastCanvasState(saved?.lastCanvasState),
            sidebarLipPosition: typeof saved?.sidebarLipPosition === 'string' ? saved.sidebarLipPosition : undefined,
            trackPhaseAndTurn: resolveSavedValue(saved?.trackPhaseAndTurn, DEFAULT_OPTIONS.trackPhaseAndTurn),
            cbtAutomationOptions,
            CBTOptionalRules: resolveCBTOptionalRules(saved),
            CBTRules: resolveSavedValue(saved?.CBTRules, DEFAULT_OPTIONS.CBTRules, OPTION_VALUES.CBTRules),
            ASUseHex: resolveSavedValue(saved?.ASUseHex, DEFAULT_OPTIONS.ASUseHex),
            c3NetworkConnectionsAboveNodes: resolveSavedValue(saved?.c3NetworkConnectionsAboveNodes, DEFAULT_OPTIONS.c3NetworkConnectionsAboveNodes),
            automaticallyConvertFiltersToSemantic: resolveSavedValue(saved?.automaticallyConvertFiltersToSemantic, DEFAULT_OPTIONS.automaticallyConvertFiltersToSemantic),
            allowMultipleActiveSheets: resolveSavedValue(saved?.allowMultipleActiveSheets, DEFAULT_OPTIONS.allowMultipleActiveSheets),
            unitSearchExpandedViewLayout: resolveSavedValue(saved?.unitSearchExpandedViewLayout, DEFAULT_OPTIONS.unitSearchExpandedViewLayout, OPTION_VALUES.unitSearchExpandedViewLayout),
            showFilteredComponents: resolveSavedValue(saved?.showFilteredComponents, DEFAULT_OPTIONS.showFilteredComponents),
            unitSearchViewMode: resolveSavedValue(saved?.unitSearchViewMode, DEFAULT_OPTIONS.unitSearchViewMode, OPTION_VALUES.unitSearchViewMode),
            forceOverviewViewMode: resolveSavedValue(saved?.forceOverviewViewMode, DEFAULT_OPTIONS.forceOverviewViewMode, OPTION_VALUES.forceOverviewViewMode),
            ASVehiclesCriticalHitTable: resolveSavedValue(saved?.ASVehiclesCriticalHitTable, DEFAULT_OPTIONS.ASVehiclesCriticalHitTable, OPTION_VALUES.ASVehiclesCriticalHitTable),
            ASUseAutomations: resolveSavedValue(saved?.ASUseAutomations, DEFAULT_OPTIONS.ASUseAutomations),
            ASUnifiedDamagePicker: resolveSavedValue(saved?.ASUnifiedDamagePicker, DEFAULT_OPTIONS.ASUnifiedDamagePicker),
            performanceMode: resolveSavedValue(saved?.performanceMode, DEFAULT_OPTIONS.performanceMode),
            enableForceSyncConflictDialog: resolveSavedValue(saved?.enableForceSyncConflictDialog, DEFAULT_OPTIONS.enableForceSyncConflictDialog),
            unitServers: resolveUnitServers(saved?.unitServers),
            forceGenerator: resolveForceGeneratorOptions(saved),
            forceBudgetOptimizerLastSkills: resolveForceBudgetOptimizerLastSkills(saved),
        });
        this.initialized.set(true);
    }

    async setOption<K extends keyof Options>(key: K, value: Options[K]) {
        const updated = { ...this.options(), [key]: value };
        this.options.set(updated);
        await this.dbService.saveOptions(updated);
    }

    async setCbtAutomationMode(key: CBTAutomationKey, value: AutomationMode) {
        const current = this.options().cbtAutomationOptions;
        if (current[key] === value) {
            return;
        }

        await this.setOption('cbtAutomationOptions', { ...current, [key]: value });
    }

    /** Returns the configured mode for one CBT automation. */
    cbtAutomationMode(key: CBTAutomationKey): AutomationMode {
        return this.options().cbtAutomationOptions[key];
    }

    async updateForceGeneratorOptions(
        updater: (options: ForceGeneratorOptions) => ForceGeneratorOptions,
    ) {
        const updated = {
            ...this.options(),
            forceGenerator: updater(this.options().forceGenerator),
        };
        this.options.set(updated);
        await this.dbService.saveOptions(updated);
    }
}
