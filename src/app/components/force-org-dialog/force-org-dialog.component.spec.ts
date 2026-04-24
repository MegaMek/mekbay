import { DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { UrlStateService } from '../../services/url-state.service';
import { ForceOrgDialogComponent } from './force-org-dialog.component';

describe('ForceOrgDialogComponent', () => {
    let component: ForceOrgDialogComponent;
    let fixture: import('@angular/core/testing').ComponentFixture<ForceOrgDialogComponent>;
    let nextPlacementId = 0;
    let dialogRefStub: {
        close: jasmine.Spy;
        backdropClick: Subject<MouseEvent>;
        keydownEvents: Subject<KeyboardEvent>;
        disableClose: boolean;
    };

    const dataServiceStub = {
        listForces: jasmine.createSpy('listForces').and.resolveTo([]),
        getLoadForceEntriesByIds: jasmine.createSpy('getLoadForceEntriesByIds').and.resolveTo([]),
        getFactionById: jasmine.createSpy('getFactionById').and.returnValue(undefined),
        getEras: jasmine.createSpy('getEras').and.returnValue([]),
        saveOrganization: jasmine.createSpy('saveOrganization').and.resolveTo(undefined),
        getOrganization: jasmine.createSpy('getOrganization').and.resolveTo(null),
    };

    const dialogsServiceStub = {
        createDialog: jasmine.createSpy('createDialog'),
        choose: jasmine.createSpy('choose').and.resolveTo('cancel'),
        prompt: jasmine.createSpy('prompt').and.resolveTo(null),
        showError: jasmine.createSpy('showError').and.resolveTo(undefined),
    };

    const forceBuilderServiceStub = {
        selectedUnit: signal(null),
        loadedForces: signal([]),
    };

    const layoutServiceStub = {
        isMobile: signal(false),
    };

    const urlStateServiceStub = {
        setParams: jasmine.createSpy('setParams'),
    };

    beforeEach(async () => {
        nextPlacementId = 0;
        dialogRefStub = {
            close: jasmine.createSpy('close'),
            backdropClick: new Subject<MouseEvent>(),
            keydownEvents: new Subject<KeyboardEvent>(),
            disableClose: false,
        };

        await TestBed.configureTestingModule({
            imports: [ForceOrgDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: dialogRefStub },
                { provide: DataService, useValue: dataServiceStub },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: ForceBuilderService, useValue: forceBuilderServiceStub },
                { provide: LayoutService, useValue: layoutServiceStub },
                { provide: UrlStateService, useValue: urlStateServiceStub },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ForceOrgDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        dialogsServiceStub.choose.calls.reset();
        urlStateServiceStub.setParams.calls.reset();
    });

    function createPlacedForce(instanceId: string, x: number, y: number, groupId: string | null, placementId = `${instanceId}-placement-${nextPlacementId++}`) {
        return {
            placementId,
            force: {
                instanceId,
                groups: [],
                type: GameSystem.CLASSIC,
            },
            x: signal(x),
            y: signal(y),
            zIndex: signal(0),
            groupId,
        } as any;
    }

    function createGroup(id: string, x: number, y: number, width: number, height: number) {
        return {
            id,
            name: signal(''),
            parentGroupId: null,
            x: signal(x),
            y: signal(y),
            width: signal(width),
            height: signal(height),
            zIndex: signal(0),
        } as any;
    }

    function createBattleMek(name: string): Unit {
        return {
            name,
            id: -1,
            chassis: `Chassis ${name}`,
            model: `Model ${name}`,
            year: 3151,
            weightClass: 'Medium',
            tons: 50,
            offSpeedFactor: 0,
            bv: 1000,
            pv: 25,
            cost: 0,
            level: 0,
            techBase: 'Inner Sphere',
            techRating: 'D',
            type: 'Mek',
            subtype: 'BattleMek',
            omni: 0,
            engine: 'Fusion',
            engineRating: 0,
            engineHS: 0,
            engineHSType: 'Heat Sink',
            source: [],
            role: '',
            armorType: '',
            structureType: '',
            armor: 0,
            armorPer: 0,
            internal: 1,
            heat: 0,
            dissipation: 0,
            moveType: 'Tracked',
            walk: 0,
            walk2: 0,
            run: 0,
            run2: 0,
            jump: 0,
            umu: 0,
            c3: '',
            dpt: 0,
            comp: [],
            su: 0,
            crewSize: 1,
            quirks: [],
            features: [],
            icon: '',
            sheets: [],
            as: {
                TP: 'BM',
                PV: 25,
                SZ: 0,
                TMM: 0,
                usesOV: false,
                OV: 0,
                MV: '0',
                MVm: {},
                usesTh: false,
                Th: 0,
                Arm: 0,
                Str: 0,
                specials: [],
                dmg: {
                    dmgS: '0',
                    dmgM: '0',
                    dmgL: '0',
                    dmgE: '0',
                },
                usesE: false,
                usesArcs: false,
            },
            _searchKey: '',
            _displayType: '',
            _maxRange: 0,
            _weightedMaxRange: 0,
            _dissipationEfficiency: 0,
            _mdSumNoPhysical: 0,
            _mdSumNoPhysicalNoOneshots: 0,
            _nameTags: [],
            _chassisTags: [],
        };
    }

    function createLoadForce(instanceId: string, units: Unit[]): LoadForceEntry {
        return new LoadForceEntry({
            instanceId,
            name: `Force ${instanceId}`,
            type: GameSystem.CLASSIC,
            groups: [{
                units: units.map(unit => ({ unit, destroyed: false })),
            }],
        });
    }

    function createDeferred<T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    }

    async function flushPromises(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    function setDirtyState(isDirty: boolean): void {
        const baseline = isDirty
            ? '__dirty-baseline__'
            : (component as any).captureOrganizationSnapshot();
        (component as any).savedOrganizationSnapshot.set(baseline);
    }

    it('keeps a grouped force in place while its card still overlaps the group bounds', () => {
        const group = createGroup('group-1', 0, 0, 400, 300);
        const placedForce = createPlacedForce('force-1', 190, 100, group.id);

        (component as any).groups.set([group]);
        (component as any).placedForces.set([placedForce]);

        expect((component as any).detectForceDrop(placedForce)).toBeNull();
    });

    it('can move a grouped force directly into another overlapping group', () => {
        const originGroup = createGroup('group-1', 0, 0, 200, 300);
        const targetGroup = createGroup('group-2', 220, 0, 300, 300);
        const placedForce = createPlacedForce('force-1', 250, 100, originGroup.id);

        (component as any).groups.set([originGroup, targetGroup]);
        (component as any).placedForces.set([placedForce]);

        expect((component as any).detectForceDrop(placedForce)).toEqual({ type: 'join-group', groupId: targetGroup.id });
    });

    it('chooses the group with the largest overlap for force drops', () => {
        const weakerTarget = createGroup('group-1', 0, 0, 260, 300);
        const strongerTarget = createGroup('group-2', 180, 0, 320, 300);
        const placedForce = createPlacedForce('force-1', 220, 100, null);

        (component as any).groups.set([weakerTarget, strongerTarget]);
        (component as any).placedForces.set([placedForce]);

        expect((component as any).detectForceDrop(placedForce)).toEqual({ type: 'join-group', groupId: strongerTarget.id });
    });

    it('removes a grouped force only after its card no longer overlaps any group bounds', () => {
        const group = createGroup('group-1', 0, 0, 400, 300);
        const placedForce = createPlacedForce('force-1', 401, 100, group.id);

        (component as any).groups.set([group]);
        (component as any).placedForces.set([placedForce]);

        expect((component as any).detectForceDrop(placedForce)).toEqual({ type: 'leave-group' });
    });

    it('dissolves a top-level group when dragging a force out leaves one remaining force', () => {
        const group = createGroup('group-1', 0, 0, 400, 300);
        const draggedForce = createPlacedForce('force-1', 401, 100, group.id);
        const remainingForce = createPlacedForce('force-2', 100, 100, group.id);

        (component as any).groups.set([group]);
        (component as any).placedForces.set([draggedForce, remainingForce]);

        (component as any).tryFormGroup(draggedForce);

        expect(draggedForce.groupId).toBeNull();
        expect(remainingForce.groupId).toBeNull();
        expect((component as any).groups()).toEqual([]);
    });

    it('resolves sibling collisions when creating a new force group', () => {
        const draggedForce = createPlacedForce('force-1', 0, 0, null);
        const targetForce = createPlacedForce('force-2', 0, 0, null);

        (component as any).placedForces.set([draggedForce, targetForce]);
        (component as any).tryFormGroup(draggedForce);

        expect(draggedForce.groupId).toBe(targetForce.groupId);
        expect(draggedForce.groupId).not.toBeNull();
        expect(draggedForce.x() !== targetForce.x() || draggedForce.y() !== targetForce.y()).toBeTrue();
    });

    it('creates a shadow clone placement that keeps the same source force and group membership', () => {
        const group = createGroup('group-1', 0, 0, 400, 300);
        const mainForce = createPlacedForce('force-1', 100, 100, group.id, 'main-placement');

        (component as any).groups.set([group]);
        (component as any).placedForces.set([mainForce]);

        (component as any).shadowCloneForce(mainForce);

        const placed = (component as any).placedForces();
        expect(placed.length).toBe(2);
        expect(placed[1].placementId).not.toBe(mainForce.placementId);
        expect(placed[1].force).toBe(mainForce.force);
        expect(placed[1].groupId).toBe(group.id);
        expect((component as any).shadowCloneLabels().get(mainForce.placementId)).toBeUndefined();
        expect((component as any).shadowCloneLabels().get(placed[1].placementId)).toBe('Shadow 1');
    });

    it('promotes the earliest remaining shadow clone when the main placement is removed', () => {
        const mainForce = createPlacedForce('force-1', 0, 0, null, 'main-placement');

        (component as any).placedForces.set([mainForce]);
        (component as any).shadowCloneForce(mainForce);
        (component as any).shadowCloneForce(mainForce);

        const [, firstShadow, secondShadow] = (component as any).placedForces();
        expect((component as any).shadowCloneLabels().get(firstShadow.placementId)).toBe('Shadow 1');
        expect((component as any).shadowCloneLabels().get(secondShadow.placementId)).toBe('Shadow 2');

        (component as any).removeForce(mainForce);

        const remaining = (component as any).placedForces();
        expect(remaining).toEqual([firstShadow, secondShadow]);
        expect((component as any).shadowCloneLabels().get(firstShadow.placementId)).toBeUndefined();
        expect((component as any).shadowCloneLabels().get(secondShadow.placementId)).toBe('Shadow 1');
    });

    it('highlights all placements for a hovered force clone family', () => {
        const mainForce = createPlacedForce('force-1', 0, 0, null, 'main-placement');
        const shadowForce = createPlacedForce('force-1', 40, 0, null, 'shadow-placement');
        const otherForce = createPlacedForce('force-2', 80, 0, null, 'other-placement');

        (component as any).placedForces.set([mainForce, shadowForce, otherForce]);
        (component as any).hoveredForceId.set('shadow-placement');
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.querySelector('[data-force-id="main-placement"]')?.classList.contains('highlighted-hover')).toBeTrue();
        expect(host.querySelector('[data-force-id="shadow-placement"]')?.classList.contains('highlighted-hover')).toBeTrue();
        expect(host.querySelector('[data-force-id="other-placement"]')?.classList.contains('highlighted-hover')).toBeFalse();
    });

    it('saves duplicate placements with distinct placement ids', async () => {
        const mainForce = createPlacedForce('force-1', 0, 0, null, 'main-placement');
        const shadowForce = createPlacedForce('force-1', 40, 0, null, 'shadow-placement');

        (component as any).placedForces.set([mainForce, shadowForce]);
        dataServiceStub.saveOrganization.calls.reset();

        await (component as any).saveOrganization();

        expect(dataServiceStub.saveOrganization).toHaveBeenCalledWith(jasmine.objectContaining({
            forces: [
                jasmine.objectContaining({ placementId: 'main-placement', instanceId: 'force-1' }),
                jasmine.objectContaining({ placementId: 'shadow-placement', instanceId: 'force-1' }),
            ],
        }));
    });

    it('chooses the group with the largest overlap for group drops', () => {
        const draggedGroup = createGroup('dragged', 220, 120, 220, 160);
        const weakerTarget = createGroup('group-1', 0, 0, 280, 320);
        const strongerTarget = createGroup('group-2', 180, 80, 320, 260);

        (component as any).groups.set([draggedGroup, weakerTarget, strongerTarget]);

        expect((component as any).detectGroupDrop(draggedGroup)).toEqual({ type: 'join-parent', groupId: strongerTarget.id });
    });


    it('resolves sibling collisions when creating a parent group for overlapping groups', () => {
        const draggedGroup = createGroup('dragged', 220, 120, 220, 160);
        const targetGroup = createGroup('target', 420, 80, 320, 260);

        (component as any).groups.set([draggedGroup, targetGroup]);
        (component as any).tryMergeGroups(draggedGroup);

        expect(draggedGroup.parentGroupId).toBe(targetGroup.parentGroupId);
        expect(draggedGroup.parentGroupId).not.toBeNull();

        const draggedRight = draggedGroup.x() + draggedGroup.width();
        const targetRight = targetGroup.x() + targetGroup.width();
        const draggedBottom = draggedGroup.y() + draggedGroup.height();
        const targetBottom = targetGroup.y() + targetGroup.height();
        const overlapWidth = Math.min(draggedRight, targetRight) - Math.max(draggedGroup.x(), targetGroup.x());
        const overlapHeight = Math.min(draggedBottom, targetBottom) - Math.max(draggedGroup.y(), targetGroup.y());

        expect(overlapWidth <= 0 || overlapHeight <= 0).toBeTrue();
    });

    it('resolves create-parent collisions against multiple surrounding sibling groups', () => {
        const upperGroup = createGroup('upper', 440, 20, 400, 260);
        const draggedGroup = createGroup('dragged', 200, 250, 220, 260);
        const targetGroup = createGroup('target', 360, 430, 420, 160);
        const lowerGroup = createGroup('lower', 40, 620, 900, 120);

        (component as any).groups.set([upperGroup, draggedGroup, targetGroup, lowerGroup]);
        (component as any).tryMergeGroups(draggedGroup);

        const createdParent = (component as any).groups().find((groupRef: { id: string }) => !['upper', 'dragged', 'target', 'lower'].includes(groupRef.id));
        expect(createdParent).toBeDefined();

        const createdRect = {
            x: createdParent.x(),
            y: createdParent.y(),
            width: createdParent.width(),
            height: createdParent.height(),
        };
        const upperRect = { x: upperGroup.x(), y: upperGroup.y(), width: upperGroup.width(), height: upperGroup.height() };
        const lowerRect = { x: lowerGroup.x(), y: lowerGroup.y(), width: lowerGroup.width(), height: lowerGroup.height() };

        expect((component as any).rectsOverlap(createdRect, upperRect)).toBeFalse();
        expect((component as any).rectsOverlap(createdRect, lowerRect)).toBeFalse();
    });

    it('normalizes loaded group bounds and collisions', async () => {
        const forceA = createLoadForce('force-a', [createBattleMek('Atlas')]);
        const forceB = createLoadForce('force-b', [createBattleMek('Locust')]);

        dataServiceStub.listForces.and.resolveTo([forceA, forceB]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-1',
            name: 'Loaded Org',
            timestamp: Date.now(),
            factionId: undefined,
            forces: [
                { instanceId: 'force-a', x: 0, y: 0, zIndex: 0, groupId: 'group-a' },
                { instanceId: 'force-b', x: 0, y: 0, zIndex: 1, groupId: 'group-b' },
            ],
            groups: [
                { id: 'group-a', name: 'A', x: 0, y: 0, width: 20, height: 20, zIndex: 0, parentGroupId: null },
                { id: 'group-b', name: 'B', x: 0, y: 0, width: 20, height: 20, zIndex: 1, parentGroupId: null },
            ],
        });

        await (component as any).loadOrganization('org-1');

        const [groupA, groupB] = (component as any).groups();
        const rectA = { x: groupA.x(), y: groupA.y(), width: groupA.width(), height: groupA.height() };
        const rectB = { x: groupB.x(), y: groupB.y(), width: groupB.width(), height: groupB.height() };

        expect(groupA.width()).toBeGreaterThan(20);
        expect(groupA.height()).toBeGreaterThan(20);
        expect(groupB.width()).toBeGreaterThan(20);
        expect(groupB.height()).toBeGreaterThan(20);
        expect((component as any).rectsOverlap(rectA, rectB)).toBeFalse();
    });

    it('does not mark the TO&E dirty when clicking a force without starting a drag', () => {
        const lowerForce = createPlacedForce('force-1', 0, 0, null);
        const upperForce = createPlacedForce('force-2', 40, 0, null);
        lowerForce.zIndex.set(0);
        upperForce.zIndex.set(1);

        (component as any).placedForces.set([lowerForce, upperForce]);
        (component as any).resetDirtyTracking();

        (component as any).onForcePointerDown({
            pointerId: 1,
            clientX: 100,
            clientY: 120,
            preventDefault: jasmine.createSpy('preventDefault'),
            stopPropagation: jasmine.createSpy('stopPropagation'),
        } as unknown as PointerEvent, lowerForce);
        (component as any).onGlobalPointerUp({
            pointerId: 1,
            clientX: 100,
            clientY: 120,
        } as PointerEvent);

        expect((component as any).dirty()).toBeFalse();
        expect(lowerForce.zIndex()).toBe(0);
        expect(upperForce.zIndex()).toBe(1);
    });

    it('does not mark the TO&E dirty when clicking a group without starting a drag', () => {
        const lowerGroup = createGroup('group-1', 0, 0, 260, 220);
        const upperGroup = createGroup('group-2', 80, 40, 260, 220);
        lowerGroup.zIndex.set(0);
        upperGroup.zIndex.set(1);

        (component as any).groups.set([lowerGroup, upperGroup]);
        (component as any).resetDirtyTracking();

        (component as any).onGroupPointerDown({
            pointerId: 2,
            clientX: 140,
            clientY: 160,
            preventDefault: jasmine.createSpy('preventDefault'),
            stopPropagation: jasmine.createSpy('stopPropagation'),
        } as unknown as PointerEvent, lowerGroup);
        (component as any).onGlobalPointerUp({
            pointerId: 2,
            clientX: 140,
            clientY: 160,
        } as PointerEvent);

        expect((component as any).dirty()).toBeFalse();
        expect(lowerGroup.zIndex()).toBe(0);
        expect(upperGroup.zIndex()).toBe(1);
    });

    it('does not mark the TO&E dirty when a group rename keeps the saved name', async () => {
        const group = createGroup('group-1', 0, 0, 260, 220);
        group.name.set('Alpha');

        (component as any).groups.set([group]);
        (component as any).resetDirtyTracking();
        dialogsServiceStub.prompt.and.resolveTo('Alpha');

        await (component as any).renameGroup(group);

        expect((component as any).dirty()).toBeFalse();
    });

    it('tracks dirty state from the current saved snapshot and clears when restored', () => {
        const force = createPlacedForce('force-1', 0, 0, null);

        (component as any).placedForces.set([force]);
        (component as any).resetDirtyTracking();

        force.x.set(20);
        expect((component as any).dirty()).toBeTrue();

        force.x.set(0);
        expect((component as any).dirty()).toBeFalse();
    });

    it('does not mark the TO&E dirty for drag jitter that stays in the same snapped position', () => {
        const lowerForce = createPlacedForce('force-1', 0, 0, null);
        const upperForce = createPlacedForce('force-2', 40, 0, null);
        lowerForce.zIndex.set(0);
        upperForce.zIndex.set(1);

        (component as any).placedForces.set([lowerForce, upperForce]);
        (component as any).resetDirtyTracking();
        spyOn(component as any, 'updateDropPreview');

        (component as any).onForcePointerDown({
            pointerId: 3,
            clientX: 100,
            clientY: 120,
            preventDefault: jasmine.createSpy('preventDefault'),
            stopPropagation: jasmine.createSpy('stopPropagation'),
        } as unknown as PointerEvent, lowerForce);
        (component as any).processPointerMove({
            pointerId: 3,
            clientX: 104,
            clientY: 122,
        } as PointerEvent);
        (component as any).onGlobalPointerUp({
            pointerId: 3,
            clientX: 104,
            clientY: 122,
        } as PointerEvent);

        expect((component as any).dirty()).toBeFalse();
        expect(lowerForce.x()).toBe(0);
        expect(lowerForce.y()).toBe(0);
        expect(lowerForce.zIndex()).toBe(0);
        expect(upperForce.zIndex()).toBe(1);
    });

    it('shows a centered loading message while the organization shell is pending', async () => {
        const orgDeferred = createDeferred<any>();

        dataServiceStub.getOrganization.and.returnValue(orgDeferred.promise);
        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([]);

        const loadPromise = (component as any).loadOrganization('org-slow');
        fixture.detectChanges();

        expect((component as any).loading()).toBeTrue();
        expect(fixture.nativeElement.textContent).toContain('Loading TO&E...');

        orgDeferred.resolve({
            organizationId: 'org-slow',
            name: 'Slow Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [],
            groups: [],
        });

        await loadPromise;
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).not.toContain('Loading TO&E...');
    });

    it('restores the saved organization shell before force hydration completes', async () => {
        const forceDeferred = createDeferred<LoadForceEntry[]>();
        const hydratedForce = createLoadForce('force-a', [createBattleMek('Atlas')]);

        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-shared',
            name: 'Shared Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [
                { instanceId: 'force-a', x: 40, y: 60, zIndex: 0, groupId: 'group-a' },
            ],
            groups: [
                { id: 'group-a', name: 'Alpha', x: 20, y: 20, width: 240, height: 180, zIndex: 0, parentGroupId: null },
            ],
        });
        dataServiceStub.getLoadForceEntriesByIds.and.returnValue(forceDeferred.promise);

        const loadPromise = (component as any).loadOrganization('org-shared');
        await flushPromises();
        fixture.detectChanges();

        expect((component as any).loading()).toBeTrue();
        expect((component as any).organizationName()).toBe('Shared Org');
        expect((component as any).groups().map((group: any) => group.id)).toEqual(['group-a']);
        expect((component as any).placedForces().length).toBe(1);
        expect((component as any).placedForces()[0].force.missing).toBeTrue();
        expect(fixture.nativeElement.textContent).toContain('Loading TO&E...');

        forceDeferred.resolve([hydratedForce]);

        await loadPromise;
        fixture.detectChanges();

        expect((component as any).loading()).toBeFalse();
        expect((component as any).placedForces()[0].force).toEqual(jasmine.objectContaining({
            instanceId: hydratedForce.instanceId,
            missing: false,
            name: hydratedForce.name,
        }));
        expect(fixture.nativeElement.textContent).not.toContain('Loading TO&E...');
    });

    it('auto-fits using the SVG layout size instead of the animated bounding box', () => {
        const oversizedGroup = createGroup('group-1', 0, 0, 1400, 1000);
        const svgStub = {
            clientWidth: 1000,
            clientHeight: 800,
            getBoundingClientRect: () => ({ width: 700, height: 500 }),
        };

        (component as any).groups.set([oversizedGroup]);
        (component as any).placedForces.set([]);
        (component as any).svgCanvas = () => ({ nativeElement: svgStub });

        const fitted = (component as any).autoFitView();

        expect(fitted).toBeTrue();
        expect((component as any).zoom()).toBeCloseTo(0.657, 3);
    });

    it('keeps the dialog open when dismiss is cancelled with uncommitted changes', async () => {
        setDirtyState(true);
        dialogsServiceStub.choose.and.resolveTo('cancel');
        dialogRefStub.close.calls.reset();

        await (component as any).close();

        expect(dialogsServiceStub.choose).toHaveBeenCalledWith(
            'Unsaved TO&E Changes',
            jasmine.stringContaining('uncommitted changes'),
            [
                jasmine.objectContaining({ label: 'DISCARD', class: 'danger', value: 'discard' }),
                jasmine.objectContaining({ label: 'CANCEL', value: 'cancel' }),
            ],
            'cancel',
            jasmine.objectContaining({ panelClass: 'danger' }),
        );
        expect(dialogRefStub.close).not.toHaveBeenCalled();
    });

    it('closes the dialog after confirming discard of uncommitted changes', async () => {
        setDirtyState(true);
        dialogsServiceStub.choose.and.resolveTo('discard');
        dialogRefStub.close.calls.reset();

        await (component as any).close();

        expect(dialogRefStub.close).toHaveBeenCalled();
    });

    it('only enables guarded dialog closing while the TO&E has uncommitted changes', async () => {
        expect(dialogRefStub.disableClose).toBeFalse();

        setDirtyState(true);
        fixture.detectChanges();
        await flushPromises();

        expect(dialogRefStub.disableClose).toBeTrue();

        setDirtyState(false);
        fixture.detectChanges();
        await flushPromises();

        expect(dialogRefStub.disableClose).toBeFalse();
    });

    it('routes backdrop dismiss attempts through the unsaved changes guard', async () => {
        setDirtyState(true);
        dialogsServiceStub.choose.and.resolveTo('cancel');
        dialogRefStub.close.calls.reset();

        dialogRefStub.backdropClick.next({} as MouseEvent);
        await flushPromises();

        expect(dialogsServiceStub.choose).toHaveBeenCalled();
        expect(dialogRefStub.close).not.toHaveBeenCalled();
    });

    it('does not intercept backdrop dismiss when there are no uncommitted changes', async () => {
        dialogsServiceStub.choose.calls.reset();

        dialogRefStub.backdropClick.next({} as MouseEvent);
        await flushPromises();

        expect(dialogRefStub.disableClose).toBeFalse();
        expect(dialogsServiceStub.choose).not.toHaveBeenCalled();
    });

    it('warns before unloading when the TO&E has uncommitted changes', () => {
        const event = {
            preventDefault: jasmine.createSpy('preventDefault'),
            returnValue: undefined,
        } as unknown as BeforeUnloadEvent;

        setDirtyState(true);

        const result = (component as any).onBeforeUnload(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.returnValue).toBe('');
        expect(result).toContain('uncommitted changes');
    });

    it('syncs the toe URL param while the dialog is visible and clears it on destroy', () => {
        (component as any).organizationId.set('org-42');
        fixture.detectChanges();

        expect(urlStateServiceStub.setParams).toHaveBeenCalledWith({ toe: 'org-42' });

        urlStateServiceStub.setParams.calls.reset();
        fixture.destroy();

        expect(urlStateServiceStub.setParams).toHaveBeenCalledWith({ toe: null });
    });

    it('treats non-owned organizations as read-only and blocks saving', async () => {
        const forceA = createLoadForce('force-a', [createBattleMek('Atlas')]);

        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([forceA]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-shared',
            name: 'Shared Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [
                { instanceId: 'force-a', x: 0, y: 0, zIndex: 0, groupId: null },
            ],
            groups: [],
        });

        await (component as any).loadOrganization('org-shared');
    setDirtyState(true);
        fixture.detectChanges();
        dataServiceStub.saveOrganization.calls.reset();

        await (component as any).saveOrganization();

        expect((component as any).readOnly()).toBeTrue();
        expect(dataServiceStub.saveOrganization).not.toHaveBeenCalled();
        expect(urlStateServiceStub.setParams).toHaveBeenCalledWith({ toe: 'org-shared' });
    });

    it('opens force details when clicking a force card in read-only mode', async () => {
        const forceA = createLoadForce('force-a', [createBattleMek('Atlas')]);

        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([forceA]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-shared',
            name: 'Shared Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [
                { instanceId: 'force-a', x: 0, y: 0, zIndex: 0, groupId: null },
            ],
            groups: [],
        });

        await (component as any).loadOrganization('org-shared');
        dialogsServiceStub.createDialog.calls.reset();

        const placedForce = (component as any).placedForces()[0];
        const setPointerCapture = jasmine.createSpy('setPointerCapture');
        (component as any).onForcePointerDown({
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 100,
            clientY: 100,
        } as PointerEvent, placedForce);
        (component as any).onCanvasPointerDown({
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 100,
            clientY: 100,
            currentTarget: { setPointerCapture },
        } as unknown as PointerEvent);
        (component as any).onGlobalPointerUp({
            pointerId: 7,
            clientX: 100,
            clientY: 100,
        } as PointerEvent);

        expect(setPointerCapture).not.toHaveBeenCalled();
        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();

        const clickEvent = {
            preventDefault: jasmine.createSpy('preventDefault'),
            stopPropagation: jasmine.createSpy('stopPropagation'),
        } as unknown as MouseEvent;
        (component as any).onReadonlyForceClick(clickEvent, placedForce);

        expect(dialogsServiceStub.createDialog).toHaveBeenCalled();
        expect(dialogsServiceStub.createDialog.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
            data: jasmine.objectContaining({ force: forceA }),
        }));
        expect(clickEvent.preventDefault).toHaveBeenCalled();
        expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    it('does not open force details when the readonly card gesture turns into a drag', async () => {
        const forceA = createLoadForce('force-a', [createBattleMek('Atlas')]);

        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([forceA]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-shared',
            name: 'Shared Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [
                { instanceId: 'force-a', x: 0, y: 0, zIndex: 0, groupId: null },
            ],
            groups: [],
        });

        await (component as any).loadOrganization('org-shared');
        dialogsServiceStub.createDialog.calls.reset();

        const placedForce = (component as any).placedForces()[0];
        const setPointerCapture = jasmine.createSpy('setPointerCapture');
        (component as any).onForcePointerDown({
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 100,
            clientY: 100,
        } as PointerEvent, placedForce);
        (component as any).onCanvasPointerDown({
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 100,
            clientY: 100,
            currentTarget: { setPointerCapture },
        } as unknown as PointerEvent);
        const moveEvent = {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 132,
            clientY: 128,
        } as PointerEvent;
        (component as any).activeTouches.set(9, moveEvent);
        (component as any).processPointerMove(moveEvent);
        (component as any).onGlobalPointerUp({
            pointerId: 9,
            clientX: 132,
            clientY: 128,
        } as PointerEvent);

        const clickEvent = {
            preventDefault: jasmine.createSpy('preventDefault'),
            stopPropagation: jasmine.createSpy('stopPropagation'),
        } as unknown as MouseEvent;
        (component as any).onReadonlyForceClick(clickEvent, placedForce);

        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();
        expect((component as any).draggedForce()).toBeNull();
        expect((component as any).viewOffset()).toEqual({ x: 32, y: 28 });
        expect(clickEvent.preventDefault).not.toHaveBeenCalled();
        expect(clickEvent.stopPropagation).not.toHaveBeenCalled();
        expect(setPointerCapture).not.toHaveBeenCalled();
    });

    it('loads foreign organization forces by instance id instead of listing the viewer\'s own forces', async () => {
        const foreignForce = createLoadForce('force-foreign', [createBattleMek('Atlas')]);

        dataServiceStub.listForces.calls.reset();
        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([foreignForce]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-foreign',
            name: 'Foreign Org',
            timestamp: Date.now(),
            owned: false,
            factionId: undefined,
            forces: [
                { instanceId: 'force-foreign', x: 0, y: 0, zIndex: 0, groupId: null },
            ],
            groups: [],
        });

        await (component as any).loadOrganization('org-foreign');

        expect(dataServiceStub.listForces).not.toHaveBeenCalled();
        expect(dataServiceStub.getLoadForceEntriesByIds).toHaveBeenCalledWith(['force-foreign']);
        expect((component as any).placedForces().map((pf: any) => pf.force.instanceId)).toEqual(['force-foreign']);
    });

    it('keeps missing force references as placeholders so saving the TO&E preserves them', async () => {
        dataServiceStub.listForces.and.resolveTo([]);
        dataServiceStub.getLoadForceEntriesByIds.and.resolveTo([]);
        dataServiceStub.getOrganization.and.resolveTo({
            organizationId: 'org-missing',
            name: 'Missing Org',
            timestamp: Date.now(),
            owned: true,
            factionId: undefined,
            forces: [
                { instanceId: 'force-missing', x: 40, y: 60, zIndex: 0, groupId: null },
            ],
            groups: [],
        });

        await (component as any).loadOrganization('org-missing');
        dataServiceStub.saveOrganization.calls.reset();

        await (component as any).saveOrganization();

        expect((component as any).placedForces().length).toBe(1);
        expect((component as any).placedForces()[0].force.missing).toBeTrue();
        expect(dataServiceStub.saveOrganization).toHaveBeenCalledWith(jasmine.objectContaining({
            organizationId: 'org-missing',
            forces: [jasmine.objectContaining({ instanceId: 'force-missing' })],
        }));
    });

    it('brings a dragged group to the highest group z-index', () => {
        const lowerGroup = createGroup('group-1', 0, 0, 280, 320);
        const draggedGroup = createGroup('dragged', 180, 80, 320, 260);
        lowerGroup.zIndex.set(1);
        draggedGroup.zIndex.set(0);

        (component as any).groups.set([lowerGroup, draggedGroup]);

        (component as any).onGroupPointerDown({
            preventDefault() {},
            stopPropagation() {},
            clientX: 0,
            clientY: 0,
        } as PointerEvent, draggedGroup);

        (component as any).processPointerMove({
            clientX: 20,
            clientY: 0,
        } as PointerEvent);

        expect(draggedGroup.zIndex()).toBe(1);
        expect(lowerGroup.zIndex()).toBe(0);
    });

    it('renders the dragged group subtree in the drag overlay layer', () => {
        const parentGroup = createGroup('parent', 0, 0, 500, 400);
        const childGroup = createGroup('child', 80, 80, 240, 160);
        childGroup.parentGroupId = parentGroup.id;

        (component as any).groups.set([parentGroup, childGroup]);
        (component as any).draggedGroup.set(parentGroup);

        expect((component as any).baseLayerGroups()).toEqual([]);
        expect((component as any).dragOverlayGroups()).toEqual([parentGroup, childGroup]);
    });

    it('filters sidebar forces by computed org name', () => {
        const force = createLoadForce('force-lance', [
            createBattleMek('Atlas'),
            createBattleMek('Locust'),
            createBattleMek('Phoenix Hawk'),
            createBattleMek('Shadow Hawk'),
        ]);

        force._searchText = (component as any).computeSearchText(force);
        (component as any).allForces.set([force]);
        (component as any).sidebarSearchText.set('lance');

        expect((component as any).sidebarForces()).toEqual([force]);
    });

    it('keeps the current group highlighted while a dragged force still overlaps it', () => {
        const group = createGroup('group-1', 0, 0, 400, 300);
        const placedForce = createPlacedForce('force-1', 100, 100, group.id);

        (component as any).groups.set([group]);
        (component as any).placedForces.set([placedForce]);
        (component as any).draggedForce.set(placedForce);
        (component as any).dragStartPos = { x: 0, y: 0 };
        (component as any).forceStartPos = { x: 100, y: 100 };

        (component as any).processPointerMove({ clientX: 150, clientY: 0 } as PointerEvent);

        expect((component as any).dropTargetGroupId()).toBe(group.id);
    });

    it('keeps the current parent highlighted while a dragged group still overlaps it', () => {
        const parentGroup = createGroup('parent', 0, 0, 500, 400);
        const childGroup = createGroup('child', 80, 80, 240, 160);
        childGroup.parentGroupId = parentGroup.id;

        (component as any).groups.set([parentGroup, childGroup]);
        (component as any).draggedGroup.set(childGroup);
        (component as any).groupDragStartPos = { x: 0, y: 0 };
        (component as any).groupStartPos = { x: 80, y: 80 };

        (component as any).processPointerMove({ clientX: 150, clientY: 0 } as PointerEvent);

        expect((component as any).dropTargetGroupId()).toBe(parentGroup.id);
    });
});