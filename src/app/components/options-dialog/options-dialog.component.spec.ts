// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogRef } from '@angular/cdk/dialog';
import { AccountAuthService } from '../../services/account-auth.service';
import { EquipmentRegistry } from '../../models/equipment-lookup';
import { createEquipment } from '../../models/equipment.model';
import { AppUpdateService } from '../../services/app-update.service';
import { DataService } from '../../services/data.service';
import { DbService } from '../../services/db.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { LoggerService } from '../../services/logger.service';
import { OptionsService } from '../../services/options.service';
import { PublicTagsService } from '../../services/public-tags.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { TaggingService } from '../../services/tagging.service';
import { TagsService } from '../../services/tags.service';
import { ToastService } from '../../services/toast.service';
import { UserStateService } from '../../services/userState.service';
import { DisplayNameService } from '../../services/display-name.service';
import { OptionsDialogComponent } from './options-dialog.component';
import { UnitArtworkService } from '../../services/unit-artwork.service';
import { CustomUnitsService } from '../../services/custom-units.service';

describe('OptionsDialogComponent', () => {
    function configureComponent(
        optionsService: object,
        userStateService: object = {
            uuid: signal(''),
            publicId: signal(''),
            displayName: signal(''),
            availableAuthProviders: signal([]),
            oauthProviders: signal([]),
            hasOAuth: signal(false),
        },
        toastService: object = {},
    ): OptionsDialogComponent {
        TestBed.configureTestingModule({
            providers: [
                { provide: AccountAuthService, useValue: { authInFlight: signal(false) } },
                { provide: AppUpdateService, useValue: {} },
                { provide: DataService, useValue: { getUnits: () => [], requireApplicationCatalogReady: async () => undefined, getEquipmentRegistry: () => new EquipmentRegistry({}) } },
                { provide: DbService, useValue: { getCanvasStoreSize: () => Promise.resolve(0), listCustomUnits: async () => [] } },
                { provide: UnitArtworkService, useValue: { initialize: async () => undefined, records: signal(new Map()), count: signal(0), bytes: signal(0), purge: jasmine.createSpy('purge').and.resolveTo() } },
                { provide: CustomUnitsService, useValue: { initialize: async () => undefined, records: signal([]) } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DialogsService, useValue: {} },
                { provide: DisplayNameService, useValue: { save: jasmine.createSpy('save'), generate: jasmine.createSpy('generate') } },
                { provide: GameService, useValue: {} },
                { provide: LoggerService, useValue: {} },
                { provide: OptionsService, useValue: optionsService },
                { provide: PublicTagsService, useValue: { version: signal(0), getOwnTagSubscriberCounts: () => Promise.resolve({}) } },
                { provide: SpriteStorageService, useValue: { getIconCount: () => Promise.resolve(0) } },
                { provide: TaggingService, useValue: {} },
                { provide: TagsService, useValue: { version: signal(0) } },
                { provide: ToastService, useValue: toastService },
                { provide: UserStateService, useValue: userStateService },
            ],
        });
        return TestBed.runInInjectionContext(() => new OptionsDialogComponent());
    }

    it('protects catalogue, owned, subscribed, and unprojected units and rechecks before purging unused artwork', async () => {
        const component = configureComponent({ options: () => ({}) });
        const uuids = Array.from({ length: 5 }, (_, i) => `019f6767-0dcb-7bb8-992f-00000000001${i}`);
        (TestBed.inject(UnitArtworkService).records as any).set(new Map(uuids.map(uuid => [uuid, { fluff: new Blob(['png'], { type: 'image/png' }) }])));
        spyOn(component.dataService, 'getUnits').and.returnValue([{ uuid: uuids[0] }] as any);
        (TestBed.inject(CustomUnitsService).records as any).set([{ uuid: uuids[1], owned: true }, { uuid: uuids[2], owned: false }]);
        const stored = [{ uuid: uuids[3], owned: false }];
        spyOn(component.dbService, 'listCustomUnits').and.callFake(async () => stored);
        (component.dialogsService as any).requestConfirmation = jasmine.createSpy('confirm').and.callFake(async () => {
            expect(component.unusedArtworkUuids()).toEqual(uuids.slice(4) as any);
            stored.push({ uuid: uuids[4], owned: false });
            return true;
        });
        expect(component.unusedArtworkUuids()).toEqual([]);
        await component.onPurgeArtwork(true);
        expect(component.artwork.purge).toHaveBeenCalledOnceWith([]);
        expect(component.artworkCollectionReady()).toBeTrue(); expect(component.unusedArtworkUuids()).toEqual([]);
    });
    it('does not purge unused artwork when the complete collection cannot be loaded', async () => {
        const component = configureComponent({ options: () => ({}) });
        spyOn(component.dataService, 'requireApplicationCatalogReady').and.rejectWith(new Error('Catalogue unavailable'));
        await component.onPurgeArtwork(true);
        expect(component.artwork.purge).not.toHaveBeenCalled();
        expect(component.artworkCollectionReady()).toBeFalse(); expect(component.artworkError()).toContain('Catalogue unavailable');
    });

    it('returns from mobile details before closing the dialog', () => {
        const component = configureComponent({ options: () => ({}) });
        const close = spyOn(component.dialogRef, 'close');

        component.openMobileSection('Search');
        expect(component.mobileHeaderTitle()).toBe('Search');

        component.onMobileBack();
        expect(component.mobileDetailOpen()).toBeFalse();
        expect(component.mobileHeaderTitle()).toBe('Options');
        expect(component.activeTab()).toBe('Search');
        expect(close).not.toHaveBeenCalled();

        component.onMobileBack();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('keeps the selected section when resizing and resets mobile navigation on a desktop selection', () => {
        const component = configureComponent({ options: () => ({}) });
        component.isWideLayout.set(false);
        component.openMobileSection('Tags');

        component.isWideLayout.set(true);
        expect(component.currentViewDefinition().id).toBe('Tags');
        component.isWideLayout.set(false);
        expect(component.mobileDetailOpen()).toBeTrue();

        component.isWideLayout.set(true);
        component.selectDesktopSection('Account');
        component.isWideLayout.set(false);
        expect(component.mobileDetailOpen()).toBeFalse();
        expect(component.currentViewDefinition().id).toBe('Account');
    });

    it('persists the selected unit name order', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({}), setOption });
        const select = document.createElement('select');
        select.innerHTML = '<option value="clanInnerSphere">Clan (Inner Sphere)</option>';
        component.onDisplayUnitNameFormatChange({ target: select } as unknown as Event);
        expect(setOption).toHaveBeenCalledWith('displayUnitNameFormat', 'clanInnerSphere');
    });

    it('persists the selected force viewer BV/PV display mode', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({}), setOption });
        const select = document.createElement('select');
        select.innerHTML = '<option value="adjustedPreSkill">Adjusted before skills</option>';
        select.value = 'adjustedPreSkill';

        component.onForceViewerBVPVDisplayChange({ target: select } as unknown as Event);
        expect(setOption).toHaveBeenCalledOnceWith('forceViewerBVPVDisplay', 'adjustedPreSkill');
    });

    it('persists the selected CBT force viewer damage policy', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({}), setOption });
        const select = document.createElement('select');
        select.innerHTML = '<option value="pristine">Pristine</option>';
        select.value = 'pristine';

        component.onForceViewerBVPVDisplayDamageChange({ target: select } as unknown as Event);

        expect(setOption).toHaveBeenCalledOnceWith('forceViewerBVPVDisplayDamage', 'pristine');
    });

    it('persists the selected CBT unit view', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({}), setOption });

        component.onCBTUnitViewModeChange(true);

        expect(setOption).toHaveBeenCalledOnceWith('cbtUnitViewMode', 'tactical');
    });

    for (const value of ['classic', 'distributed', 'rail']) {
        it(`persists the selected ${value} record-sheet pip layout`, () => {
            const setOption = jasmine.createSpy('setOption');
            const component = configureComponent({ options: () => ({}), setOption });
            const select = document.createElement('select');
            select.add(new Option(value, value));

            component.onRecordSheetPipLayoutChange({ target: select } as unknown as Event);

            expect(setOption).toHaveBeenCalledOnceWith('recordSheetPipLayout', value);
        });
    }

    for (const paperSize of ['letter', 'a4'] as const) {
        it(`updates the shared ${paperSize} print preference`, () => {
            const setPrintOption = jasmine.createSpy('setPrintOption');
            const component = configureComponent({ options: () => ({}), setPrintOption });
            const select = document.createElement('select');
            select.add(new Option(paperSize, paperSize));

            component.onRecordSheetPaperSizeChange({ target: select } as unknown as Event);

            expect(setPrintOption).toHaveBeenCalledOnceWith('paperSize', paperSize);
        });
    }

    it('updates the shared record sheet center panel preference', () => {
        const setPrintOption = jasmine.createSpy('setPrintOption');
        const component = configureComponent({ options: () => ({}), setPrintOption });
        const select = document.createElement('select');
        select.add(new Option('Artwork', 'fluffImage'));

        component.onRecordSheetCenterPanelContentChange({ target: select } as unknown as Event);

        expect(setPrintOption).toHaveBeenCalledOnceWith('recordSheetCenterPanelContent', 'fluffImage');
    });

    it('persists each CBT automation mode independently', () => {
        const setCbtAutomationMode = jasmine.createSpy('setCbtAutomationMode');
        const component = configureComponent({ options: () => ({}), setCbtAutomationMode });

        component.onCbtAutomationModeChange('criticalHitChanceCheck', 'ask');

        expect(setCbtAutomationMode).toHaveBeenCalledOnceWith('criticalHitChanceCheck', 'ask');
    });

    it('updates one CBT optional rule without changing the other', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({
            options: () => ({
                CBTOptionalRules: {
                    floatingCriticals: false,
                    forcedWithdrawal: true,
                    extremeRange: false,
                    sprinting: false,
                    allowMixedTechBaseAmmo: false,
                },
            }),
            setOption,
        });
        const select = document.createElement('select');
        select.innerHTML = '<option value="true">Enabled</option><option value="false">Disabled</option>';
        select.value = 'false';

        component.onCBTOptionalRuleChange('forcedWithdrawal', { target: select } as unknown as Event);

        expect(setOption).toHaveBeenCalledOnceWith('CBTOptionalRules', {
            floatingCriticals: false,
            forcedWithdrawal: false,
            extremeRange: false,
            sprinting: false,
            allowMixedTechBaseAmmo: false,
        });
    });

    it('reads the Quirks checkbox as a boolean and preserves other optional rules', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({ CBTOptionalRules: { quirks: true, forcedWithdrawal: true } }), setOption });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;
        component.onCBTOptionalRuleChange('quirks', { target: checkbox } as unknown as Event);
        expect(setOption).toHaveBeenCalledOnceWith('CBTOptionalRules', { quirks: false, forcedWithdrawal: true });
    });

    it('counts canonical equipment registry entries rather than lookup aliases', () => {
        const registry = new EquipmentRegistry({
            CanonicalOne: createEquipment({
                id: 'CanonicalOne',
                name: 'Canonical One',
                type: 'misc',
                aliases: ['One Alias'],
            }),
            CanonicalTwo: createEquipment({
                id: 'CanonicalTwo',
                name: 'Canonical Two',
                type: 'misc',
            }),
        });
        const getEquipmentRegistry = jasmine.createSpy('getEquipmentRegistry').and.returnValue(registry);

        TestBed.configureTestingModule({
            providers: [
                { provide: AccountAuthService, useValue: { authInFlight: signal(false) } },
                { provide: AppUpdateService, useValue: {} },
                { provide: DataService, useValue: { getUnits: () => [], getEquipmentRegistry } },
                { provide: DbService, useValue: { getCanvasStoreSize: () => Promise.resolve(0), listCustomUnits: async () => [] } },
                { provide: UnitArtworkService, useValue: { initialize: async () => undefined, records: signal(new Map()), count: signal(0), bytes: signal(0), purge: jasmine.createSpy('purge').and.resolveTo() } },
                { provide: CustomUnitsService, useValue: { initialize: async () => undefined, records: signal([]) } },
                { provide: DialogRef, useValue: { close: () => undefined } },
                { provide: DialogsService, useValue: {} },
                { provide: DisplayNameService, useValue: { save: jasmine.createSpy('save'), generate: jasmine.createSpy('generate') } },
                { provide: GameService, useValue: {} },
                { provide: LoggerService, useValue: {} },
                { provide: OptionsService, useValue: { options: () => ({}) } },
                { provide: PublicTagsService, useValue: { version: signal(0), getOwnTagSubscriberCounts: () => Promise.resolve({}) } },
                { provide: SpriteStorageService, useValue: { getIconCount: () => Promise.resolve(0) } },
                { provide: TaggingService, useValue: {} },
                { provide: TagsService, useValue: { version: signal(0) } },
                { provide: ToastService, useValue: {} },
                {
                    provide: UserStateService,
                    useValue: {
                        uuid: signal(''),
                        publicId: signal(''),
                        displayName: signal(''),
                        availableAuthProviders: signal([]),
                        oauthProviders: signal([]),
                        hasOAuth: signal(false),
                    },
                },
            ],
        });

        const component = TestBed.runInInjectionContext(() => new OptionsDialogComponent());

        expect(component.equipmentCount()).toBe(2);
        expect(getEquipmentRegistry).toHaveBeenCalled();
    });

    it('copies the user UUID to the clipboard', async () => {
        const writeText = jasmine.createSpy('writeText').and.resolveTo();
        const showToast = jasmine.createSpy('showToast');
        const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const component = configureComponent(
            { options: () => ({ unitServers: [] }) },
            {
                uuid: signal('test-user-uuid'),
                publicId: signal(''),
                displayName: signal(''),
                availableAuthProviders: signal([]),
                oauthProviders: signal([]),
                hasOAuth: signal(false),
            },
            { showToast },
        );

        try {
            await component.copyUserUuid();

            expect(writeText).toHaveBeenCalledOnceWith('test-user-uuid');
            expect(showToast).toHaveBeenCalledOnceWith('User identifier copied to clipboard.', 'success');
        } finally {
            if (originalClipboard) {
                Object.defineProperty(navigator, 'clipboard', originalClipboard);
            } else {
                delete (navigator as { clipboard?: Clipboard }).clipboard;
            }
        }
    });
});
