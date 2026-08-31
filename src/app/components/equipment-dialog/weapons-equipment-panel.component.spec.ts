// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import { asComponentId, asLocationId } from '../../models/entity/entity-identifiers';
import type { EquipmentPanelComponent, MekPhysicalAttackRow } from '../../models/runtime/equipment-panel';
import type { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';
import { WeaponsEquipmentPanelComponent } from './weapons-equipment-panel.component';

const ZERO_HIT = Object.freeze({
    profile: Object.freeze([0]),
    value: 0,
    changed: false,
    weakened: false,
    modifierBreakdown: Object.freeze([]),
});
const ZERO_HITS_BY_RANGE = Object.freeze({
    short: ZERO_HIT,
    medium: ZERO_HIT,
    long: ZERO_HIT,
    extreme: ZERO_HIT,
});

function createRuntime() {
    const weaponId = asComponentId('component:laser');
    const ammoId = asComponentId('component:ammo');
    const weaponRow = {
        componentId: weaponId,
        label: 'Large Laser',
        profile: { stats: { toHitModifier: 0 } },
        locations: [{ locationId: 'location:ra', code: 'RA', status: 'available', exposed: false }],
        status: 'available',
        previewStatus: 'available',
        modes: ['Standard', 'Rapid'],
        defaultMode: 'Standard',
        mode: 'Standard',
        jammed: false,
        weapon: {
            heat: 8,
            firingHeat: 8,
            selectable: true,
            damage: 8,
            damageText: '8',
            damageTextByRange: { short: '8', medium: '8', long: '8', extreme: '8' },
            hit: { default: ZERO_HIT, byRange: ZERO_HITS_BY_RANGE, indirectByRange: ZERO_HITS_BY_RANGE },
            toHitModifier: 0,
            hitModifierBreakdown: [],
            ranges: [5, 10, 15, 20],
            minimumRange: 0,
            ammoSources: [{
                componentId: ammoId,
                label: 'Laser Magazine',
                location: 'RT',
                status: 'available',
                munitionKey: 'ammo:laser',
                remaining: 4,
                capacity: 5,
                loadouts: [],
            }],
        },
    } as unknown as EquipmentPanelComponent;
    const ammoRow = {
        componentId: ammoId,
        label: 'Laser Magazine',
        locations: [{ locationId: 'location:rt', code: 'RT', status: 'available', exposed: false }],
        status: 'available',
        previewStatus: 'available',
        modes: [],
        jammed: false,
        ammo: {
            defaultMunitionKey: 'ammo:laser',
            munitionKey: 'ammo:laser',
            displayName: 'Laser Ammo',
            remaining: 4,
            capacity: 5,
            loadouts: [{ munitionKey: 'ammo:laser', displayName: 'Laser Ammo', capacity: 5, profile: {} }],
        },
    } as unknown as EquipmentPanelComponent;
    const physicalRow = {
        target: { kind: 'intrinsic', actionId: 'intrinsic:punch:LA' },
        label: 'Punch',
        locationIds: [asLocationId('location:la')],
        locationCodes: ['LA'],
        hitModifiers: [0],
        hitModifierBreakdown: [],
        available: true,
        selectable: true,
        firingHeat: 0,
        effect: {
            kind: 'damage', damage: 5, maximumDamage: 5, baseDamage: 5,
            weakened: false, boosted: false,
        },
    } as const satisfies MekPhysicalAttackRow;
    const chargeRow = {
        ...physicalRow,
        target: { kind: 'intrinsic', actionId: 'intrinsic:charge' },
        label: 'Charge',
        locationIds: [],
        locationCodes: [],
        hitModifiers: ['versus'],
    } as const satisfies MekPhysicalAttackRow;
    const selectTarget = jasmine.createSpy('selectTarget').and.resolveTo();
    const selectPhysicalTarget = jasmine.createSpy('selectPhysicalTarget').and.resolveTo();
    const configureAmmo = jasmine.createSpy('configureAmmo').and.resolveTo();
    const changeStatus = jasmine.createSpy('changeStatus').and.resolveTo();
    const chooseInteraction = jasmine.createSpy('chooseInteraction').and.resolveTo();
    const fire = jasmine.createSpy('fire').and.resolveTo();
    const reorderEquipmentRows = jasmine.createSpy('reorderEquipmentRows').and.resolveTo();
    const interaction = {
        componentId: weaponId,
        choices: [{
            token: 'choice:laser-mode',
            handlerId: 'inventory-mode',
            label: 'Pulse',
            value: 'Pulse',
            active: false,
            disabled: false,
            displayType: 'button',
        }],
    } as const;
    const snapshot = {
        displayName: 'Crab CRB-20',
        unitType: 'Mek',
        tracksHeat: true,
        ruleset: 'core-2026',
        stateRevision: 1,
        targetRegistryRevision: 1,
        crew: { gunnery: 3, piloting: 4 },
        components: [weaponRow, ammoRow],
        physicalAttacks: [physicalRow, chargeRow],
        targets: [],
        heat: { current: 0, pending: null, sinksOff: 0 },
    } as const;
    const runtime = {
        snapshot: () => snapshot,
        weapons: () => [weaponRow],
        equipment: () => [],
        ammo: () => [ammoRow],
        interactions: () => [interaction],
        member: {
            id: 'unit:1',
            force: {
                readOnly: () => false,
                getMekTurnPanelSnapshot: () => ({ movementState: { movement: null } }),
            },
        },
        locations: () => 'RA',
        weaponDamage: () => '8',
        physicalDamage: () => '5',
        selectedTarget: () => '',
        selectedAmmo: () => `${ammoId}\u0000ammo:laser`,
        interaction: jasmine.createSpy('interaction').and.callFake(
            (row: EquipmentPanelComponent) => row.componentId === weaponId ? interaction : undefined,
        ),
        selectedHeatProjection: () => null,
        allowsExtremeRangeAttacks: () => true,
        attackerMovementMode: () => null,
        attackModifierBreakdown: () => [],
        missingAttackMovementModifier: () => false,
        c3Available: () => false,
        c3DegradationSource: () => 'none',
        supportsMekTurnTools: () => true,
        selectTarget,
        selectPhysicalTarget,
        selectWeaponAmmo: jasmine.createSpy('selectWeaponAmmo').and.resolveTo(),
        configureAmmo,
        changeStatus,
        chooseInteraction,
        resetSelections: jasmine.createSpy('resetSelections').and.resolveTo(),
        hasSelections: () => false,
        fire,
        reorderEquipmentRows,
    } as unknown as EquipmentDialogRuntimeController;
    return {
        runtime, weaponRow, ammoRow, physicalRow, selectTarget, selectPhysicalTarget,
        configureAmmo, changeStatus, chooseInteraction, fire, reorderEquipmentRows,
    };
}

function createMachineGunArrayRuntime(
    mode: 'Linked' | 'Off' = 'Linked',
    ruleset: 'core-2026' | 'total-warfare' = 'core-2026',
    unavailableMember = -1,
) {
    const base = createRuntime();
    const controllerId = asComponentId('component:mga');
    const memberIds = [0, 1, 2].map(index => asComponentId(`component:mg-${index + 1}`));
    const relation = Object.freeze({
        kind: 'machine-gun-array' as const,
        controllerId,
        memberIds: Object.freeze(memberIds),
    });
    const members = Object.freeze(memberIds.map((componentId, index) => Object.freeze({
        componentId,
        status: index === unavailableMember ? 'destroyed' as const : 'available' as const,
        operational: index !== unavailableMember,
    })));
    const operationalMemberIds = Object.freeze(members
        .filter(member => member.operational)
        .map(member => member.componentId));
    const controllerFacts = Object.freeze({
        relation,
        role: 'controller' as const,
        subjectId: controllerId,
        controllerStatus: 'available' as const,
        controllerMode: mode,
        members,
        operationalMemberIds,
        canFire: mode === 'Linked' && operationalMemberIds.length > 0,
    });
    const controller = {
        ...base.weaponRow,
        componentId: controllerId,
        label: 'Machine Gun Array',
        modes: ['Linked', 'Off'],
        defaultMode: 'Linked',
        mode,
        bay: controllerFacts,
        weapon: { ...base.weaponRow.weapon!, selectable: controllerFacts.canFire },
    } satisfies EquipmentPanelComponent;
    const memberRows = memberIds.map((componentId, index) => {
        const operational = index !== unavailableMember;
        return {
            ...base.weaponRow,
            componentId,
            label: `Machine Gun ${index + 1}`,
            status: operational ? 'available' as const : 'destroyed' as const,
            previewStatus: operational ? 'available' as const : 'destroyed' as const,
            modes: [],
            defaultMode: undefined,
            mode: undefined,
            bay: Object.freeze({
                relation,
                role: 'member' as const,
                subjectId: componentId,
                controllerStatus: 'available' as const,
                controllerMode: mode,
                members,
                operationalMemberIds,
                canFire: operational && mode === 'Off',
            }),
            weapon: { ...base.weaponRow.weapon!, selectable: operational && mode === 'Off' },
        } satisfies EquipmentPanelComponent;
    });
    const rows = [memberRows[1]!, controller, memberRows[0]!, memberRows[2]!];
    const snapshot = Object.freeze({
        ...base.runtime.snapshot(),
        ruleset,
        components: rows,
    });
    const runtime = {
        ...base.runtime,
        snapshot: () => snapshot,
        weapons: () => rows,
        equipment: () => [],
        interactions: () => [],
        interaction: () => undefined,
        locations: () => 'LT',
    } as unknown as EquipmentDialogRuntimeController;
    return { runtime, controller, memberRows };
}

function createComponent(runtime: EquipmentDialogRuntimeController) {
    TestBed.configureTestingModule({ imports: [WeaponsEquipmentPanelComponent] });
    const fixture = TestBed.createComponent(WeaponsEquipmentPanelComponent);
    fixture.componentRef.setInput('runtime', runtime);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
}

describe('WeaponsEquipmentPanelComponent', () => {
    it('groups a linked MGA under its controller and exposes one logical fire/ammo control', () => {
        const harness = createMachineGunArrayRuntime();
        const { fixture, component } = createComponent(harness.runtime);
        const ranged = component.groups()[0]!;
        const rangedElement = fixture.nativeElement.querySelectorAll('.weapon-equipment-section')[0] as HTMLElement;
        const rows = Array.from(
            rangedElement.querySelectorAll('.weapon-equipment-row'),
        ) as HTMLElement[];

        expect(ranged.rows.map(row => row.id)).toEqual([
            'component:mga',
            'component:mg-1',
            'component:mg-2',
            'component:mg-3',
        ]);
        expect(rows[0]!.classList).toContain('mga-array-row');
        expect(rows.slice(1).every(row => row.classList.contains('mga-member-controlled'))).toBeTrue();
        expect(rows.slice(1).every(row => row.querySelector('.mga-branch') !== null)).toBeTrue();
        expect(rows.flatMap(row => Array.from(row.querySelectorAll('.select-cell input, .select-cell button'))))
            .toHaveSize(1);
        expect(rangedElement.querySelectorAll('.ammo-cell')).toHaveSize(1);
        expect(component.machineGunArraySummary(ranged.rows[0]!))
            .toBe('3 guns · 3 ammo/attack · Cluster +2');
        expect(ranged.rows.slice(1).map(row => component.machineGunArrayMemberSummary(row)))
            .toEqual(['Linked', 'Linked', 'Linked']);
    });

    it('restores individual MGA members while unlinked and uses the TW cluster label', () => {
        const unlinked = createMachineGunArrayRuntime('Off');
        const unlinkedView = createComponent(unlinked.runtime);
        const rows = unlinkedView.component.groups()[0]!.rows;
        const rangedElement = unlinkedView.fixture.nativeElement
            .querySelectorAll('.weapon-equipment-section')[0] as HTMLElement;

        expect(unlinkedView.component.isSelectable(rows[0]!)).toBeFalse();
        expect(rows.slice(1).every(row => unlinkedView.component.isSelectable(row))).toBeTrue();
        expect(rangedElement.querySelectorAll('.select-cell input')).toHaveSize(3);
        expect(rangedElement.querySelectorAll('.ammo-cell')).toHaveSize(3);
        expect(unlinkedView.component.machineGunArraySummary(rows[0]!))
            .toBe('3 guns · Individual fire');
        expect(rows.slice(1).map(row => unlinkedView.component.machineGunArrayMemberSummary(row)))
            .toEqual(['Unlinked', 'Unlinked', 'Unlinked']);

    });

    it('uses an unmodified cluster-roll label for a Total Warfare MGA', () => {
        const tw = createMachineGunArrayRuntime('Linked', 'total-warfare');
        const twView = createComponent(tw.runtime);

        expect(twView.component.machineGunArraySummary(twView.component.groups()[0]!.rows[0]!))
            .toBe('3 guns · 3 ammo/attack · Cluster roll');
    });

    it('excludes an unavailable MGA member from controller counts without restoring its fire control', () => {
        const harness = createMachineGunArrayRuntime('Linked', 'core-2026', 1);
        const { component } = createComponent(harness.runtime);
        const rows = component.groups()[0]!.rows;

        expect(component.machineGunArraySummary(rows[0]!))
            .toBe('2/3 guns · 2 ammo/attack · Cluster +2');
        expect(rows.slice(1).map(row => component.machineGunArrayMemberSummary(row)))
            .toEqual(['Linked', 'Excluded from array', 'Linked']);
        expect(rows.slice(1).every(row => !component.isSelectable(row))).toBeTrue();
    });

    it('renders Entity/runtime rows through the original weapons panel', () => {
        const harness = createRuntime();
        const { fixture } = createComponent(harness.runtime);

        expect((Array.from(fixture.nativeElement.querySelectorAll('.section-title-text')) as Element[])
            .map(node => node.textContent?.trim())).toEqual(['Ranged Weapons', 'Physical Weapons']);
        expect(fixture.nativeElement.querySelector('.weapon-equipment-header .name-header')?.textContent?.trim()).toBe('Name');
        expect(fixture.nativeElement.querySelector('.weapon-equipment-row .name-cell')?.textContent).toContain('Large Laser');
        expect(fixture.nativeElement.querySelector('.weapon-equipment-row .heat-cell')?.textContent?.trim()).toBe('8');
        const physical = fixture.nativeElement.querySelectorAll('.weapon-equipment-section')[1];
        expect(physical.querySelector('.weapon-equipment-row .name-cell')?.textContent).toContain('Punch');
        expect(physical.querySelector('.weapon-equipment-row .hit-value')?.textContent?.trim()).toBe('+0');
        expect(physical.querySelector('.weapon-equipment-row .damage-cell')?.textContent?.trim()).toBe('5');
        const physicalRows = fixture.componentInstance.groups()[1]!.rows;
        expect(physicalRows[0]).toEqual(jasmine.objectContaining({
            id: 'physical:intrinsic:punch:LA',
            display: jasmine.objectContaining({ location: 'LA', heat: '—' }),
        }));
        expect(physicalRows[1]).toEqual(jasmine.objectContaining({
            id: 'physical:intrinsic:charge',
            display: jasmine.objectContaining({ location: '—', heat: '—' }),
        }));
        const rangedRow = fixture.componentInstance.groups()[0]!.rows[0]!;
        expect(fixture.componentInstance.ammoDropdownOptions(rangedRow)[0]).toEqual(jasmine.objectContaining({
            label: 'Laser Magazine (4/5)',
            trailingLabel: '(4/5)',
        }));
    });

    it('renders ordinary equipment without requiring a weapon hit resolution', () => {
        const harness = createRuntime();
        const equipment = {
            ...harness.ammoRow,
            componentId: asComponentId('component:ecm'),
            label: 'Guardian ECM Suite',
            ammo: undefined,
            equipment: { toHitModifier: null },
        } as unknown as EquipmentPanelComponent;
        const runtime = {
            ...harness.runtime,
            equipment: () => [equipment],
            locations: (row: EquipmentPanelComponent) => row === equipment ? 'LT' : 'RA',
        } as unknown as EquipmentDialogRuntimeController;

        const { fixture, component } = createComponent(runtime);
        const equipmentGroup = component.groups().find(group => group.id === 'equipment')!;
        const state = component.targetState(equipmentGroup.rows[0]!);

        expect(state).toEqual(jasmine.objectContaining({
            hitText: '',
            damageText: '—',
            hitModifierTooltip: null,
            hitModifierWeakened: false,
            targetNumberText: '',
        }));
        expect(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')).toHaveSize(3);
    });

    it('dispatches selection, range, ammo and lifecycle controls to the typed runtime owner', () => {
        const harness = createRuntime();
        const { fixture } = createComponent(harness.runtime);

        (fixture.nativeElement.querySelector('.weapon-equipment-row .bt-checkbox') as HTMLInputElement).click();
        (fixture.nativeElement.querySelector('.range-short') as HTMLButtonElement).click();
        (fixture.nativeElement.querySelector('.ammo-stepper-button') as HTMLButtonElement).click();
        (fixture.nativeElement.querySelector('.controls-cell .bt-button') as HTMLButtonElement).click();

        expect(harness.selectTarget).toHaveBeenCalledWith(harness.weaponRow, 'selected');
        expect(harness.selectTarget).toHaveBeenCalledWith(harness.weaponRow, 'range:short');
        expect(harness.configureAmmo).toHaveBeenCalledWith(harness.ammoRow, 'ammo:laser', 3);
        expect(harness.chooseInteraction).toHaveBeenCalled();
    });

    it('dispatches physical selection through the typed action owner', () => {
        const harness = createRuntime();
        const { fixture } = createComponent(harness.runtime);
        const physical = fixture.nativeElement.querySelectorAll('.weapon-equipment-section')[1];

        (physical.querySelector('.weapon-equipment-row .bt-checkbox') as HTMLInputElement).click();

        expect(harness.selectPhysicalTarget).toHaveBeenCalledWith(harness.physicalRow, 'selected');
    });

    it('stores reordered physical rows as canonical-index presentation state', () => {
        const harness = createRuntime();
        const { component } = createComponent(harness.runtime);
        const physical = component.groups()[1]!;

        component.drop({ previousIndex: 0, currentIndex: 1 } as never, physical);

        expect(harness.reorderEquipmentRows).toHaveBeenCalledOnceWith('physical', [1, 0]);
    });

    it('does not expose raw catalog modes without a runtime interaction handler', () => {
        const harness = createRuntime();
        (harness.runtime.interaction as jasmine.Spy).and.returnValue(undefined);
        const { fixture, component } = createComponent(harness.runtime);
        const row = component.groups()[0]!.rows[0]!;

        expect(row.component?.modes).toEqual(['Standard', 'Rapid']);
        expect(component.modeChoice(row)).toBeUndefined();
        expect(fixture.nativeElement.querySelector('.mode-choice')).toBeNull();
    });

    it('hides direct component damage controls for Meks', () => {
        const mek = createRuntime();
        const mekView = createComponent(mek.runtime);
        const mekRow = mekView.component.groups()[0]!.rows[0]!;
        const destroyedMekRow = {
            ...mekRow,
            component: { ...mekRow.component!, previewStatus: 'destroyed' } as EquipmentPanelComponent,
        };

        expect(mekView.component.canMarkDestroyed(mekRow)).toBeFalse();
        expect(mekView.component.canRepair(destroyedMekRow)).toBeFalse();
        expect((Array.from(mekView.fixture.nativeElement.querySelectorAll('.controls-cell button')) as HTMLElement[])
            .some(button => button.textContent?.trim() === 'HIT')).toBeFalse();
    });

    it('keeps direct component damage controls for non-Meks', () => {
        const harness = createRuntime();
        const nonMekRuntime = {
            ...harness.runtime,
            supportsMekTurnTools: () => false,
        } as unknown as EquipmentDialogRuntimeController;
        const nonMekView = createComponent(nonMekRuntime);
        const nonMekRow = nonMekView.component.groups()[0]!.rows[0]!;
        const destroyedNonMekRow = {
            ...nonMekRow,
            component: { ...nonMekRow.component!, previewStatus: 'destroyed' } as EquipmentPanelComponent,
        };

        expect(nonMekView.component.canMarkDestroyed(nonMekRow)).toBeTrue();
        expect(nonMekView.component.canRepair(destroyedNonMekRow)).toBeTrue();
        expect((Array.from(nonMekView.fixture.nativeElement.querySelectorAll('.controls-cell button')) as HTMLElement[])
            .some(button => button.textContent?.trim() === 'HIT')).toBeTrue();
    });

    it('fires only through the retained runtime command', async () => {
        const harness = createRuntime();
        const { component } = createComponent(harness.runtime);

        await component.consumeSelectedHeatAndAmmo();

        expect(harness.fire).toHaveBeenCalledOnceWith();
    });

    it('has no legacy unit or context inputs', () => {
        expect(Object.hasOwn(WeaponsEquipmentPanelComponent.prototype, 'unit')).toBeFalse();
        expect(Object.hasOwn(WeaponsEquipmentPanelComponent.prototype, 'context')).toBeFalse();
    });
});
