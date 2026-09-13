// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, Subject, take } from 'rxjs';
import { routes } from '../app.routes';
import { UnitConstructionButtonComponent } from '../construction/unit-construction-button.component';
import { UnitConstructionComponent } from '../construction/unit-construction.component';
import type { CBTForce } from '../models/cbt-force.model';
import { TestBipedMekEntity } from '../models/entity/testing/test-entities';
import { CBTForceMember } from '../models/force-member.model';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { ToastService } from '../services/toast.service';
import { CustomUnitSyncService } from '../services/custom-unit-sync.service';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { UnitConstructionPageComponent } from './unit-construction-page.component';

describe('MekLab routing', () => {
    const core = createEmptyUnit({ uuid: '019f6767-0dcb-7bb8-992f-000000000001' });
    const custom = createEmptyUnit({ uuid: '019f6767-0dcb-7bb8-992f-000000000002', origin: 'user' });
    let ready: ReturnType<typeof signal<boolean>>;
    let router: Router;
    let harness: RouterTestingHarness;
    let editor: jasmine.SpyObj<Pick<UnitConstructionComponent, 'openUnit' | 'openForceMember' | 'createNew' | 'canLeave'>> & {
        routeUuid: ReturnType<typeof signal<typeof core.uuid | undefined>>;
        busy: ReturnType<typeof signal<boolean>>;
    };
    let createDialog: jasmine.Spy;
    let closeDialog: jasmine.Spy;
    let toast: jasmine.Spy;
    let closed: Subject<void>;
    let opened: Promise<void>;
    let cloudUnit: typeof custom | undefined;
    let openShared: jasmine.Spy;

    beforeEach(async () => {
        ready = signal(true);
        cloudUnit = undefined;
        openShared = jasmine.createSpy('openShared').and.resolveTo();
        closed = new Subject<void>();
        editor = Object.assign(jasmine.createSpyObj('editor', ['openUnit', 'openForceMember', 'createNew', 'canLeave']), {
            routeUuid: signal<typeof core.uuid | undefined>(undefined), busy: signal(false),
        });
        editor.openUnit.and.callFake(async unit => { editor.routeUuid.set(unit.uuid); });
        editor.openForceMember.and.callFake(async member => { editor.routeUuid.set(member.entity.uuid()); });
        editor.createNew.and.callFake(async () => { editor.routeUuid.set(undefined); });
        editor.canLeave.and.resolveTo(true);
        closeDialog = jasmine.createSpy('close').and.callFake(() => closed.next());
        let resolveOpened!: () => void;
        opened = new Promise(resolve => { resolveOpened = resolve; });
        createDialog = jasmine.createSpy('createDialog').and.callFake(() => {
            resolveOpened();
            return { componentInstance: editor, closed, close: closeDialog };
        });
        toast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                provideRouter(routes),
                provideLocationMocks(),
                { provide: DataService, useValue: {
                    isDataReady: ready,
                    getUnitByUuid: (uuid: string) => [core, custom, cloudUnit].find(unit => unit?.uuid === uuid),
                } },
                { provide: DialogsService, useValue: { createDialog } },
                { provide: ToastService, useValue: { showToast: toast } },
                { provide: CustomUnitSyncService, useValue: { openShared } },
            ],
        });
        router = TestBed.inject(Router);
        harness = await RouterTestingHarness.create();
    });

    async function open(url: string): Promise<UnitConstructionPageComponent> {
        const page = await harness.navigateByUrl(url, UnitConstructionPageComponent);
        await opened;
        await harness.fixture.whenStable();
        return page;
    }

    function forceMember(readOnly = false): CBTForceMember {
        const entity = new TestBipedMekEntity();
        entity.uuid.set(core.uuid);
        const force = { readOnly: signal(readOnly), getCBTMember: () => member } as unknown as CBTForce;
        const member = new CBTForceMember('force-unit', force, entity);
        return member;
    }

    it('opens a new design at /meklab and lets routing own dialog dismissal', async () => {
        await open('/meklab');
        expect(createDialog).toHaveBeenCalledOnceWith(UnitConstructionComponent, {
            disableClose: true, closeOnNavigation: false,
        });
        expect(editor.openUnit).not.toHaveBeenCalled();
        expect(editor.openForceMember).not.toHaveBeenCalled();
    });

    for (const unit of [core, custom]) {
        it(`opens a ${unit.origin} unit directly by UUID without navigation state`, async () => {
            await open(`/meklab/${unit.uuid}`);
            expect(editor.openUnit).toHaveBeenCalledOnceWith(unit);
            expect(editor.openForceMember).not.toHaveBeenCalled();
        });
    }

    it('waits for the catalog before resolving a deep link', async () => {
        ready.set(false);
        const navigation = harness.navigateByUrl(`/meklab/${core.uuid}`);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(createDialog).not.toHaveBeenCalled();
        ready.set(true);
        await navigation;
        await opened;
        await harness.fixture.whenStable();
        expect(editor.openUnit).toHaveBeenCalledOnceWith(core);
    });

    it('opens a shared custom MekLab link after fetching a missing design', async () => {
        const uuid = '019f6767-0dcb-7bb8-992f-000000000099';
        openShared.and.callFake(async () => { cloudUnit = createEmptyUnit({ uuid, origin: 'user', isCustom: true }); });
        await open(`/meklab/${uuid}`);
        expect(openShared).toHaveBeenCalledOnceWith(uuid);
        expect(editor.openUnit).toHaveBeenCalledOnceWith(cloudUnit!);
    });

    it('opens a search unit through the shared button and preserves query parameters', async () => {
        await harness.navigateByUrl('/?q=hunchback&gs=cbt');
        const button = TestBed.createComponent(UnitConstructionButtonComponent);
        button.componentRef.setInput('unit', core);
        await button.componentInstance.open();
        await opened;
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${core.uuid}?q=hunchback&gs=cbt`);
        expect(editor.openUnit).toHaveBeenCalledOnceWith(core);
    });

    it('preserves the exact force member for a refit without serializing it into history', async () => {
        const member = forceMember();
        const button = TestBed.createComponent(UnitConstructionButtonComponent);
        button.componentRef.setInput('unit', core);
        button.componentRef.setInput('forceMember', member);
        await button.componentInstance.open();
        await opened;
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${core.uuid}`);
        expect(editor.openForceMember).toHaveBeenCalledOnceWith(member);
        expect(editor.openUnit).not.toHaveBeenCalled();
        expect(TestBed.inject(Location).getState()).toEqual(jasmine.objectContaining({ navigationId: jasmine.any(Number) }));
    });

    it('keeps read-only force refits disabled', async () => {
        const button = TestBed.createComponent(UnitConstructionButtonComponent);
        button.componentRef.setInput('unit', core);
        button.componentRef.setInput('forceMember', forceMember(true));
        await button.componentInstance.open();
        expect(createDialog).not.toHaveBeenCalled();
        expect(router.url).toBe('/');
    });

    it('refuses a stale force member when resolving the route', async () => {
        const member = forceMember();
        spyOn(member.force, 'getCBTMember').and.returnValue(null);
        await router.navigate(['/meklab', core.uuid], { info: member });
        expect(router.url).toBe('/');
        expect(createDialog).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith('This force unit is no longer available for refitting.', 'error');
    });

    for (const uuid of ['not-a-uuid', '019f6767-0dcb-7bb8-992f-000000000099']) {
        it(`reports an unavailable deep link (${uuid}) without opening a blank editor`, async () => {
            await harness.navigateByUrl(`/meklab/${uuid}?q=hunchback`);
            expect(router.url).toBe('/?q=hunchback');
            expect(createDialog).not.toHaveBeenCalled();
            expect(toast).toHaveBeenCalledWith(jasmine.any(String), 'error');
        });
    }

    it('checks unsaved changes before loading a different UUID into the reused page', async () => {
        const page = await open(`/meklab/${core.uuid}`);
        editor.canLeave.and.resolveTo(false);
        expect(await router.navigateByUrl(`/meklab/${custom.uuid}`)).toBeFalse();
        expect(router.url).toBe(`/meklab/${core.uuid}`);
        expect(editor.openUnit).toHaveBeenCalledTimes(1);
        editor.canLeave.and.resolveTo(true);
        const nextPage = await open(`/meklab/${custom.uuid}`);
        expect(nextPage).toBe(page);
        expect(createDialog).toHaveBeenCalledTimes(1);
        expect(editor.openUnit).toHaveBeenCalledWith(custom);
        expect(closeDialog).not.toHaveBeenCalled();
    });

    it('does not reload the design when query parameters change', async () => {
        await open(`/meklab/${core.uuid}`);
        await router.navigate([], { queryParams: { q: 'atlas' } });
        expect(editor.openUnit).toHaveBeenCalledTimes(1);
        expect(editor.canLeave).not.toHaveBeenCalled();
    });

    it('updates the URL when the editor selects another unit without reopening it', async () => {
        const page = await open(`/meklab/${core.uuid}?q=hunchback&gs=cbt#loadout`);
        editor.canLeave.and.resolveTo(false);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${custom.uuid}?q=hunchback&gs=cbt#loadout`);
        expect(TestBed.inject(Location).path(true)).toBe(router.url);
        expect(harness.routeDebugElement?.componentInstance).toBe(page);
        expect(editor.openUnit).toHaveBeenCalledOnceWith(core);
        expect(editor.canLeave).not.toHaveBeenCalled();
        expect(createDialog).toHaveBeenCalledTimes(1);
        expect(closeDialog).not.toHaveBeenCalled();
    });

    it('keeps the working editor across saving a new UUID and starting another draft', async () => {
        const page = await open('/meklab?q=hunchback');
        // A just-saved design need not have reached the search catalog yet.
        const savedUuid = createEmptyUnit({ uuid: '019f6767-0dcb-7bb8-992f-000000000003' }).uuid;
        editor.canLeave.and.resolveTo(false);
        editor.routeUuid.set(savedUuid);
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${savedUuid}?q=hunchback`);
        editor.routeUuid.set(undefined);
        await harness.fixture.whenStable();
        expect(router.url).toBe('/meklab?q=hunchback');
        expect(harness.routeDebugElement?.componentInstance).toBe(page);
        expect(editor.createNew).toHaveBeenCalledTimes(1);
        expect(editor.openUnit).not.toHaveBeenCalled();
        expect(editor.canLeave).not.toHaveBeenCalled();
        expect(openShared).not.toHaveBeenCalled();
        expect(createDialog).toHaveBeenCalledTimes(1);
        expect(closeDialog).not.toHaveBeenCalled();
    });

    it('waits for a save to settle before updating its URL', async () => {
        await open(`/meklab/${core.uuid}`);
        editor.busy.set(true);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${core.uuid}`);
        editor.busy.set(false);
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${custom.uuid}`);
    });

    it('loads external UUID and new-design navigation after an editor URL update', async () => {
        const page = await open(`/meklab/${core.uuid}`);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        editor.canLeave.and.resolveTo(false);
        expect(await router.navigateByUrl(`/meklab/${core.uuid}`)).toBeFalse();
        expect(router.url).toBe(`/meklab/${custom.uuid}`);
        editor.canLeave.and.resolveTo(true);
        expect(await open(`/meklab/${core.uuid}`)).toBe(page);
        expect(editor.openUnit).toHaveBeenCalledTimes(2);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        expect(await open('/meklab')).toBe(page);
        expect(editor.createNew).toHaveBeenCalledTimes(1);
        expect(editor.routeUuid()).toBeUndefined();
        expect(createDialog).toHaveBeenCalledTimes(1);
    });

    it('preserves query-only navigation after the editor updates its URL', async () => {
        await open(`/meklab/${core.uuid}`);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        await router.navigate([], { queryParams: { q: 'atlas' } });
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${custom.uuid}?q=atlas`);
        expect(editor.openUnit).toHaveBeenCalledTimes(1);
        expect(editor.createNew).not.toHaveBeenCalled();
        expect(editor.canLeave).not.toHaveBeenCalled();
    });

    it('waits for a deep-linked design to load before syncing the editor identity', async () => {
        let finish!: () => void;
        editor.openUnit.and.callFake(() => new Promise<void>(resolve => {
            finish = () => { editor.routeUuid.set(core.uuid); resolve(); };
        }));
        await harness.navigateByUrl(`/meklab/${core.uuid}`, UnitConstructionPageComponent);
        await opened;
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${core.uuid}`);
        finish();
        await harness.fixture.whenStable();
        expect(router.url).toBe(`/meklab/${core.uuid}`);
        expect(editor.createNew).not.toHaveBeenCalled();
    });

    it('preserves the editor when browser Back is rejected, then closes it when leaving is allowed', async () => {
        router.setUpLocationChangeListener();
        await harness.navigateByUrl('/?q=hunchback');
        await open(`/meklab/${core.uuid}?q=hunchback`);
        editor.routeUuid.set(custom.uuid);
        await harness.fixture.whenStable();
        editor.canLeave.and.resolveTo(false);
        const cancelled = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationCancel), take(1)));
        TestBed.inject(Location).back();
        await cancelled;
        expect(router.url).toBe(`/meklab/${custom.uuid}?q=hunchback`);
        expect(closeDialog).not.toHaveBeenCalled();
        editor.canLeave.and.resolveTo(true);
        await router.navigateByUrl('/?q=hunchback');
        expect(closeDialog).toHaveBeenCalledTimes(1);
    });

    it('returns home with query parameters intact after the editor closes', async () => {
        await open(`/meklab/${core.uuid}?q=hunchback`);
        const navigated = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd), take(1)));
        closed.next();
        await navigated;
        expect(router.url).toBe('/?q=hunchback');
    });
});
