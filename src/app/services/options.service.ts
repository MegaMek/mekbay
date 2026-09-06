// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable, signal } from '@angular/core';
import { DbService } from './db.service';
import {
    CBT_AUTOMATION_KEYS,
    OPTION_VALUES,
    type AutomationMode,
    type CBTAutomationKey,
    type CBTAutomationOptions,
    type CBTOptionalRules,
    type ColorScheme,
    type ForceBudgetOptimizerLastSkills,
    type ForceGeneratorOptions,
    type Options,
} from '../models/options.model';
import { PRINT_OPTION_VALUES, type PrintAllOptions } from '../models/print-options.model';
import { GameSystem } from '../models/common.model';
import { isCBTRuleset } from '../models/cbt-ruleset.model';



const DEFAULT_OPTIONS: Options = {
    canvasInput: 'all',
    unitDisplayName: 'both',
    displayUnitNameFormat: 'innerSphereClan',
    gameSystem: GameSystem.CBT,
    availabilitySource: 'mul',
    forceViewerBVPVDisplay: 'adjusted',
    forceViewerBVPVDisplayDamage: 'damaged',
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
        paperSize: 'letter',
        recordSheetCenterPanelContent: 'clusterTable',
        ASPrintPageBreakOnGroups: true,
        ASPrintCardSize: 'standard',
        printMargin: 'browserDefined',
    },
    performanceMode: false,
    enableForceSyncConflictDialog: false,

    // Theme
    colorScheme: 'default',
    pickerStyle: 'default',
    swipeToNextSheet: 'horizontal',
    recordSheetDoubleTapZoomReset: 'contextual',
    syncZoomBetweenSheets: true,
    trackPhaseAndTurn: true,
    cbtUnitViewMode: 'sheet',
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
    CBTRules: 'total-warfare',

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

type LegacyOptions = Partial<Options> & {
    themeColor?: 'normal' | 'night';
    sheetsColor?: 'normal' | 'night';
    ASCardStyle?: 'colored' | 'monochrome';
    cbtAutomations?: boolean;
    recordSheetCenterPanelContent?: PrintAllOptions['recordSheetCenterPanelContent'];
    ASPrintPageBreakOnGroups?: boolean;
    ASPrintCardSize?: PrintAllOptions['ASPrintCardSize'];
    printPaperSize?: PrintAllOptions['paperSize'];
    printMargin?: PrintAllOptions['printMargin'];
};

function resolveSavedValue<T extends string | number | boolean>(
    saved: unknown,
    fallback: T,
    validValues?: readonly T[],
): T {
    return typeof saved === typeof fallback
        && (typeof saved !== 'number' || Number.isFinite(saved))
        && (!validValues || validValues.includes(saved as T))
        ? saved as T
        : fallback;
}

function resolveColorScheme(saved: LegacyOptions | null | undefined): ColorScheme {
    if (saved?.colorScheme) {
        return saved.colorScheme;
    }

    if (saved?.themeColor) {
        return saved.themeColor === 'night' ? 'night' : 'default';
    }

    // Existing settings may contain both former options. Prefer the global sheet theme.
    if (saved?.sheetsColor) {
        return saved.sheetsColor === 'night' ? 'night' : 'default';
    }

    return saved?.ASCardStyle === 'colored' ? 'night' : DEFAULT_OPTIONS.colorScheme;
}

function resolvePrintAllOptions(saved: LegacyOptions | null | undefined): PrintAllOptions {
    const defaults = DEFAULT_OPTIONS.printAllOptions;
    const printOptions = saved?.printAllOptions as Partial<PrintAllOptions> | undefined;
    return {
        clean: resolveSavedValue(printOptions?.clean, defaults.clean),
        printPilotData: resolveSavedValue(printOptions?.printPilotData, defaults.printPilotData),
        paperSize: resolveSavedValue(
            printOptions?.paperSize ?? saved?.printPaperSize,
            defaults.paperSize,
            PRINT_OPTION_VALUES.paperSize,
        ),
        recordSheetCenterPanelContent: resolveSavedValue(
            printOptions?.recordSheetCenterPanelContent ?? saved?.recordSheetCenterPanelContent,
            defaults.recordSheetCenterPanelContent,
            PRINT_OPTION_VALUES.recordSheetCenterPanelContent,
        ),
        ASPrintPageBreakOnGroups: resolveSavedValue(
            printOptions?.ASPrintPageBreakOnGroups ?? saved?.ASPrintPageBreakOnGroups,
            defaults.ASPrintPageBreakOnGroups,
        ),
        ASPrintCardSize: resolveSavedValue(
            printOptions?.ASPrintCardSize ?? saved?.ASPrintCardSize,
            defaults.ASPrintCardSize,
            PRINT_OPTION_VALUES.ASPrintCardSize,
        ),
        printMargin: resolveSavedValue(
            printOptions?.printMargin ?? saved?.printMargin,
            defaults.printMargin,
            PRINT_OPTION_VALUES.printMargin,
        ),
    };
}

function resolveForceBudgetOptimizerLastSkills(saved: Partial<Options> | null | undefined): ForceBudgetOptimizerLastSkills {
    const defaults = DEFAULT_OPTIONS.forceBudgetOptimizerLastSkills;
    const skills = saved?.forceBudgetOptimizerLastSkills;
    return {
        gunnery: {
            min: skills?.gunnery?.min ?? defaults.gunnery.min,
            max: skills?.gunnery?.max ?? defaults.gunnery.max,
        },
        piloting: {
            min: skills?.piloting?.min ?? defaults.piloting.min,
            max: skills?.piloting?.max ?? defaults.piloting.max,
        },
        skill: {
            min: skills?.skill?.min ?? defaults.skill.min,
            max: skills?.skill?.max ?? defaults.skill.max,
        },
        maxDelta: skills?.maxDelta ?? defaults.maxDelta,
    };
}

function resolveForceGeneratorOptions(saved: Partial<Options> | null | undefined): ForceGeneratorOptions {
    const defaults = DEFAULT_OPTIONS.forceGenerator;
    const forceGenerator = saved?.forceGenerator;
    return {
        lastBudget: {
            classic: {
                min: forceGenerator?.lastBudget?.classic?.min ?? defaults.lastBudget.classic.min,
                max: forceGenerator?.lastBudget?.classic?.max ?? defaults.lastBudget.classic.max,
            },
            alphaStrike: {
                min: forceGenerator?.lastBudget?.alphaStrike?.min ?? defaults.lastBudget.alphaStrike.min,
                max: forceGenerator?.lastBudget?.alphaStrike?.max ?? defaults.lastBudget.alphaStrike.max,
            },
        },
        lastUnitCount: {
            min: forceGenerator?.lastUnitCount?.min ?? defaults.lastUnitCount.min,
            max: forceGenerator?.lastUnitCount?.max ?? defaults.lastUnitCount.max,
        },
        lastSkills: {
            gunnery: {
                min: forceGenerator?.lastSkills?.gunnery?.min ?? defaults.lastSkills.gunnery.min,
                max: forceGenerator?.lastSkills?.gunnery?.max ?? defaults.lastSkills.gunnery.max,
            },
            piloting: {
                min: forceGenerator?.lastSkills?.piloting?.min ?? defaults.lastSkills.piloting.min,
                max: forceGenerator?.lastSkills?.piloting?.max ?? defaults.lastSkills.piloting.max,
            },
            maxDelta: forceGenerator?.lastSkills?.maxDelta ?? defaults.lastSkills.maxDelta,
        },
        failureSearchWindowMs: forceGenerator?.failureSearchWindowMs ?? defaults.failureSearchWindowMs,
        ignoreRarityWeight: forceGenerator?.ignoreRarityWeight ?? defaults.ignoreRarityWeight,
        preventDuplicateChassis: forceGenerator?.preventDuplicateChassis ?? defaults.preventDuplicateChassis,
        useTaggedQuantities: forceGenerator?.useTaggedQuantities ?? defaults.useTaggedQuantities,
        useUnitTagsAsChassisTags: forceGenerator?.useUnitTagsAsChassisTags ?? defaults.useUnitTagsAsChassisTags,
    };
}

function resolveCBTOptionalRules(saved: Partial<Options> | null | undefined): CBTOptionalRules {
    const defaults = DEFAULT_OPTIONS.CBTOptionalRules;
    return {
        floatingCriticals: saved?.CBTOptionalRules?.floatingCriticals ?? defaults.floatingCriticals,
        forcedWithdrawal: saved?.CBTOptionalRules?.forcedWithdrawal ?? defaults.forcedWithdrawal,
        extremeRange: saved?.CBTOptionalRules?.extremeRange ?? defaults.extremeRange,
        sprinting: saved?.CBTOptionalRules?.sprinting ?? defaults.sprinting,
        allowMixedTechBaseAmmo: saved?.CBTOptionalRules?.allowMixedTechBaseAmmo ?? defaults.allowMixedTechBaseAmmo,
    };
}

function resolveCBTAutomationOptions(saved: LegacyOptions | null | undefined): CBTAutomationOptions {
    const defaults = DEFAULT_OPTIONS.cbtAutomationOptions;
    const legacyHeatMode: AutomationMode | undefined = saved?.cbtAutomations === undefined
        ? undefined
        : saved.cbtAutomations ? 'yes' : 'no';
    return Object.fromEntries(CBT_AUTOMATION_KEYS.map(key => [
        key,
        resolveSavedValue(
            saved?.cbtAutomationOptions?.[key],
            key === 'heatAndDissipationResolution' && legacyHeatMode !== undefined
                ? legacyHeatMode
                : defaults[key],
            OPTION_VALUES.automationMode,
        ),
    ])) as CBTAutomationOptions;
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
        displayUnitNameFormat: DEFAULT_OPTIONS.displayUnitNameFormat,
        gameSystem: DEFAULT_OPTIONS.gameSystem,
        availabilitySource: DEFAULT_OPTIONS.availabilitySource,
        forceViewerBVPVDisplay: DEFAULT_OPTIONS.forceViewerBVPVDisplay,
        forceViewerBVPVDisplayDamage: DEFAULT_OPTIONS.forceViewerBVPVDisplayDamage,
        megaMekAvailabilityFiltersUseAllScopedOptions: DEFAULT_OPTIONS.megaMekAvailabilityFiltersUseAllScopedOptions,
        printAllOptions: { ...DEFAULT_OPTIONS.printAllOptions },
        recordSheetDoubleTapZoomReset: DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset,
        trackPhaseAndTurn: DEFAULT_OPTIONS.trackPhaseAndTurn,
        cbtUnitViewMode: DEFAULT_OPTIONS.cbtUnitViewMode,
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
        forceGenerator: DEFAULT_OPTIONS.forceGenerator,
        forceBudgetOptimizerLastSkills: DEFAULT_OPTIONS.forceBudgetOptimizerLastSkills,
    });

    constructor() {
        this.initOptions();
    }

    async initOptions() {
        const saved = await this.dbService.getOptions() as LegacyOptions | null;
        this.options.set({
            colorScheme: resolveColorScheme(saved),
            pickerStyle: saved?.pickerStyle ?? DEFAULT_OPTIONS.pickerStyle,
            canvasInput: saved?.canvasInput ?? DEFAULT_OPTIONS.canvasInput,
            swipeToNextSheet: saved?.swipeToNextSheet ?? DEFAULT_OPTIONS.swipeToNextSheet,
            syncZoomBetweenSheets: saved?.syncZoomBetweenSheets ?? DEFAULT_OPTIONS.syncZoomBetweenSheets,
            unitDisplayName: saved?.unitDisplayName ?? DEFAULT_OPTIONS.unitDisplayName,
            displayUnitNameFormat: resolveSavedValue(
                saved?.displayUnitNameFormat,
                DEFAULT_OPTIONS.displayUnitNameFormat,
                OPTION_VALUES.displayUnitNameFormat,
            ),
            gameSystem: saved?.gameSystem ?? DEFAULT_OPTIONS.gameSystem,
            availabilitySource: saved?.availabilitySource ?? DEFAULT_OPTIONS.availabilitySource,
            forceViewerBVPVDisplay: saved?.forceViewerBVPVDisplay ?? DEFAULT_OPTIONS.forceViewerBVPVDisplay,
            forceViewerBVPVDisplayDamage: resolveSavedValue(
                saved?.forceViewerBVPVDisplayDamage,
                DEFAULT_OPTIONS.forceViewerBVPVDisplayDamage,
                OPTION_VALUES.forceViewerBVPVDisplayDamage,
            ),
            megaMekAvailabilityFiltersUseAllScopedOptions: saved?.megaMekAvailabilityFiltersUseAllScopedOptions ?? DEFAULT_OPTIONS.megaMekAvailabilityFiltersUseAllScopedOptions,
            printAllOptions: resolvePrintAllOptions(saved),
            recordSheetDoubleTapZoomReset: saved?.recordSheetDoubleTapZoomReset ?? DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset,
            lastCanvasState: saved?.lastCanvasState,
            sidebarLipPosition: saved?.sidebarLipPosition,
            trackPhaseAndTurn: saved?.trackPhaseAndTurn ?? DEFAULT_OPTIONS.trackPhaseAndTurn,
            cbtUnitViewMode: resolveSavedValue(
                saved?.cbtUnitViewMode,
                DEFAULT_OPTIONS.cbtUnitViewMode,
                OPTION_VALUES.cbtUnitViewMode,
            ),
            cbtAutomationOptions: resolveCBTAutomationOptions(saved),
            CBTOptionalRules: resolveCBTOptionalRules(saved),
            CBTRules: isCBTRuleset(saved?.CBTRules) ? saved.CBTRules : DEFAULT_OPTIONS.CBTRules,
            ASUseHex: saved?.ASUseHex ?? DEFAULT_OPTIONS.ASUseHex,
            c3NetworkConnectionsAboveNodes: saved?.c3NetworkConnectionsAboveNodes ?? DEFAULT_OPTIONS.c3NetworkConnectionsAboveNodes,
            automaticallyConvertFiltersToSemantic: saved?.automaticallyConvertFiltersToSemantic ?? DEFAULT_OPTIONS.automaticallyConvertFiltersToSemantic,
            allowMultipleActiveSheets: saved?.allowMultipleActiveSheets ?? DEFAULT_OPTIONS.allowMultipleActiveSheets,
            unitSearchExpandedViewLayout: saved?.unitSearchExpandedViewLayout ?? DEFAULT_OPTIONS.unitSearchExpandedViewLayout,
            showFilteredComponents: saved?.showFilteredComponents ?? DEFAULT_OPTIONS.showFilteredComponents,
            unitSearchViewMode: saved?.unitSearchViewMode ?? DEFAULT_OPTIONS.unitSearchViewMode,
            forceOverviewViewMode: saved?.forceOverviewViewMode ?? DEFAULT_OPTIONS.forceOverviewViewMode,
            ASVehiclesCriticalHitTable: saved?.ASVehiclesCriticalHitTable ?? DEFAULT_OPTIONS.ASVehiclesCriticalHitTable,
            ASUseAutomations: saved?.ASUseAutomations ?? DEFAULT_OPTIONS.ASUseAutomations,
            ASUnifiedDamagePicker: saved?.ASUnifiedDamagePicker ?? DEFAULT_OPTIONS.ASUnifiedDamagePicker,
            performanceMode: saved?.performanceMode ?? DEFAULT_OPTIONS.performanceMode,
            enableForceSyncConflictDialog: saved?.enableForceSyncConflictDialog ?? DEFAULT_OPTIONS.enableForceSyncConflictDialog,
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
        if (!OPTION_VALUES.automationMode.includes(value)) return;
        const current = this.options().cbtAutomationOptions;
        if (current[key] === value) return;
        await this.setOption('cbtAutomationOptions', { ...current, [key]: value });
    }

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
