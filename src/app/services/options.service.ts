// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable, signal } from '@angular/core';
import { DbService } from './db.service';
import type { CBTOptionalRules, ColorScheme, ForceBudgetOptimizerLastSkills, ForceGeneratorOptions, Options } from '../models/options.model';
import { GameSystem } from '../models/common.model';



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
    printRosterSummary: false,
    printMargin: 'browserDefined',
    performanceMode: false,
    enableForceSyncConflictDialog: false,
    unitServers: [],

    // Theme
    colorScheme: 'default',
    pickerStyle: 'default',
    swipeToNextSheet: 'horizontal',
    recordSheetCenterPanelContent: 'clusterTable',
    recordSheetDoubleTapZoomReset: 'contextual',
    syncZoomBetweenSheets: true,
    trackPhaseAndTurn: true,
    cbtAutomations: false,
    CBTOptionalRules: {
        forcedWithdrawal: true,
        extremeRange: false,
    },
    allowMultipleActiveSheets: false,
    CBTRules: 'tw',

    // Alpha Strike
    ASUseHex: false,
    ASPrintPageBreakOnGroups: true,
    ASPrintCardSize: 'standard',
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
};

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

function resolveForceBudgetOptimizerLastSkills(saved: Options | null | undefined): ForceBudgetOptimizerLastSkills {
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

function resolveForceGeneratorOptions(saved: Options | null | undefined): ForceGeneratorOptions {
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
        preventDuplicateChassis: forceGenerator?.preventDuplicateChassis ?? defaults.preventDuplicateChassis,
        useTaggedQuantities: forceGenerator?.useTaggedQuantities ?? defaults.useTaggedQuantities,
        useUnitTagsAsChassisTags: forceGenerator?.useUnitTagsAsChassisTags ?? defaults.useUnitTagsAsChassisTags,
    };
}

function resolveCBTOptionalRules(saved: Options | null | undefined): CBTOptionalRules {
    const defaults = DEFAULT_OPTIONS.CBTOptionalRules;
    return {
        forcedWithdrawal: saved?.CBTOptionalRules?.forcedWithdrawal ?? defaults.forcedWithdrawal,
        extremeRange: saved?.CBTOptionalRules?.extremeRange ?? defaults.extremeRange,
    };
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
        recordSheetCenterPanelContent: DEFAULT_OPTIONS.recordSheetCenterPanelContent,
        recordSheetDoubleTapZoomReset: DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset,
        trackPhaseAndTurn: DEFAULT_OPTIONS.trackPhaseAndTurn,
        cbtAutomations: DEFAULT_OPTIONS.cbtAutomations,
        CBTOptionalRules: { ...DEFAULT_OPTIONS.CBTOptionalRules },
        CBTRules: DEFAULT_OPTIONS.CBTRules,
        ASUseHex: DEFAULT_OPTIONS.ASUseHex,
        ASPrintPageBreakOnGroups: DEFAULT_OPTIONS.ASPrintPageBreakOnGroups,
        ASPrintCardSize: DEFAULT_OPTIONS.ASPrintCardSize,
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
        printRosterSummary: DEFAULT_OPTIONS.printRosterSummary,
        printMargin: DEFAULT_OPTIONS.printMargin,
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
        this.options.set({
            colorScheme: resolveColorScheme(saved),
            pickerStyle: saved?.pickerStyle ?? DEFAULT_OPTIONS.pickerStyle,
            canvasInput: saved?.canvasInput ?? DEFAULT_OPTIONS.canvasInput,
            swipeToNextSheet: saved?.swipeToNextSheet ?? DEFAULT_OPTIONS.swipeToNextSheet,
            syncZoomBetweenSheets: saved?.syncZoomBetweenSheets ?? DEFAULT_OPTIONS.syncZoomBetweenSheets,
            unitDisplayName: saved?.unitDisplayName ?? DEFAULT_OPTIONS.unitDisplayName,
            gameSystem: saved?.gameSystem ?? DEFAULT_OPTIONS.gameSystem,
            availabilitySource: saved?.availabilitySource ?? DEFAULT_OPTIONS.availabilitySource,
            forceViewerBVPVDisplay: saved?.forceViewerBVPVDisplay ?? DEFAULT_OPTIONS.forceViewerBVPVDisplay,
            megaMekAvailabilityFiltersUseAllScopedOptions: saved?.megaMekAvailabilityFiltersUseAllScopedOptions ?? DEFAULT_OPTIONS.megaMekAvailabilityFiltersUseAllScopedOptions,
            recordSheetCenterPanelContent: saved?.recordSheetCenterPanelContent ?? DEFAULT_OPTIONS.recordSheetCenterPanelContent,
            recordSheetDoubleTapZoomReset: saved?.recordSheetDoubleTapZoomReset ?? DEFAULT_OPTIONS.recordSheetDoubleTapZoomReset,
            lastCanvasState: saved?.lastCanvasState,
            sidebarLipPosition: saved?.sidebarLipPosition,
            trackPhaseAndTurn: saved?.trackPhaseAndTurn ?? DEFAULT_OPTIONS.trackPhaseAndTurn,
            cbtAutomations: saved?.cbtAutomations ?? DEFAULT_OPTIONS.cbtAutomations,
            CBTOptionalRules: resolveCBTOptionalRules(saved),
            CBTRules: saved?.CBTRules ?? DEFAULT_OPTIONS.CBTRules,
            ASUseHex: saved?.ASUseHex ?? DEFAULT_OPTIONS.ASUseHex,
            ASPrintPageBreakOnGroups: saved?.ASPrintPageBreakOnGroups ?? DEFAULT_OPTIONS.ASPrintPageBreakOnGroups,
            ASPrintCardSize: saved?.ASPrintCardSize ?? DEFAULT_OPTIONS.ASPrintCardSize,
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
            printRosterSummary: saved?.printRosterSummary ?? DEFAULT_OPTIONS.printRosterSummary,
            printMargin: saved?.printMargin ?? DEFAULT_OPTIONS.printMargin,
            performanceMode: saved?.performanceMode ?? DEFAULT_OPTIONS.performanceMode,
            enableForceSyncConflictDialog: saved?.enableForceSyncConflictDialog ?? DEFAULT_OPTIONS.enableForceSyncConflictDialog,
            unitServers: saved?.unitServers ?? DEFAULT_OPTIONS.unitServers,
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