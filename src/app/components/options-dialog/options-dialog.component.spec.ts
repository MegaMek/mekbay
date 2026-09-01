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

describe('OptionsDialogComponent', () => {
    function configureComponent(optionsService: object): OptionsDialogComponent {
        TestBed.configureTestingModule({
            providers: [
                { provide: AccountAuthService, useValue: { authInFlight: signal(false) } },
                { provide: AppUpdateService, useValue: {} },
                { provide: DataService, useValue: { getUnits: () => [], getEquipmentRegistry: () => new EquipmentRegistry({}) } },
                { provide: DbService, useValue: { getCanvasStoreSize: () => Promise.resolve(0) } },
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
        return TestBed.runInInjectionContext(() => new OptionsDialogComponent());
    }

    it('persists the selected force viewer BV/PV display mode', () => {
        const setOption = jasmine.createSpy('setOption');
        const component = configureComponent({ options: () => ({}), setOption });
        const select = document.createElement('select');
        select.innerHTML = '<option value="both">Both</option>';
        select.value = 'both';

        component.onForceViewerBVPVDisplayChange({ target: select } as unknown as Event);
        expect(setOption).toHaveBeenCalledOnceWith('forceViewerBVPVDisplay', 'both');
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
        });
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
                { provide: DbService, useValue: { getCanvasStoreSize: () => Promise.resolve(0) } },
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
});
