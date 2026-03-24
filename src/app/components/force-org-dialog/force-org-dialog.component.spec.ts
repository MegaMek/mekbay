import { DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { ForceOrgDialogComponent } from './force-org-dialog.component';

describe('ForceOrgDialogComponent', () => {
    let component: ForceOrgDialogComponent;

    const dataServiceStub = {
        listForces: jasmine.createSpy('listForces').and.resolveTo([]),
        getFactionById: jasmine.createSpy('getFactionById').and.returnValue(undefined),
        saveOrganization: jasmine.createSpy('saveOrganization').and.resolveTo(undefined),
        getOrganization: jasmine.createSpy('getOrganization').and.resolveTo(null),
    };

    const dialogsServiceStub = {
        createDialog: jasmine.createSpy('createDialog'),
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

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ForceOrgDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                { provide: DataService, useValue: dataServiceStub },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: ForceBuilderService, useValue: forceBuilderServiceStub },
                { provide: LayoutService, useValue: layoutServiceStub },
            ],
        }).compileComponents();

        component = TestBed.createComponent(ForceOrgDialogComponent).componentInstance;
    });

    function createPlacedForce(instanceId: string, x: number, y: number, groupId: string | null) {
        return {
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
            jump2: 0,
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