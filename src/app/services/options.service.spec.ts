// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { DbService } from './db.service';
import { OptionsService } from './options.service';

describe('OptionsService theme migration', () => {
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

    it('defaults old saves to Inner Sphere first and persists the selected name format', async () => {
        savedOptions = {};
        let service = await createService();
        expect(service.options().displayUnitNameFormat).toBe('innerSphereClan');
        await service.setOption('displayUnitNameFormat', 'clanInnerSphere');
        expect(dbService.saveOptions).toHaveBeenCalledWith(jasmine.objectContaining({ displayUnitNameFormat: 'clanInnerSphere' }));
        TestBed.resetTestingModule();
        savedOptions = { displayUnitNameFormat: 'clanInnerSphere' };
        service = await createService();
        expect(service.options().displayUnitNameFormat).toBe('clanInnerSphere');
        TestBed.resetTestingModule();
        savedOptions = { displayUnitNameFormat: 'invalid' };
        service = await createService();
        expect(service.options().displayUnitNameFormat).toBe('innerSphereClan');
    });

    it('uses the normal theme by default', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().colorScheme).toBe('default');
    });

    it('defaults CBT units to Sheet View', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().cbtUnitViewMode).toBe('sheet');
    });

    it('restores and validates the CBT unit view preference', async () => {
        savedOptions = { cbtUnitViewMode: 'tactical' };
        let service = await createService();

        expect(service.options().cbtUnitViewMode).toBe('tactical');

        TestBed.resetTestingModule();
        savedOptions = { cbtUnitViewMode: 'invalid' };
        service = await createService();

        expect(service.options().cbtUnitViewMode).toBe('sheet');
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

    it('defaults CBT force BV to the current damaged state', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().forceViewerBVPVDisplayDamage).toBe('damaged');
    });

    it('restores and validates the CBT force BV damage policy', async () => {
        savedOptions = { forceViewerBVPVDisplayDamage: 'pristine' };

        const service = await createService();

        expect(service.options().forceViewerBVPVDisplayDamage).toBe('pristine');
    });

    it('uses complete print defaults', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().printAllOptions).toEqual({
            clean: false,
            printPilotData: true,
            paperSize: 'letter',
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: true,
            ASPrintCardSize: 'standard',
            printMargin: 'browserDefined',
        });
    });

    it('restores nested print options and validates each field independently', async () => {
        savedOptions = {
            printAllOptions: {
                clean: true,
                printPilotData: false,
                paperSize: 'a4',
                recordSheetCenterPanelContent: 'invalid',
                ASPrintPageBreakOnGroups: false,
                ASPrintCardSize: 'enlarged',
                printMargin: 'invalid',
            },
        };

        const service = await createService();

        expect(service.options().printAllOptions).toEqual({
            clean: true,
            printPilotData: false,
            paperSize: 'a4',
            recordSheetCenterPanelContent: 'clusterTable',
            ASPrintPageBreakOnGroups: false,
            ASPrintCardSize: 'enlarged',
            printMargin: 'browserDefined',
        });
    });

    it('migrates the former flat print preferences', async () => {
        savedOptions = {
            printPaperSize: 'a4',
            recordSheetCenterPanelContent: 'fluffImage',
            ASPrintPageBreakOnGroups: false,
            ASPrintCardSize: 'enlarged',
            printMargin: 'none',
        };

        const service = await createService();

        expect(service.options().printAllOptions).toEqual(jasmine.objectContaining({
            paperSize: 'a4',
            recordSheetCenterPanelContent: 'fluffImage',
            ASPrintPageBreakOnGroups: false,
            ASPrintCardSize: 'enlarged',
            printMargin: 'none',
        }));
    });

    it('migrates the legacy heat automation preference without enabling unrelated automations', async () => {
        savedOptions = { cbtAutomations: false };

        const service = await createService();

        expect(service.cbtAutomationMode('heatAndDissipationResolution')).toBe('no');
        expect(service.cbtAutomationMode('internalExplosionsCheck')).toBe('ask');
    });

    it('restores and updates independent CBT automation modes', async () => {
        savedOptions = {
            cbtAutomationOptions: {
                heatAndDissipationResolution: 'yes',
                pilotSkillCheck: 'ask',
                criticalHitChanceCheck: 'invalid',
            },
        };
        const service = await createService();

        expect(service.cbtAutomationMode('heatAndDissipationResolution')).toBe('yes');
        expect(service.cbtAutomationMode('pilotSkillCheck')).toBe('ask');
        expect(service.cbtAutomationMode('criticalHitChanceCheck')).toBe('no');

        await service.setCbtAutomationMode('fallingCheck', 'yes');
        expect(service.cbtAutomationMode('fallingCheck')).toBe('yes');
        expect(dbService.saveOptions).toHaveBeenCalled();
    });

    it('uses CBT optional-rule defaults', async () => {
        savedOptions = null;

        const service = await createService();

        expect(service.options().CBTOptionalRules).toEqual({
            floatingCriticals: false,
            forcedWithdrawal: true,
            extremeRange: false,
            sprinting: false,
            allowMixedTechBaseAmmo: false,
        });
    });

    it('restores structured CBT optional rules', async () => {
        savedOptions = {
            CBTOptionalRules: {
                forcedWithdrawal: false,
                extremeRange: true,
                floatingCriticals: true,
                sprinting: true,
                allowMixedTechBaseAmmo: true,
            },
        };

        const service = await createService();

        expect(service.options().CBTOptionalRules).toEqual({
            floatingCriticals: true,
            forcedWithdrawal: false,
            extremeRange: true,
            sprinting: true,
            allowMixedTechBaseAmmo: true,
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

    it('migrates legacy sheet and Alpha Strike color settings deterministically', async () => {
        savedOptions = { sheetsColor: 'normal', ASCardStyle: 'colored' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('default');
    });

    it('maps a legacy colored Alpha Strike card style when no sheet color exists', async () => {
        savedOptions = { ASCardStyle: 'colored' };

        const service = await createService();

        expect(service.options().colorScheme).toBe('night');
    });

    it('persists only canonical theme options after an update', async () => {
        savedOptions = { sheetsColor: 'night', ASCardStyle: 'monochrome' };
        const service = await createService();

        await service.setOption('colorScheme', 'default');

        const persisted = dbService.saveOptions.calls.mostRecent().args[0] as Record<string, unknown>;
        expect(persisted['colorScheme']).toBe('default');
        expect(persisted['themeColor']).toBeUndefined();
        expect(persisted['sheetsColor']).toBeUndefined();
        expect(persisted['ASCardStyle']).toBeUndefined();
    });
});
