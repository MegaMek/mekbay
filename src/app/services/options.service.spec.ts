// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { OptionsService } from './options.service';
import { GameSystem } from '../models/common.model';

describe('OptionsService', () => {
    let savedOptions: unknown;
    let dbService: { getOptions: jasmine.Spy; saveOptions: jasmine.Spy };

    async function createService(): Promise<OptionsService> {
        dbService = {
            getOptions: jasmine.createSpy('getOptions').and.callFake(async () => savedOptions),
            saveOptions: jasmine.createSpy('saveOptions').and.resolveTo(undefined),
        };
        TestBed.configureTestingModule({
            providers: [
                OptionsService,
                { provide: DbService, useValue: dbService },
            ],
        });
        const service = TestBed.inject(OptionsService);
        await service.initOptions();
        return service;
    }

    afterEach(() => TestBed.resetTestingModule());

    it('uses the normal theme by default', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().colorScheme).toBe('default');
    });

    it('disables the force sync conflict dialog by default', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().enableForceSyncConflictDialog).toBeFalse();
    });

    it('restores the force sync conflict dialog preference', async () => {
        savedOptions = { enableForceSyncConflictDialog: true };

        const service = await createService();

        expect(service.options().enableForceSyncConflictDialog).toBeTrue();
    });

    it('uses the default print options', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().printAllOptions).toEqual({
            clean: false,
            printPilotData: true,
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: true,
            ASPrintCardSize: 'standard',
            printMargin: 'browserDefined',
        });
    });

    it('falls back to defaults for invalid saved primitive options', async () => {
        savedOptions = {
            colorScheme: 'sepia',
            pickerStyle: 'grid',
            canvasInput: 'mouse',
            swipeToNextSheet: 'diagonal',
            syncZoomBetweenSheets: 'true',
            unitDisplayName: 'model',
            gameSystem: 'classic',
            availabilitySource: 'other',
            forceViewerBVPVDisplay: 'adjusted-only',
            megaMekAvailabilityFiltersUseAllScopedOptions: 1,
            recordSheetDoubleTapZoomReset: 'always',
            trackPhaseAndTurn: 'true',
            CBTRules: 'basic',
            ASUseHex: 'false',
            c3NetworkConnectionsAboveNodes: 0,
            automaticallyConvertFiltersToSemantic: 'false',
            allowMultipleActiveSheets: 1,
            unitSearchExpandedViewLayout: 'list-panel-filters',
            showFilteredComponents: 'false',
            unitSearchViewMode: 'tiles',
            forceOverviewViewMode: 'cards',
            ASVehiclesCriticalHitTable: 'alternate',
            ASUseAutomations: 'true',
            ASUnifiedDamagePicker: 1,
            performanceMode: 'false',
            enableForceSyncConflictDialog: 1,
        };

        const service = await createService();

        expect(service.options()).toEqual(jasmine.objectContaining({
            colorScheme: 'default',
            pickerStyle: 'default',
            canvasInput: 'all',
            swipeToNextSheet: 'horizontal',
            syncZoomBetweenSheets: true,
            unitDisplayName: 'both',
            gameSystem: GameSystem.CLASSIC,
            availabilitySource: 'mul',
            forceViewerBVPVDisplay: 'adjusted',
            megaMekAvailabilityFiltersUseAllScopedOptions: true,
            recordSheetDoubleTapZoomReset: 'contextual',
            trackPhaseAndTurn: true,
            CBTRules: 'tw',
            ASUseHex: false,
            c3NetworkConnectionsAboveNodes: false,
            automaticallyConvertFiltersToSemantic: false,
            allowMultipleActiveSheets: false,
            unitSearchExpandedViewLayout: 'panel-list-filters',
            showFilteredComponents: false,
            unitSearchViewMode: 'list',
            forceOverviewViewMode: 'compact',
            ASVehiclesCriticalHitTable: 'default',
            ASUseAutomations: true,
            ASUnifiedDamagePicker: true,
            performanceMode: false,
            enableForceSyncConflictDialog: false,
        }));
    });

    it('falls back per field for invalid saved structured options', async () => {
        savedOptions = {
            printAllOptions: {
                clean: true,
                printPilotData: 'yes',
                recordSheetCenterPanelContent: 'diagram',
                ASPrintPageBreakOnGroups: 'false',
                ASPrintCardSize: 'large',
                printMargin: 'auto',
            },
            CBTOptionalRules: {
                forcedWithdrawal: 'true',
                extremeRange: 1,
            },
            lastCanvasState: {
                brushSize: 4,
                eraserSize: Number.POSITIVE_INFINITY,
            },
            sidebarLipPosition: 100,
            unitServers: ['not a URL'],
            forceGenerator: {
                lastBudget: {
                    classic: { min: 9000, max: Number.NaN },
                    alphaStrike: { min: 'low', max: 'high' },
                },
                lastUnitCount: { min: 'four', max: null },
                lastSkills: {
                    gunnery: { min: [], max: {} },
                    piloting: { min: Number.NaN, max: Number.POSITIVE_INFINITY },
                    maxDelta: 'two',
                },
                failureSearchWindowMs: Number.NaN,
                ignoreRarityWeight: 'false',
                preventDuplicateChassis: 'false',
                useTaggedQuantities: 1,
                useUnitTagsAsChassisTags: null,
            },
            forceBudgetOptimizerLastSkills: {
                gunnery: { min: 'two', max: Number.NaN },
                piloting: { min: null, max: Number.POSITIVE_INFINITY },
                skill: { min: [], max: {} },
                maxDelta: 'two',
            },
        };

        const service = await createService();

        expect(service.options().printAllOptions).toEqual({
            clean: true,
            printPilotData: true,
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: true,
            ASPrintCardSize: 'standard',
            printMargin: 'browserDefined',
        });
        expect(service.options().CBTOptionalRules).toEqual({
            forcedWithdrawal: true,
            extremeRange: false,
            floatingCriticals: false,
            sprinting: false,
        });
        expect(service.options().lastCanvasState).toBeUndefined();
        expect(service.options().sidebarLipPosition).toBeUndefined();
        expect(service.options().unitServers).toEqual([]);
        expect(service.options().forceGenerator).toEqual({
            lastBudget: {
                classic: { min: 9000, max: 8000 },
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
        });
        expect(service.options().forceBudgetOptimizerLastSkills).toEqual({
            gunnery: { min: 2, max: 4 },
            piloting: { min: 3, max: 5 },
            skill: { min: 2, max: 5 },
            maxDelta: 2,
        });
    });

    it('restores nested print options', async () => {
        savedOptions = {
            printAllOptions: {
                clean: true,
                printPilotData: false,
                recordSheetCenterPanelContent: 'fluffImage',
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'enlarged',
                printMargin: 'none',
            },
        };

        const service = await createService();

        expect(service.options().printAllOptions).toEqual({
            clean: true,
            printPilotData: false,
            recordSheetCenterPanelContent: 'fluffImage',
            ASPrintPageBreakOnGroups: false,
            ASPrintCardSize: 'enlarged',
            printMargin: 'none',
        });
    });

    it('uses CBT optional-rule defaults', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().CBTOptionalRules).toEqual({
            forcedWithdrawal: true,
            extremeRange: false,
            floatingCriticals: false,
            sprinting: false,
        });
    });

    it('uses the current CBT automation defaults', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().cbtAutomationOptions).toEqual({
            pilotSkillCheck: 'no',
            heatAndDissipationResolution: 'no',
            heatEffectsCheck: 'no',
            pilotHitsAndConsciousnessCheck: 'no',
            internalExplosionsCheck: 'ask',
            criticalHitChanceCheck: 'no',
            breachAndFloodCheck: 'no',
            fallingCheck: 'no',
        });
    });

    it('restores and validates current CBT automation modes per setting', async () => {
        savedOptions = {
            cbtAutomationOptions: {
                pilotSkillCheck: 'yes',
                heatAndDissipationResolution: 'ask',
                heatEffectsCheck: 'sometimes',
                internalExplosionsCheck: 'no',
                breachAndFloodCheck: 'ask',
            },
        };

        const service = await createService();

        expect(service.options().cbtAutomationOptions).toEqual({
            pilotSkillCheck: 'yes',
            heatAndDissipationResolution: 'ask',
            heatEffectsCheck: 'no',
            pilotHitsAndConsciousnessCheck: 'no',
            internalExplosionsCheck: 'no',
            criticalHitChanceCheck: 'no',
            breachAndFloodCheck: 'ask',
            fallingCheck: 'no',
        });
    });

    it('updates and persists the canonical CBT automation settings', async () => {
        savedOptions = null;
        const service = await createService();

        await service.setCbtAutomationMode('pilotSkillCheck', 'yes');

        expect(service.cbtAutomationMode('pilotSkillCheck')).toBe('yes');
        expect(service.options().cbtAutomationOptions.pilotSkillCheck).toBe('yes');
        expect(dbService.saveOptions).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            cbtAutomationOptions: jasmine.objectContaining({ pilotSkillCheck: 'yes' }),
        }));
    });

    it('restores structured CBT optional rules', async () => {
        savedOptions = {
            CBTOptionalRules: {
                forcedWithdrawal: false,
                extremeRange: true,
                floatingCriticals: true,
                sprinting: true,
            },
        };

        const service = await createService();

        expect(service.options().CBTOptionalRules).toEqual({
            forcedWithdrawal: false,
            extremeRange: true,
            floatingCriticals: true,
            sprinting: true,
        });
    });

    it('restores the last Unit Search view mode', async () => {
        savedOptions = { unitSearchViewMode: 'chassis' };

        const service = await createService();

        expect(service.initialized()).toBeTrue();
        expect(service.options().unitSearchViewMode).toBe('chassis');
    });

    it('restores the canonical theme color', async () => {
        savedOptions = { colorScheme: 'night' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('night');
    });

    it('persists option updates', async () => {
        savedOptions = { colorScheme: 'night' };
        const service = await createService();

        await service.setOption('colorScheme', 'default');

        expect(dbService.saveOptions).toHaveBeenCalledWith(jasmine.objectContaining({
            colorScheme: 'default',
        }));
    });
});
