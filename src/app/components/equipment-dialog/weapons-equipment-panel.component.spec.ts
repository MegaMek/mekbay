import { CdkDragDrop, CdkDragStart } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { AmmoEquipment, WeaponEquipment, MiscEquipment, type EquipmentMap } from '../../models/equipment.model';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { INVENTORY_CONTROL_TARGET_COLORS, type InventoryControlRuntimeTarget, type InventoryControlRuntimeTargetId } from '../../models/inventory-control-runtime-state.model';
import type { UnitModifierBreakdownEntry } from '../../models/rules/unit-type-rules';
import { CBTInventoryControlRuntime } from '../../models/cbt-inventory-control-runtime.model';
import { MountedEquipment, type CriticalSlot, type HeatProfile } from '../../models/force-serialization';
import { InventoryModeHandler } from '../../equipment-handlers/inventory-mode.handler';
import { BAPHandler } from '../../equipment-handlers/bap.handler';
import { PpcCapacitorHandler } from '../../equipment-handlers/ppc-capacitor.handler';
import { MmlHandler } from '../../equipment-handlers/mml.handler';
import { AtmHandler } from '../../equipment-handlers/atm.handler';
import { ArtemisVHandler } from '../../equipment-handlers/artemis-v.handler';
import { ApolloHandler } from '../../equipment-handlers/apollo.handler';
import { LaserInsulatorHandler } from '../../equipment-handlers/laser-insulator.handler';
import type { EquipmentInteractionHandler, HandlerChoice } from '../../services/equipment-interaction-registry.service';
import { INVENTORY_CONTROL_MODE_STATE, inventoryControlSortKey, getInventoryControlGroups, type InventoryControlDisplayData, type InventoryControlDisplayEffectOptions } from '../../utils/inventory-control.util';
import { PPC_CAPACITOR_STATE_KEY } from '../../utils/ppc-capacitor.util';
import { WeaponsEquipmentPanelComponent } from './weapons-equipment-panel.component';
import type { EquipmentDialogContext } from './equipment-dialog.model';
import { getMotiveModeLabel, type MotiveModes } from '../../models/motiveModes.model';

type EntryState = { isDamaged: boolean; isDisabled: boolean; hitMod: number };

function testEntryRuleState(entry: MountedEquipment): EntryState {
    return {
        isDamaged: entry.committedDestroyed(),
        isDisabled: entry.states.get('state') === 'jammed' || testInfantryFieldGunEntryDisabled(entry),
        hitMod: 0
    };
}

function testInfantryFieldGunEntryDisabled(entry: MountedEquipment): boolean {
    const componentRef = testInventoryComponentRef(entry);
    const unit = entry.owner;
    const baseUnit = unit?.getUnit?.();
    if (!baseUnit || baseUnit.type !== 'Infantry' || baseUnit.subtype === 'Battle Armor') return false;
    if (!(entry.equipment instanceof WeaponEquipment)) return false;
    if (componentRef === null) return false;
    const component = componentRef === null ? undefined : baseUnit.comp?.[componentRef.componentIndex];
    if (!component || component.l !== 'FGUN' || component.t === 'X' || componentRef.binIndex === null) return false;
    const totalTroops = unit.locations?.internal.get('TROOP')?.points
        ?? baseUnit.internal
        ?? ((baseUnit.squads ?? 0) * (baseUnit.squadSize ?? 0));
    const committedDamage = unit.getCommittedInternalHits?.('TROOP') ?? 0;
    const functionalTroops = Math.max(0, totalTroops - committedDamage);
    const functionalGuns = Math.min(Math.max(0, component.q ?? 0), Math.floor(functionalTroops / Math.max(1, component.cw ?? 1)));
    return componentRef.binIndex >= functionalGuns;
}

function testInventoryComponentRef(entry: MountedEquipment): { componentIndex: number; binIndex: number | null } | null {
    const indexText = entry.id.split('#').pop();
    if (!indexText) return null;
    const [componentIndexText, binIndexText] = indexText.split('.');
    const componentIndex = Number(componentIndexText);
    const binIndex = binIndexText === undefined ? null : Number(binIndexText);
    if (!Number.isInteger(componentIndex)) return null;
    if (binIndex !== null && !Number.isInteger(binIndex)) return null;
    return { componentIndex, binIndex };
}

const EMPTY_ENTRY_STATE_RULES = {
    computeAllEntryStates: () => new Map<MountedEquipment, EntryState>(),
    computeEntryState: testEntryRuleState,
    heatDissipation: () => null
};

function addRuntimeSelection(unit: CBTForceUnit): CBTForceUnit {
    const runtime = new CBTInventoryControlRuntime(unit);

    Object.assign(unit, {
        inventoryControl: runtime,
        getInventoryControlSnapshot: () => runtime.getSnapshot(),
        getInventoryControlTargets: () => runtime.getTargets(),
        getInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.getTarget(targetId),
        getInventoryControlEntryTargetId: (entryId: string) => runtime.getEntryTargetId(entryId),
        isInventoryControlEntrySelected: (entryId: string) => runtime.isEntrySelected(entryId),
        getInventoryControlEntryRange: (entryId: string) => runtime.getEntryRange(entryId),
        getInventoryControlEntryAmmoOption: (entryId: string) => runtime.getEntryAmmoOption(entryId),
        setInventoryControlEntrySelected: (entry: MountedEquipment, selected: boolean) => runtime.setEntrySelected(entry, selected),
        setInventoryControlEntryRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long' | null) => runtime.setEntryRange(entry, range),
        toggleInventoryControlEntryRange: (entry: MountedEquipment, range: 'short' | 'medium' | 'long', forceSelected = false) => runtime.toggleEntryRange(entry, range, forceSelected),
        setInventoryControlEntryAmmoOption: (entryId: string, optionId: string) => runtime.setEntryAmmoOption(entryId, optionId),
        setInventoryControlEntryTarget: (entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null) => runtime.setEntryTarget(entry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>) => runtime.updateTarget(targetId, patch),
        deleteInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.deleteTarget(targetId),
        resetInventoryControlTargets: () => runtime.resetTargets(),
        clearInventoryControlSelection: () => runtime.clearSelection(),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    return unit;
}

function weapon(id: string, ammoType: 'NA' | 'AC' | 'ATM' | 'MML' | 'AC_ULTRA' | 'NARC' = 'NA', rackSize = 0, ranges: number[] = [1, 2, 3, 4]): WeaponEquipment {
    return new WeaponEquipment({
        id,
        name: id,
        type: 'weapon',
        weapon: { ammoType, rackSize, ranges }
    });
}

function ammo(id: string, ammoType: 'AC' | 'ATM' | 'MML' | 'NARC', rackSize: number, munitionType: string[] = [], flags: string[] = [], toHitModifier = 0): AmmoEquipment {
    return new AmmoEquipment({
        id,
        name: id,
        shortName: id,
        type: 'ammo',
        flags,
        stats: { toHitModifier },
        ammo: { type: ammoType, rackSize, shots: 10, munitionType }
    });
}

function misc(id: string, flags: string[] = []): MiscEquipment {
    return new MiscEquipment({ id, name: id, type: 'misc', flags });
}

function testEquipmentUnavailable(source: MountedEquipment | CriticalSlot): boolean {
    if (source instanceof MountedEquipment) return source.committedDestroyed() || !!source.critSlots?.some(slot => !!slot.destroyed);
    return !!source.destroyed;
}

function svgEntry(html: string): SVGElement {
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild as SVGElement;
    el.classList.add('inventoryEntry');
    return el;
}

function entry(params: {
    id: string;
    equipment?: WeaponEquipment | MiscEquipment | AmmoEquipment;
    physical?: boolean;
    baseHitMod?: string;
    destroyed?: boolean;
    el?: SVGElement;
    states?: Map<string, string>;
    linkedWith?: MountedEquipment[];
    totalAmmo?: number;
    consumed?: number;
    locations?: Set<string>;
    critSlots?: CriticalSlot[];
}): MountedEquipment {
    const owner = {
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        readOnly: () => false,
        hasDirectInventory: () => true,
        getInventory: () => [],
        getCritSlots: () => [],
        getUnit: () => ({ comp: [] }),
        isEquipmentUnavailable: testEquipmentUnavailable,
        rules: EMPTY_ENTRY_STATE_RULES
    } as unknown as CBTForceUnit;
    return new MountedEquipment({
        owner,
        id: params.id,
        name: params.id,
        equipment: params.equipment,
        physical: params.physical ?? false,
        baseHitMod: params.baseHitMod,
        destroyed: params.destroyed ?? false,
        states: params.states ?? new Map<string, string>(),
        el: params.el,
        linkedWith: params.linkedWith ?? null,
        totalAmmo: params.totalAmmo,
        consumed: params.consumed,
        locations: params.locations,
        critSlots: params.critSlots
    });
}

interface CreateComponentOptions {
    readOnly?: boolean;
    hasDirectInventory?: boolean;
    tracksHeat?: boolean;
    heatDissipation?: number;
    heatNext?: number;
    heatSources?: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
    moveMode?: MotiveModes | null;
    attackModifierBreakdown?: UnitModifierBreakdownEntry[];
    attackMovementCanAffectTargetNumbers?: boolean;
    hasLinkedC3Network?: boolean;
    handlers?: EquipmentInteractionHandler[];
}

function createComponent(
    entries: MountedEquipment[],
    equipmentMap: EquipmentMap = {},
    critSlots: CriticalSlot[] = [],
    entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>(),
    options: CreateComponentOptions = {}
) {
    let context: EquipmentDialogContext;
    const handlers = [
        new InventoryModeHandler(),
        new MmlHandler(),
        new AtmHandler(),
        new ArtemisVHandler(),
        new ApolloHandler(),
        new LaserInsulatorHandler(),
        ...(options.handlers ?? [])
    ];
    const toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'error'; data?: Record<string, unknown> }> = [];
    const toastService = {
        showToast: jasmine.createSpy('showToast').and.callFake((message: string, type: 'info' | 'success' | 'error', id?: string, data?: Record<string, unknown>) => {
            const toastId = id ?? `toast-${toasts.length + 1}`;
            const existingIndex = toasts.findIndex(toast => toast.id === toastId);
            if (existingIndex === -1) {
                toasts.push({ id: toastId, message, type, data });
            } else {
                toasts[existingIndex] = { id: toastId, message, type, data };
            }
            return toastId;
        }),
        toasts: () => toasts,
    };
    const dialogsService = {
        createDialog: jasmine.createSpy('createDialog').and.returnValue({ closed: { subscribe: jasmine.createSpy('subscribe') } }),
        showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
        showError: jasmine.createSpy('showError').and.resolveTo()
    };
    const heat: HeatProfile = { current: 2, previous: 1, next: options.heatNext };
    const rules = {
        computeAllEntryStates: () => entryStates,
        computeEntryState: (entry: MountedEquipment) => entryStates.get(entry) ?? testEntryRuleState(entry),
        heatDissipation: () => options.tracksHeat === false ? null : {
            totalPips: 10,
            healthyPips: 10,
            damagedCount: 0,
            heatsinksOff: 0,
            totalDissipation: options.heatDissipation ?? 0
        },
        getAttackMovementModifier: (moveMode: MotiveModes | null | undefined) => {
            switch (moveMode) {
                case 'walk': return 1;
                case 'run': return 2;
                case 'jump': return 3;
                default: return 0;
            }
        }
    };
    const turnState = {
        moveMode: () => options.moveMode ?? null,
        airborne: () => false,
        getAttackMovementModifier: () => rules.getAttackMovementModifier(options.moveMode ?? null),
        getAttackModifierBreakdown: () => options.attackModifierBreakdown ?? (rules.getAttackMovementModifier(options.moveMode ?? null) !== 0
            ? [{ label: getMotiveModeLabel(options.moveMode!, unit.getUnit(), false), modifier: rules.getAttackMovementModifier(options.moveMode ?? null) }]
            : []),
        missingAttackMovementModifier: () => (options.moveMode ?? null) === null && (options.attackMovementCanAffectTargetNumbers ?? true),
        getSpottingModifier: () => 0,
        heatSources: () => options.heatSources ? [{ id: 'test-source', label: 'Test Source', value: options.heatSources }] : [],
        addFiredHeat: jasmine.createSpy('addFiredHeat')
    };
    const unit = {
        getInventory: () => entries,
        getCritSlots: () => critSlots,
        getUnit: () => ({ comp: [] }),
        getHeat: () => heat,
        setHeat: jasmine.createSpy('setHeat').and.callFake((value: number) => heat.next = value),
        gunnerySkill: () => options.gunnerySkill ?? 4,
        pilotingSkill: () => options.pilotingSkill ?? 5,
        turnState: () => turnState,
        svgService: {
            inventoryTargetHeatFireModifier: () => 0
        },
        hasLinkedC3Network: () => options.hasLinkedC3Network ?? false,
        readOnly: () => options.readOnly ?? false,
        hasDirectInventory: () => options.hasDirectInventory ?? true,
        setInventoryEntry: jasmine.createSpy('setInventoryEntry'),
        setCritSlot: jasmine.createSpy('setCritSlot'),
        isEquipmentUnavailable: testEquipmentUnavailable,
        getLinkedEquipmentHitModifier: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => entry.linkedWith?.reduce((total, linked) => {
            const modifier = handlers
                .filter(handler => handler.flags.length === 0 || (!!linked.equipment?.flags && handler.flags.every(flag => linked.equipment!.flags.has(flag))))
                .filter(handler => !handler.applicableTo || handler.applicableTo(linked))
                .reduce((sum, handler) => sum + (handler.getLinkedEquipmentHitModifier?.(linked, entry, selectedAmmo) ?? 0), 0);
            return total + modifier;
        }, 0) ?? 0,
        rules
    } as unknown as CBTForceUnit;
    addRuntimeSelection(unit);
    (unit.setInventoryEntry as jasmine.Spy).and.callFake((entry: MountedEquipment) => {
        const index = entries.findIndex(item => item.id === entry.id);
        if (index === -1) {
            entries.push(entry);
        } else {
            entries[index] = entry;
        }
        unit.inventoryControl.markInventoryViewChanged();
    });
    entries.forEach(item => item.owner = unit);
    context = {
            toastService,
            dialogsService,
            dataService: { getEquipments: () => equipmentMap },
            registry: {
                getChoices: (entry: MountedEquipment) => handlers.flatMap(handler => {
                    const flagsMatch = handler.flags.length === 0
                        || (!!entry.equipment?.flags && handler.flags.every(flag => entry.equipment!.flags.has(flag)));
                    if (!flagsMatch || (handler.applicableTo && !handler.applicableTo(entry))) return [];
                    return handler.getChoices(entry, context)?.map(choice => ({ ...choice, _handler: handler })) ?? [];
                }),
                handleSelection: (entry: MountedEquipment, choice: HandlerChoice) => choice._handler?.handleSelection(entry, choice, context) ?? false,
                afterInventoryControlFire: async (entry: MountedEquipment) => {
                    for (const handler of handlers) {
                        const flagsMatch = handler.flags.length === 0
                            || (!!entry.equipment?.flags && handler.flags.every(flag => entry.equipment!.flags.has(flag)));
                        if (!flagsMatch || (handler.applicableTo && !handler.applicableTo(entry))) continue;
                        await handler.afterInventoryControlFire?.(entry, context);
                    }
                },
                getLinkedEquipmentHitModifier: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => unit.getLinkedEquipmentHitModifier(entry, selectedAmmo),
                inventoryControlRules: () => ({
                    applyDisplayEffects: (entry: MountedEquipment, display: InventoryControlDisplayData, options: InventoryControlDisplayEffectOptions) => {
                        let nextDisplay = display;
                        for (const handler of handlers) {
                            const flagsMatch = handler.flags.length === 0
                                || (!!entry.equipment?.flags && handler.flags.every(flag => entry.equipment!.flags.has(flag)));
                            if (!flagsMatch || (handler.applicableTo && !handler.applicableTo(entry))) continue;
                            nextDisplay = handler.applyInventoryControlDisplayEffects?.(entry, nextDisplay, options, context) ?? nextDisplay;
                        }
                        return nextDisplay;
                    },
                    matchesAmmo: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) => {
                        for (const handler of handlers) {
                            const flagsMatch = handler.flags.length === 0
                                || (!!entry.equipment?.flags && handler.flags.every(flag => entry.equipment!.flags.has(flag)));
                            if (!flagsMatch || (handler.applicableTo && !handler.applicableTo(entry))) continue;
                            const result = handler.matchesInventoryAmmo?.(entry, ammo, mode, context);
                            if (result !== undefined && result !== null) return result;
                        }
                        return null;
                    },
                    resolveLinkedHitModifier: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => unit.getLinkedEquipmentHitModifier(entry, selectedAmmo)
                })
            }
        } as unknown as EquipmentDialogContext;

    TestBed.configureTestingModule({
        imports: [WeaponsEquipmentPanelComponent],
    });
    const fixture = TestBed.createComponent(WeaponsEquipmentPanelComponent);
    fixture.componentRef.setInput('unit', unit);
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('readOnly', options.readOnly);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, unit, dialogsService, toastService, heat, turnState };
}

describe('WeaponsEquipmentPanelComponent', () => {
    it('groups ranged, physical, equipment, and destroyed entries', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const hatchet = entry({ id: 'hatchet', equipment: misc('Hatchet', ['F_CLUB']), el: svgEntry('<g><g class="name"><text>Hatchet</text></g></g>') });
        const ecm = entry({ id: 'ecm', equipment: misc('ECM'), el: svgEntry('<g><g class="name"><text>ECM</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const unit = { getInventory: () => [laser, punch, hatchet, ecm, broken], getCritSlots: () => [], getUnit: () => ({ subtype: '', comp: [] }), isEquipmentUnavailable: testEquipmentUnavailable, rules: EMPTY_ENTRY_STATE_RULES } as unknown as CBTForceUnit;
        [laser, punch, hatchet, ecm, broken].forEach(item => item.owner = unit);

        const groups = getInventoryControlGroups(unit);

        expect(groups.find(group => group.id === 'ranged')?.rows.map(row => row.id)).toEqual(['laser', 'broken']);
        expect(groups.find(group => group.id === 'physical')?.rows.map(row => row.id)).toEqual(['punch', 'hatchet']);
        expect(groups.find(group => group.id === 'equipment')?.rows.map(row => row.id)).toEqual(['ecm']);
        expect(groups.find(group => group.id === 'ranged')?.rows.find(row => row.id === 'broken')?.destroyed).toBeTrue();
    });

    it('excludes ammo in functionally destroyed locations from weapon ammo summaries', () => {
        const ac2 = weapon('AC/2', 'AC', 2);
        const ac2Ammo = ammo('AC/2 Ammo', 'AC', 2);
        const weaponEntry = entry({ id: 'ac2', equipment: ac2, el: svgEntry('<g><g class="name"><text>AC/2</text></g></g>') });
        const ammoBin = entry({ id: 'ac2-ammo', equipment: ac2Ammo, totalAmmo: 10, consumed: 0, locations: new Set(['RT']) });
        const unit = {
            getInventory: () => [weaponEntry, ammoBin],
            getCritSlots: () => [],
            getUnit: () => ({ subtype: '', comp: [] }),
            isEquipmentUnavailable: (source: MountedEquipment | CriticalSlot) => source === ammoBin,
            rules: EMPTY_ENTRY_STATE_RULES
        } as unknown as CBTForceUnit;
        [weaponEntry, ammoBin].forEach(item => item.owner = unit);

        const row = getInventoryControlGroups(unit, { [ac2Ammo.internalName]: ac2Ammo }).find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.remaining).toBe(0);
        expect(row.ammo.total).toBe(0);
        expect(row.ammo.options).toEqual([jasmine.objectContaining({ remaining: 0, total: 10, destroyed: true, disabled: true })]);
    });

    it('keeps inactive direct inventory rows in original order', () => {
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const unit = { getInventory: () => [broken, laser], getCritSlots: () => [], getUnit: () => ({ subtype: '', comp: [] }), isEquipmentUnavailable: testEquipmentUnavailable, rules: EMPTY_ENTRY_STATE_RULES } as unknown as CBTForceUnit;
        [broken, laser].forEach(item => item.owner = unit);

        const groups = getInventoryControlGroups(unit);

        expect(groups.find(group => group.id === 'ranged')?.rows.map(row => row.id)).toEqual(['broken', 'laser']);
    });

    it('shows rule-damaged inventory rows as destroyed', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), destroyed: false, el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const entryStates = new Map<MountedEquipment, EntryState>([
            [laser, { isDamaged: true, isDisabled: false, hitMod: 0 }]
        ]);
        const { component } = createComponent([laser], {}, [], entryStates);

        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(laser.committedDestroyed()).toBeFalse();
        expect(row.destroyed).toBeTrue();
        expect(component.rowEffectivelyDestroyed(row)).toBeTrue();
    });

    it('toggles BAP state and updates the next toggle label', async () => {
        const probe = entry({ id: 'probe', equipment: misc('Bloodhound Active Probe', ['F_BAP']), el: svgEntry('<g><g class="name"><text>Probe</text></g></g>') });
        const { component, toastService } = createComponent([probe], {}, [], undefined, { handlers: [new BAPHandler()] });

        let row = component.groups().find(group => group.id === 'equipment')!.rows[0];
        let choice = component.handlerChoices(row)[0];
        expect(choice.label).toBe('Active Probe is OFF');
        expect(choice.value).toBe('enabled');

        await component.handleChoice(row, choice);
        row = component.groups().find(group => group.id === 'equipment')!.rows[0];
        choice = component.handlerChoices(row)[0];

        expect(probe.states?.get('state')).toBe('enabled');
        expect(choice.label).toBe('Active Probe is ON');
        expect(choice.value).toBe('disabled');
        expect(toastService.showToast).toHaveBeenCalledWith('Bloodhound Active Probe Active Probe is ON', 'info');
    });

    it('splits Battle Armor trooper weapons and locks ammo to the same trooper', () => {
        const narc = weapon('CLBACompactNarc', 'NARC', 4);
        narc.flags.add('F_BA_WEAPON');
        const narcAmmo = ammo('BA-Compact Narc Ammo', 'NARC', 4);
        const trooperLabels = [1, 2, 3, 4].map(trooper => `Trooper ${trooper}`);
        const narcEntry = entry({
            id: 'CLBACompactNarc@Squad#0',
            equipment: narc,
            locations: new Set(trooperLabels),
            el: svgEntry('<g><g class="name"><text>Narc (Compact)</text></g><text class="location">Trooper 1/Trooper 2/Trooper 3/Trooper 4</text></g>')
        });
        const ammoEntries = trooperLabels.map((location, index) => entry({
            id: `BA-Compact Narc Ammo@${location}#${index}.0`,
            equipment: narcAmmo,
            locations: new Set([location]),
            totalAmmo: 2,
            consumed: 0,
        }));
        const unit = {
            getInventory: () => [narcEntry, ...ammoEntries],
            getCritSlots: () => [],
            isArmorLocCommittedDestroyed: (loc: string, rear = false) => !rear && loc === 'T1',
            getUnit: () => ({
                subtype: 'Battle Armor',
                squads: 1,
                squadSize: 4,
                comp: trooperLabels.map(location => ({ id: narc.internalName, q: 1, q2: 0, l: location }))
            }),
            locations: { internal: new Map([['TROOP', { loc: 'TROOP', points: 4 }]]), armor: new Map() },
            isEquipmentUnavailable: (source: MountedEquipment | CriticalSlot, loc?: string) => {
                const locationUnavailable = (value: string | undefined) => value === 'Trooper 1' || value === 'T1';
                if (!(source instanceof MountedEquipment)) return !!source.destroyed || locationUnavailable(source.loc);
                if (source.committedDestroyed()) return true;
                return loc ? locationUnavailable(loc) : Array.from(source.locations ?? []).some(locationUnavailable);
            },
            rules: EMPTY_ENTRY_STATE_RULES
        } as unknown as CBTForceUnit;
        [narcEntry, ...ammoEntries].forEach(item => item.owner = unit);

        const rangedRows = getInventoryControlGroups(unit, { [narcAmmo.internalName]: narcAmmo })
            .find(group => group.id === 'ranged')!.rows;

        expect(rangedRows.map(row => row.id)).toEqual(trooperLabels.map(location => `${narcEntry.id}:${location}`));
        expect(rangedRows.map(row => row.display.location)).toEqual(['T1', 'T2', 'T3', 'T4']);
        expect(rangedRows.map(row => row.entry.id)).toEqual(rangedRows.map(row => row.id));
        expect(rangedRows.map(row => row.destroyed)).toEqual([true, false, false, false]);
        expect(rangedRows.map(row => row.ammo.options.map(option => option.id))).toEqual(trooperLabels.map(location => [`${narcAmmo.internalName}:${location}`]));
        expect(rangedRows.map(row => row.ammo.remaining)).toEqual([0, 2, 2, 2]);
        expect(rangedRows[0].ammo.options[0].destroyed).toBeTrue();
        expect(rangedRows[0].ammo.options[0].disabled).toBeTrue();
        expect(rangedRows.slice(1).every(row => !row.ammo.options[0].destroyed)).toBeTrue();
    });

    it('marks rows disabled from entry state rules', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [laser, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component } = createComponent([laser], {}, [], entryStates);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.disabled).toBeTrue();
        expect(row.destroyed).toBeFalse();
    });

    it('marks jammed inventory-only rows disabled without entry state rules', () => {
        const uac = entry({
            id: 'uac',
            equipment: weapon('uac', 'AC_ULTRA'),
            states: new Map([['state', 'jammed']]),
            el: svgEntry('<g><g class="name"><text>Ultra AC/2</text></g></g>')
        });
        const unit = { getInventory: () => [uac], getCritSlots: () => [], getUnit: () => ({ subtype: '', comp: [] }), isEquipmentUnavailable: testEquipmentUnavailable, rules: EMPTY_ENTRY_STATE_RULES } as unknown as CBTForceUnit;
        uac.owner = unit;

        const row = getInventoryControlGroups(unit).find(group => group.id === 'ranged')!.rows[0];

        expect(row.disabled).toBeTrue();
        expect(uac.el!.classList.contains('disabledInventory')).toBeTrue();
    });

    it('marks direct inventory hits pending before commit', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const { component, fixture, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.canMarkDestroyed(row)).toBeTrue();
        expect(component.canRepair(row)).toBeFalse();

        component.markDestroyed(row);
        fixture.detectChanges();

        expect(laser.committedDestroyed()).toBeFalse();
        expect(unit.setInventoryEntry).toHaveBeenCalledOnceWith(laser);
        expect(laser.pendingDestroyed()).toBeTrue();
        expect(component.rowDestroying(row)).toBeTrue();
        expect(component.rowEffectivelyDestroyed(row)).toBeTrue();
        expect((fixture.nativeElement.querySelector('.weapon-equipment-row') as HTMLElement).classList.contains('destroying-entry')).toBeTrue();

        component.repair(row);

        expect(laser.pendingDestroyed()).toBeUndefined();
        expect(unit.setInventoryEntry).toHaveBeenCalledTimes(2);
        expect(component.rowEffectivelyDestroyed(row)).toBeFalse();
    });

    it('repairs destroyed direct inventory entries pending before commit', () => {
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const { component, fixture, unit } = createComponent([broken]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.canMarkDestroyed(row)).toBeFalse();
        expect(component.canRepair(row)).toBeTrue();

        component.repair(row);
        fixture.detectChanges();

        expect(broken.committedDestroyed()).toBeTrue();
        expect(unit.setInventoryEntry).toHaveBeenCalledOnceWith(broken);
        expect(broken.pendingDestroyed()).toBeFalse();
        expect(component.rowRepairing(row)).toBeTrue();
        expect(component.rowEffectivelyDestroyed(row)).toBeFalse();
        expect((fixture.nativeElement.querySelector('.weapon-equipment-row') as HTMLElement).classList.contains('repairing-entry')).toBeTrue();
    });

    it('uses real alternative modes and treats label-only modes as modifiers', () => {
        const mml = entry({
            id: 'mml',
            equipment: weapon('mml'),
            el: svgEntry(`
                <g>
                    <g class="name"><text>MML 9</text></g>
                    <text class="location">RT</text>
                    <text class="heat">5</text>
                    <g class="damage"><text>[M,C,S]</text></g>
                    <text class="range_min"></text><text class="range_short"></text><text class="range_medium"></text><text class="range_long"></text>
                    <g class="alternativeMode" mode="w/Artemis IV"><g class="name"><text>w/Artemis IV</text></g></g>
                    <g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">21</text></g>
                </g>
            `)
        });
        const { component } = createComponent([mml]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.modes.map(mode => mode.mode)).toEqual(['LRM']);
        expect(row.modifiers.map(modifier => modifier.name)).toEqual(['w/Artemis IV']);
        expect(row.selectedMode).toBe('LRM');
        expect(row.display.damage).toBe('1/Msl');
        expect(row.display.long).toBe('21');
        expect(mml.el?.querySelector(':scope > .alternativeMode.selected')?.getAttribute('mode')).toBe('LRM');
        expect(component.modeChoice(row)?.choices?.map(choice => choice.value)).toEqual(['LRM']);
        expect(component.handlerChoices(row)).toEqual([]);
    });

    it('shows linked weapon enhancements as modifiers instead of standalone rows', () => {
        const artemis = entry({
            id: 'ISArtemisIV@RT#5',
            equipment: misc('ISArtemisIV', ['F_WEAPON_ENHANCEMENT']),
            destroyed: true,
            el: svgEntry('<g class="linked"><g class="name"><text>w/Artemis IV</text></g></g>')
        });
        const lrm = entry({
            id: 'LRM 20@RT#0',
            equipment: weapon('LRM 20', 'MML', 20),
            linkedWith: [artemis],
            el: svgEntry('<g><g class="name"><text>LRM 20</text></g><text class="location">RT</text><text class="heat">6</text><g class="damage"><text>1/Msl [M,C,S]</text></g></g>')
        });
        artemis.parent = lrm;
        const { component } = createComponent([lrm, artemis]);
        const rows = component.groups().flatMap(group => group.rows);

        expect(rows.map(row => row.id)).toEqual(['LRM 20@RT#0']);
        expect(rows[0].modifiers).toEqual([{ name: 'w/Artemis IV', destroyed: true }]);
    });

    it('charges linked PPC capacitors from the PPC row and discharges them when fired', async () => {
        const ppcEquipment = weapon('Light PPC');
        ppcEquipment.flags.add('F_PPC');
        const capacitor = entry({
            id: 'PPC Capacitor@RA#5',
            equipment: misc('PPC Capacitor', ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR']),
            el: svgEntry('<g class="linked"><g class="name"><text>w/Capacitor</text></g></g>')
        });
        const ppc = entry({
            id: 'Light PPC@RA#3',
            equipment: ppcEquipment,
            linkedWith: [capacitor],
            el: svgEntry('<g><g class="name"><text>Light PPC</text></g><text class="heat">5</text><g class="damage"><text>5 [DE]</text></g><text class="range_medium">12</text></g>')
        });
        capacitor.parent = ppc;
        const { component, turnState } = createComponent([ppc, capacitor], {}, [], new Map(), {
            handlers: [new PpcCapacitorHandler()]
        });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.display.heat).toBe('5');
        expect(row.display.damage).toBe('5 [DE]');
        expect(component.handlerChoices(row).map(choice => choice.shortLabel)).toEqual(['Charge']);

        await component.handleChoice(row, component.handlerChoices(row)[0]);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(capacitor.states.get(PPC_CAPACITOR_STATE_KEY)).toBe('charged');
        expect(row.display.heat).toBe('10');
        expect(row.display.damage).toBe('10 [DE]');
        expect(component.handlerChoices(row)[0]).toEqual(jasmine.objectContaining({ shortLabel: 'Charged', active: true }));

        component.toggleSelected(row);
        expect(component.selectedHeatTotal()).toBe(10);

        await component.consumeSelectedHeatAndAmmo();

        expect(turnState.addFiredHeat).toHaveBeenCalledWith(10);
        expect(capacitor.states.has(PPC_CAPACITOR_STATE_KEY)).toBeFalse();
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.display.heat).toBe('5');
        expect(row.display.damage).toBe('5 [DE]');
    });

    it('ignores unavailable linked PPC capacitors', () => {
        const ppcEquipment = weapon('Light PPC');
        ppcEquipment.flags.add('F_PPC');
        const capacitor = entry({
            id: 'PPC Capacitor@RA#5',
            equipment: misc('PPC Capacitor', ['F_WEAPON_ENHANCEMENT', 'F_PPC_CAPACITOR']),
            destroyed: true,
            states: new Map([[PPC_CAPACITOR_STATE_KEY, 'charged']]),
            el: svgEntry('<g class="linked"><g class="name"><text>w/Capacitor</text></g></g>')
        });
        const ppc = entry({
            id: 'Light PPC@RA#3',
            equipment: ppcEquipment,
            linkedWith: [capacitor],
            el: svgEntry('<g><g class="name"><text>Light PPC</text></g><text class="heat">5</text><g class="damage"><text>5 [DE]</text></g></g>')
        });
        capacitor.parent = ppc;
        const { component } = createComponent([ppc, capacitor], {}, [], new Map(), {
            handlers: [new PpcCapacitorHandler()]
        });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.display.heat).toBe('5');
        expect(row.display.damage).toBe('5 [DE]');
        expect(component.handlerChoices(row)).toEqual([]);
    });

    it('marks heat as damaged when Laser Insulator heat is restored', () => {
        const laserEquipment = weapon('Medium Laser');
        laserEquipment.flags.add('F_ENERGY');
        laserEquipment.flags.add('F_LASER');
        const insulator = entry({
            id: 'Laser Insulator@RA#5',
            equipment: misc('Laser Insulator', ['F_WEAPON_ENHANCEMENT', 'F_LASER_INSULATOR']),
            destroyed: true,
            el: svgEntry('<g class="linked"><g class="name"><text>Laser Insulator</text></g></g>')
        });
        const laser = entry({
            id: 'Medium Laser@RA#3',
            equipment: laserEquipment,
            linkedWith: [insulator],
            el: svgEntry('<g><g class="name"><text>Medium Laser</text></g><text class="heat">3*</text><g class="damage"><text>5</text></g></g>')
        });
        insulator.parent = laser;
        const { component, fixture } = createComponent([laser, insulator]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.base.heat).toBe('3*');
        expect(row.display.heat).toBe('4');
        expect((fixture.nativeElement.querySelector('.heat-cell') as HTMLElement).classList.contains('damaged')).toBeTrue();
    });

    it('persists mode and sort order but keeps selection transient', async () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const modeEntry = entry({
            id: 'mode',
            equipment: weapon('mode'),
            el: svgEntry('<g><g class="name"><text>Mode</text></g><g class="alternativeMode" mode="A"><g class="name"><text>A</text></g><g class="damage"><text>1</text></g></g></g>')
        });
        const { component, fixture } = createComponent([first, second, modeEntry]);
        const group = component.groups().find(candidate => candidate.id === 'ranged')!;

        component.drop({ previousIndex: 0, currentIndex: 1 } as CdkDragDrop<any>, group);

        const rangedSortKey = inventoryControlSortKey('ranged');
        expect(first.states.get(rangedSortKey)).toBe('1');
        expect(second.states.get(rangedSortKey)).toBe('0');

        const row = component.groups().find(candidate => candidate.id === 'ranged')!.rows.find(candidate => candidate.id === 'mode')!;
        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'A', label: 'A' });
        component.selectRange(row, 'short');
        const updatedRow = component.groups().find(candidate => candidate.id === 'ranged')!.rows.find(candidate => candidate.id === 'mode')!;

        expect(modeEntry.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('A');
        expect(component.modeChoice(updatedRow)?.value).toBe('A');
        expect(modeEntry.states.has('selected')).toBeFalse();
        expect(modeEntry.states.has('range')).toBeFalse();
        fixture.destroy();
    });

    it('keeps range selection tied to entry selection', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><rect class="inventoryEntryButton"></rect><rect class="shrButton inventoryEntryButton"></rect><rect class="medButton inventoryEntryButton"></rect><rect class="lngButton inventoryEntryButton"></rect><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeTrue();
        expect(component.isRangeSelected(row, 'medium')).toBeTrue();

        component.toggleSelected(row);
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();

        component.selectRange(row, 'medium');
        component.selectRange(row, 'medium');
        expect(component.isSelected(row)).toBeFalse();
        expect(component.isRangeSelected(row, 'medium')).toBeFalse();
    });

    it('uses selected range for variable damage arrays and pulse hit modifiers', () => {
        const vspLaser = entry({
            id: 'vsp',
            baseHitMod: '-4',
            equipment: new WeaponEquipment({
                id: 'ISMediumVSPLaser',
                name: 'Medium VSP Laser',
                type: 'weapon',
                flags: ['F_DIRECT_FIRE','F_PULSE','F_VSP'],
                weapon: { ammoType: 'NA', heat: 7, damage: [9, 7, 5], ranges: [2, 5, 9, 13] }
            }),
            el: svgEntry('<g><g class="name"><text>Medium VSP Laser</text></g><g class="damage"><text>9/7/5 [Variable]</text></g><text class="range_short">2</text><text class="range_medium">5</text><text class="range_long">9</text></g>')
        });
        const { component, fixture, unit } = createComponent([vspLaser], {}, [], new Map(), { moveMode: 'stationary' });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.selectRange(row, 'short');
        fixture.detectChanges();
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.display.damage).toBe('9 [Variable]');
        expect(row.display.hit).toBe('-3');

        component.selectRange(row, 'medium');
        fixture.detectChanges();
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.display.damage).toBe('7 [Variable]');
        expect(row.display.hit).toBe('-2');

        component.selectRange(row, 'long');
        fixture.detectChanges();
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.display.damage).toBe('5 [Variable]');
        expect(row.display.hit).toBe('-1');

        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 1, tnCalculator: { stance: 'immobile' } });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        const targetState = component.targetState(row);
        expect(targetState.damageText).toBe('9 [Variable]');
        expect(targetState.hitText).toBe('-3');
        expect(targetState.targetNumberText).toBe('1');
    });

    it('uses actual target distance for variable damage arrays and pulse hit modifiers when C3 range is shorter', () => {
        const vspLaser = entry({
            id: 'vsp',
            baseHitMod: '-4',
            equipment: new WeaponEquipment({
                id: 'ISMediumVSPLaser',
                name: 'Medium VSP Laser',
                type: 'weapon',
                flags: ['F_DIRECT_FIRE','F_PULSE','F_VSP'],
                weapon: { ammoType: 'NA', heat: 7, damage: [9, 7, 5], ranges: [2, 5, 9, 13] }
            }),
            el: svgEntry('<g><g class="name"><text>Medium VSP Laser</text></g><g class="damage"><text>9/7/5 [Variable]</text></g><text class="range_short">2</text><text class="range_medium">5</text><text class="range_long">9</text></g>')
        });
        const { component, unit } = createComponent([vspLaser], {}, [], new Map(), { moveMode: 'stationary', hasLinkedC3Network: true });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 8, c3Distance: 1, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('short');
        expect(targetState.damageText).toBe('5 [Variable]');
        expect(targetState.hitText).toBe('-1');
        expect(targetState.targetNumberText).toBe('3');
    });

    it('tracks built-in one-shot weapon shots through consumed inventory state', async () => {
        const rocket = entry({
            id: 'rocket',
            equipment: new WeaponEquipment({
                id: 'RL20',
                name: 'Rocket Launcher 20',
                type: 'weapon',
                flags: ['F_ONE_SHOT'],
                weapon: { ammoType: 'ROCKET_LAUNCHER', rackSize: 20, heat: 5, damage: 'cluster', ranges: [3, 7, 12, 18] }
            }),
            el: svgEntry('<g><g class="name"><text>Rocket Launcher 20</text></g><text class="heat">5</text><text class="range_short">3</text><text class="range_medium">7</text><text class="range_long">12</text></g>')
        });
        const { component, fixture } = createComponent([rocket]);
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.tracksAmmo).toBeTrue();
        expect(row.ammo.remaining).toBe(1);
        expect(row.ammo.total).toBe(1);
        expect(component.ammoState(row).hasAmmo).toBeTrue();

        component.toggleSelected(row);
        await component.consumeSelectedHeatAndAmmo();

        expect(rocket.consumed).toBe(1);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.ammo.remaining).toBe(0);
        expect(component.ammoState(row).hasAmmo).toBeTrue();
        expect(component.ammoState(row).canDecrease).toBeFalse();
        expect(component.ammoState(row).canIncrease).toBeTrue();
        fixture.detectChanges();
        const depletedButtons = Array.from(fixture.nativeElement.querySelectorAll('.ammo-stepper-button')) as HTMLButtonElement[];
        expect(depletedButtons.length).toBe(2);
        expect(depletedButtons[0].disabled).toBeTrue();
        expect(depletedButtons[1].disabled).toBeFalse();

        component.adjustAmmo(row, -1);

        expect(rocket.consumed).toBeUndefined();
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.ammo.remaining).toBe(1);
    });

    it('stores built-in one-shot consumption on the owning critical slot when present', () => {
        const critSlot: CriticalSlot = { id: 'RL20@RT#0', loc: 'RT', slot: 0 };
        const rocket = entry({
            id: 'rocket',
            critSlots: [critSlot],
            equipment: new WeaponEquipment({
                id: 'RL20',
                name: 'Rocket Launcher 20',
                type: 'weapon',
                flags: ['F_ONE_SHOT'],
                weapon: { ammoType: 'ROCKET_LAUNCHER', rackSize: 20, heat: 5, damage: 'cluster', ranges: [3, 7, 12, 18] }
            }),
            el: svgEntry('<g><g class="name"><text>Rocket Launcher 20</text></g><text class="heat">5</text><text class="range_short">3</text><text class="range_medium">7</text><text class="range_long">12</text></g>')
        });
        const { component, unit } = createComponent([rocket]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.adjustAmmo(row, 1);

        expect(critSlot.consumed).toBe(1);
        expect(unit.setCritSlot).toHaveBeenCalledWith(critSlot);
        expect(rocket.consumed).toBeUndefined();
    });

    it('computes target distance range state without mutating SVG classes directly', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [3, 6, 9, 12]), el: svgEntry('<g><rect class="inventoryEntryButton"></rect><rect class="shrButton inventoryEntryButton"></rect><rect class="medButton inventoryEntryButton"></rect><rect class="lngButton inventoryEntryButton"></rect><rect class="extButton inventoryEntryButton"></rect><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 10 });
        unit.setInventoryControlEntryTarget(laser, 'A');

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.outOfLongRange).toBeTrue();
        expect(component.isRangeSelected(row, 'long')).toBeFalse();
        expect(targetState.targetNumberText).toBe('X');
        expect(laser.el!.classList.contains('selected-range-extreme')).toBeFalse();
        expect(laser.el!.classList.contains('selected-range-long')).toBeFalse();
    });

    it('upgrades existing weapon selections to the first target and toggles the single target like a checkbox', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        unit.createInventoryControlTarget();
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        expect(unit.getInventoryControlEntryTargetId(row.id)).toBe('A');
        expect(component.isSelected(row)).toBeTrue();
        const selector = fixture.nativeElement.querySelector('.weapon-equipment-row .target-selector') as HTMLButtonElement;
        expect(selector.textContent?.trim()).toBe('A');

        selector.click();
        fixture.detectChanges();

        expect(unit.getInventoryControlEntryTargetId(row.id)).toBeUndefined();
        expect(component.isSelected(row)).toBeFalse();
    });

    it('opens target choices for multiple targets and assigns the picked target', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('B', { distance: 4, tnModifier: 1 });
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        (fixture.nativeElement.querySelector('.weapon-equipment-row .target-selector') as HTMLButtonElement).click();
        fixture.detectChanges();
        const choices = Array.from(document.body.querySelectorAll('.weapon-target-choice-menu .target-choice')) as HTMLButtonElement[];
        expect(choices.map(choice => choice.querySelector('.target-choice-token')?.textContent?.trim())).toEqual(['—', 'A', 'B']);
        expect(choices.map(choice => choice.querySelector('.target-choice-tn')?.textContent?.trim() ?? '')).toEqual(['', 'M?', 'M?']);

        choices[2].click();
        fixture.detectChanges();

        expect(unit.getInventoryControlEntryTargetId(row.id)).toBe('B');
        expect(component.isSelected(row)).toBeTrue();
        fixture.destroy();
    });

    it('uses the target selector for ranged select all when targets exist', () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const disabled = entry({ id: 'disabled', equipment: weapon('disabled'), el: svgEntry('<g><g class="name"><text>Disabled</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [disabled, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component, fixture, unit } = createComponent([first, second, broken, disabled, punch], {}, [], entryStates);
        unit.createInventoryControlTarget();
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();
        const rangedSection = (Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[])
            .find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const headerSelector = rangedSection.querySelector('.select-header .target-selector') as HTMLButtonElement;
        const rows = component.groups().flatMap(group => group.rows);
        const firstRow = rows.find(row => row.id === 'first')!;
        const secondRow = rows.find(row => row.id === 'second')!;
        const brokenRow = rows.find(row => row.id === 'broken')!;
        const disabledRow = rows.find(row => row.id === 'disabled')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        headerSelector.click();
        fixture.detectChanges();

        expect(unit.getInventoryControlEntryTargetId(firstRow.id)).toBe('A');
        expect(unit.getInventoryControlEntryTargetId(secondRow.id)).toBe('A');
        expect(unit.getInventoryControlEntryTargetId(brokenRow.id)).toBeUndefined();
        expect(unit.getInventoryControlEntryTargetId(disabledRow.id)).toBeUndefined();
        expect(unit.getInventoryControlEntryTargetId(punchRow.id)).toBeUndefined();
        expect(component.groupTargetSelection(component.groups().find(group => group.id === 'ranged')!)?.id).toBe('A');

        unit.setInventoryControlEntryTarget(brokenRow.entry, 'A');
        unit.setInventoryControlEntryTarget(disabledRow.entry, 'A');

        (rangedSection.querySelector('.select-header .target-selector') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeFalse();
        expect(component.isSelected(secondRow)).toBeFalse();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
    });

    it('uses assigned target distance for range selection and target number math', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map([[laser, { isDamaged: false, isDisabled: false, hitMod: 1 }]]), { gunnerySkill: 4, moveMode: 'run' });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 8, tnModifier: 1 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        expect(component.canSelectRange(row, 'long')).toBeFalse();
        expect(component.isRangeSelected(row, 'long')).toBeTrue();
        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.outOfLongRange).toBeFalse();
        expect(targetState.rangeSelection?.outOfExtremeRange).toBeFalse();
        expect(targetState.targetNumberText).toBe('12');
        expect(targetState.breakdown?.lines).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Run', value: '+2' },
            { label: 'Target (A)', value: '+1' },
            { label: 'Range (Long)', value: '+4' },
            { label: 'Hit Modifier', value: '+1' },
            { isBreak: true },
            { label: 'Total', value: '12', isHeader: true },
        ]);
        expect((fixture.nativeElement.querySelector('.tn-cell') as HTMLElement).hasAttribute('data-tooltip-host')).toBeTrue();
        const selectedRangeCell = fixture.nativeElement.querySelector('.range-long') as HTMLElement;
        expect(selectedRangeCell.classList.contains('selected-range')).toBeTrue();
        expect(selectedRangeCell.style.getPropertyValue('--range-selection-color')).toBe(INVENTORY_CONTROL_TARGET_COLORS[0]);
    });

    it('uses C3 distance for weapon range bracket while minimum range uses actual distance', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [7, 14, 27, 36]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">27</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'run', hasLinkedC3Network: true });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 2, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('short');
        expect(targetState.rangeSelection?.distance).toBe(20);
        expect(targetState.rangeSelection?.c3Distance).toBe(2);
        expect(targetState.rangeSelection?.minimumRangeModifier).toBe(0);
        expect(targetState.targetNumberText).toBe('6');
        expect(targetState.breakdown?.lines).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Run', value: '+2' },
            { label: 'Range (Short)', value: '+0' },
            { label: 'C³ Distance', value: '2 (actual 20)' },
            { isBreak: true },
            { label: 'Total', value: '6', isHeader: true },
        ]);
        expect((fixture.nativeElement.querySelector('.range-short') as HTMLElement).classList.contains('selected-range')).toBeTrue();
        expect((fixture.nativeElement.querySelector('.min-cell') as HTMLElement).classList.contains('minimum-range-active')).toBeFalse();
    });

    it('uses distance C3 target data', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [7, 14, 27, 36]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">27</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'run', hasLinkedC3Network: true });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 2, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('short');
        expect(targetState.rangeSelection?.c3Distance).toBe(2);
        expect(targetState.targetNumberText).toBe('6');
    });

    it('shows out of range when actual distance exceeds weapon long range despite C3 distance', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [2, 4, 6, 8]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">2</text><text class="range_medium">4</text><text class="range_long">6</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'run', hasLinkedC3Network: true });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 3, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('medium');
        expect(targetState.rangeSelection?.outOfLongRange).toBeTrue();
        expect(targetState.targetNumberText).toBe('X');
        expect(targetState.breakdown).toBeNull();
    });

    it('ignores stored C3 distance when the unit is not linked to a C3 network', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [7, 14, 27, 36]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">27</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'run' });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 20, c3Distance: 2, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('long');
        expect(targetState.rangeSelection?.c3Distance).toBeNull();
        expect(targetState.targetNumberText).toBe('10');
    });

    it('uses actual distance when it is shorter than C3 distance', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [7, 14, 27, 36]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">7</text><text class="range_medium">14</text><text class="range_long">27</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'run', hasLinkedC3Network: true });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 5, c3Distance: 20, useC3: true });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.range).toBe('short');
        expect(targetState.rangeSelection?.distance).toBe(5);
        expect(targetState.rangeSelection?.c3Distance).toBe(20);
        expect(targetState.rangeSelection?.minimumRangeModifier).toBe(2);
        expect(targetState.targetNumberText).toBe('8');
    });

    it('applies selected ammo to-hit modifiers to target number math', () => {
        const lbxClusterAmmo = ammo('LB 10-X Cluster', 'AC', 10, ['M_CLUSTER'], [], -1);
        const lbx = entry({ id: 'lbx', equipment: weapon('LB 10-X AC', 'AC', 10, [5, 10, 15, 20]), el: svgEntry('<g><g class="name"><text>LB 10-X AC</text></g><text class="range_short">5</text><text class="range_medium">10</text><text class="range_long">15</text></g>') });
        const ammoBin = entry({ id: 'cluster-ammo', equipment: lbxClusterAmmo, totalAmmo: 10, consumed: 0, locations: new Set(['CT']) });
        const { component, fixture, unit } = createComponent([lbx, ammoBin], { [lbxClusterAmmo.internalName]: lbxClusterAmmo }, [], new Map(), { gunnerySkill: 4, moveMode: 'stationary' });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        component.selectAmmoOption(row, row.ammo.options[0].id);
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 8 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        const targetState = component.targetState(row);
        expect(targetState.targetNumberText).toBe('5');
        expect(targetState.breakdown?.lines).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Range (Medium)', value: '+2' },
            { label: 'Ammo (LB 10-X Cluster)', value: '-1' },
            { isBreak: true },
            { label: 'Total', value: '5', isHeader: true },
        ]);
    });

    it('highlights minimum range when assigned target distance is at or below Min', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_min">6</text><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4, moveMode: 'stationary' });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 6 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        const targetState = component.targetState(row);
        expect(targetState.targetNumberText).toBe('7');
        expect(targetState.rangeSelection?.minimumRangeModifier).toBe(1);
        expect((fixture.nativeElement.querySelector('.min-cell') as HTMLElement).classList.contains('minimum-range-active')).toBeTrue();
        expect(targetState.breakdown?.lines).toContain({ label: 'Minimum Range', value: '+1' });

        unit.updateInventoryControlTarget('A', { distance: 7 });
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        const clearedTargetState = component.targetState(row);
        expect(clearedTargetState.rangeSelection?.minimumRangeModifier).toBe(0);
        expect((fixture.nativeElement.querySelector('.min-cell') as HTMLElement).classList.contains('minimum-range-active')).toBeFalse();
    });

    it('shows movement placeholder for target numbers when movement is unassigned and affects TN', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 4, tnModifier: 1 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.targetNumberText).toBe('M?');
        expect(targetState.breakdown?.lines).toEqual([{ value: 'Select movement to calculate TN', isHeader: true }]);
    });

    it('does not show movement placeholder for unassigned target rows', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.inventoryControl.markInventoryViewChanged();

        const targetState = component.targetState(row);
        expect(targetState.targetNumberText).toBe('');
        expect(targetState.breakdown).toBeNull();
    });

    it('shows heat fire modifiers as a separate target number term', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map([[laser, { isDamaged: false, isDisabled: false, hitMod: 3 }]]), { gunnerySkill: 4, moveMode: 'stationary' });
        (unit.svgService as any).inventoryTargetHeatFireModifier = () => 2;
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 4, tnModifier: 1 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        const targetState = component.targetState(row);
        expect(targetState.targetNumberText).toBe('10');
        expect(targetState.breakdown?.lines).toEqual([
            { label: 'Gunnery', value: '4' },
            { label: 'Target (A)', value: '+1' },
            { label: 'Range (Medium)', value: '+2' },
            { label: 'Hit Modifier', value: '+1' },
            { label: 'Heat - Fire Modifier', value: '+2' },
            { isBreak: true },
            { label: 'Total', value: '10', isHeader: true },
        ]);
    });

    it('only keeps the Artemis V linked hit modifier when Artemis V-capable ammo is selected', () => {
        const standardAmmo = ammo('Narc Standard', 'NARC', 4);
        const artemisVAmmo = ammo('Narc Artemis V', 'NARC', 4, ['M_ARTEMIS_V_CAPABLE']);
        const artemisV = entry({
            id: 'ArtemisV@RT#1',
            equipment: misc('ArtemisV', ['F_WEAPON_ENHANCEMENT', 'F_ARTEMIS_V']),
        });
        const launcher = entry({
            id: 'launcher',
            baseHitMod: '-1',
            equipment: weapon('Narc Launcher', 'NARC', 4),
            linkedWith: [artemisV],
            el: svgEntry('<g><g class="name"><text>Narc Launcher</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>')
        });
        const standardBin = entry({ id: 'standard-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 0, locations: new Set(['RT']) });
        const artemisVBin = entry({ id: 'artemis-v-ammo', equipment: artemisVAmmo, totalAmmo: 10, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [standardAmmo.internalName]: standardAmmo,
            [artemisVAmmo.internalName]: artemisVAmmo,
        };
        const { component, fixture, unit } = createComponent([launcher, artemisV, standardBin, artemisVBin], equipmentMap);
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.display.hit).toBe('+0');

        const artemisVOption = row.ammo.options.find(option => option.ammo === artemisVAmmo)!;
        component.selectAmmoOption(row, artemisVOption.id);
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.display.hit).toBe('-1');
    });

    it('uses piloting skill for physical target numbers', () => {
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const { component, unit } = createComponent([punch], {}, [], new Map(), { pilotingSkill: 6, moveMode: 'stationary' });
        const row = component.groups().find(group => group.id === 'physical')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 10, tnModifier: 1 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();

        expect(component.isRangeSelected(row, 'short')).toBeFalse();
        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.outOfLongRange).toBeFalse();
        expect(targetState.rangeSelection?.outOfExtremeRange).toBeFalse();
        expect(targetState.targetNumberText).toBe('7');
        expect(targetState.breakdown?.lines).toEqual([
            { label: 'Piloting', value: '6' },
            { label: 'Target (A)', value: '+1' },
            { isBreak: true },
            { label: 'Total', value: '7', isHeader: true },
        ]);
    });

    it('marks target numbers out of range beyond long range', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser', 'NA', 0, [3, 6, 9, 12]), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const { component, fixture, unit } = createComponent([laser], {}, [], new Map(), { gunnerySkill: 4 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        unit.createInventoryControlTarget();
        unit.updateInventoryControlTarget('A', { distance: 11, tnModifier: 1 });
        unit.setInventoryControlEntryTarget(row.entry, 'A');
        unit.inventoryControl.markInventoryViewChanged();
        fixture.detectChanges();

        const targetState = component.targetState(row);
        expect(targetState.rangeSelection?.outOfLongRange).toBeTrue();
        expect(targetState.rangeSelection?.outOfExtremeRange).toBeFalse();
        expect(targetState.targetNumberText).toBe('X');
        expect(targetState.breakdown).toBeNull();
        expect(component.outOfRangeTooltip).toEqual([{ value: 'OUT OF RANGE', isHeader: true }]);
        expect((fixture.nativeElement.querySelector('.tn-cell') as HTMLElement).classList.contains('out-of-range')).toBeTrue();
        const rangeCells = Array.from(fixture.nativeElement.querySelectorAll('.range-cell')) as HTMLElement[];
        expect(rangeCells.every(cell => cell.classList.contains('out-of-range'))).toBeTrue();
        expect(rangeCells.every(cell => cell.style.getPropertyValue('--range-selection-color') === '')).toBeTrue();
    });

    it('toggles all ranged weapons from the ranged group header checkbox', () => {
        const first = entry({ id: 'first', equipment: weapon('first'), el: svgEntry('<g><g class="name"><text>First</text></g></g>') });
        const second = entry({ id: 'second', equipment: weapon('second'), el: svgEntry('<g><g class="name"><text>Second</text></g></g>') });
        const broken = entry({ id: 'broken', equipment: weapon('broken'), destroyed: true, el: svgEntry('<g><g class="name"><text>Broken</text></g></g>') });
        const disabled = entry({ id: 'disabled', equipment: weapon('disabled'), el: svgEntry('<g><g class="name"><text>Disabled</text></g></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g></g>') });
        const entryStates = new Map<MountedEquipment, { isDamaged: boolean; isDisabled: boolean; hitMod: number }>([
            [disabled, { isDamaged: false, isDisabled: true, hitMod: 0 }]
        ]);
        const { component, fixture, unit } = createComponent([first, second, broken, disabled, punch], {}, [], entryStates);
        fixture.detectChanges();

        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const checkbox = rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!;
        const rows = component.groups().flatMap(group => group.rows);
        const firstRow = rows.find(row => row.id === 'first')!;
        const secondRow = rows.find(row => row.id === 'second')!;
        const brokenRow = rows.find(row => row.id === 'broken')!;
        const disabledRow = rows.find(row => row.id === 'disabled')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        checkbox.click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeTrue();
        expect(component.isSelected(secondRow)).toBeTrue();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.checked).toBeTrue();

        unit.setInventoryControlEntrySelected(brokenRow.entry, true);
        unit.setInventoryControlEntrySelected(disabledRow.entry, true);

        rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.click();
        fixture.detectChanges();

        expect(component.isSelected(firstRow)).toBeFalse();
        expect(component.isSelected(secondRow)).toBeFalse();
        expect(component.isSelected(brokenRow)).toBeFalse();
        expect(component.isSelected(disabledRow)).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(rangedSection.querySelector<HTMLInputElement>('.ranged-select-all')!.checked).toBeFalse();
    });

    it('resets entry and range selections from the dialog state', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g><text class="range_short">3</text><text class="range_medium">6</text><text class="range_long">9</text></g>') });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const { component, unit } = createComponent([laser, punch]);
        const rows = component.groups().flatMap(group => group.rows);
        const laserRow = rows.find(row => row.id === 'laser')!;
        const punchRow = rows.find(row => row.id === 'punch')!;

        component.selectRange(laserRow, 'medium');
        component.toggleSelected(punchRow);
        expect(component.isSelected(laserRow)).toBeTrue();
        expect(component.isRangeSelected(laserRow, 'medium')).toBeTrue();
        expect(component.isSelected(punchRow)).toBeTrue();

        component.resetSelections();

        expect(component.isSelected(laserRow)).toBeFalse();
        expect(component.isRangeSelected(laserRow, 'medium')).toBeFalse();
        expect(component.isSelected(punchRow)).toBeFalse();
        expect(unit.getInventoryControlSnapshot().entryStates.size).toBe(0);
    });

    it('raises selected weapon heat before dissipation and consumes shared ammo bins', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const first = entry({
            id: 'first-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const second = entry({
            id: 'second-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">3</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, heat, turnState } = createComponent([first, second, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3 });
        const rows = component.groups().find(group => group.id === 'ranged')!.rows;

        component.toggleSelected(rows[0]);
        component.toggleSelected(rows[1]);
        fixture.detectChanges();

        expect(component.selectedHeatTotal()).toBe(7);
        expect(component.selectedHeatProjection()).toEqual(jasmine.objectContaining({
            current: 2,
            sources: 0,
            selection: 7,
            dissipation: 3,
            final: 6,
            dissipationWidth: 10,
            pendingWidth: 30
        }));

        await component.consumeSelectedHeatAndAmmo();

        expect(ammoBin.consumed).toBe(3);
        expect(unit.setInventoryEntry).toHaveBeenCalledWith(ammoBin);
        expect(unit.setHeat).not.toHaveBeenCalled();
        expect(turnState.addFiredHeat).toHaveBeenCalledWith(7);
        expect(heat.next).toBeUndefined();
    });

    it('shows post-consumption ammo counts in the fired summary', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 15, consumed: 5, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, dialogsService } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { tracksHeat: false });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        await component.consumeSelectedHeatAndAmmo();

        expect(ammoBin.consumed).toBe(6);
        expect(dialogsService.showNoticeHtml).toHaveBeenCalledWith(
            'Ammo consumed:<ul><li>1 ammo from ATM 6 Standard (9/15)</li></ul>',
            'Weapons Fired'
        );
    });

    it('hides heat information and consumes only ammo for units that do not track heat', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, turnState } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { tracksHeat: false });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()).toBeNull();

        await component.consumeSelectedHeatAndAmmo();

        expect(ammoBin.consumed).toBe(2);
        expect(unit.setHeat).not.toHaveBeenCalled();
        expect(turnState.addFiredHeat).not.toHaveBeenCalled();
    });

    it('adjusts selected ammo from row stepper controls', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, toastService } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        fixture.detectChanges();
        const buttons = fixture.nativeElement.querySelectorAll('.ammo-stepper-button') as NodeListOf<HTMLButtonElement>;
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent?.trim()).toBe('-');
        expect(buttons[1].textContent?.trim()).toBe('+');

        expect(component.ammoState(row).canDecrease).toBeTrue();
        expect(component.ammoState(row).canIncrease).toBeTrue();
        component.adjustAmmo(row, 1);

        expect(ammoBin.consumed).toBe(2);
        expect(unit.setInventoryEntry).toHaveBeenCalledWith(ammoBin);
        expect(toastService.showToast).toHaveBeenCalledWith('-1 from CT ATM 6 Standard (3/5)', 'info', 'ammo-control-undefined-inventory:std-ammo', { ammoDeltaRemaining: -1 });

        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        component.adjustAmmo(row, -1);
        expect(ammoBin.consumed).toBe(1);
        expect(toastService.showToast).toHaveBeenCalledWith('+1 to CT ATM 6 Standard (4/5)', 'info', 'ammo-control-undefined-inventory:std-ammo', { ammoDeltaRemaining: 1 });

        for (let i = 0; i < 2; i++) {
            row = component.groups().find(group => group.id === 'ranged')!.rows[0];
            component.adjustAmmo(row, -1);
        }
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(ammoBin.consumed).toBe(0);
        expect(component.ammoState(row).canIncrease).toBeFalse();

        for (let i = 0; i < 6; i++) {
            row = component.groups().find(group => group.id === 'ranged')!.rows[0];
            component.adjustAmmo(row, 1);
        }
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(ammoBin.consumed).toBe(5);
        expect(component.ammoState(row).canDecrease).toBeFalse();
    });

    it('keeps the implicit ammo bin selected during stepper adjustments and does not switch to a different ammo type when depleted', () => {
        const standardAmmo = ammo('LRM 15 Ammo', 'MML', 15);
        const artemisAmmo = ammo('LRM 15 Artemis V Ammo', 'MML', 15, ['M_ARTEMIS_V']);
        const lrm = entry({
            id: 'lrm',
            equipment: weapon('LRM 15', 'MML', 15),
            el: svgEntry('<g><g class="name"><text>LRM 15</text></g><text class="heat">5</text><text class="range_short">7</text></g>')
        });
        const standardBin = entry({ id: 'standard-ammo', equipment: standardAmmo, totalAmmo: 6, consumed: 0, locations: new Set(['LT']) });
        const artemisBin = entry({ id: 'artemis-ammo', equipment: artemisAmmo, totalAmmo: 6, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [standardAmmo.internalName]: standardAmmo,
            [artemisAmmo.internalName]: artemisAmmo,
        };
        const { component } = createComponent([lrm, standardBin, artemisBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);

        component.adjustAmmo(row, 1);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(standardBin.consumed).toBe(1);
        expect(artemisBin.consumed).toBe(0);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);
        expect(component.ammoState(row).text).toBe('LRM 15 Ammo (5/6)');

        component.adjustAmmo(row, 1);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(standardBin.consumed).toBe(2);
        expect(artemisBin.consumed).toBe(0);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);
        expect(component.ammoState(row).text).toBe('LRM 15 Ammo (4/6)');

        for (let i = 0; i < 4; i++) {
            row = component.groups().find(group => group.id === 'ranged')!.rows[0];
            component.adjustAmmo(row, 1);
        }
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(standardBin.consumed).toBe(6);
        expect(artemisBin.consumed).toBe(0);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);
        expect(component.ammoState(row).text).toBe('LRM 15 Ammo (0/6)');
    });

    it('switches to another compatible ammo bin after the selected bin is depleted', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 1, consumed: 0, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm, leftBin, rightBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.selectAmmoOption(row, row.ammo.options[0].id);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);
        component.toggleSelected(row);

        await component.consumeSelectedHeatAndAmmo();

        expect(leftBin.consumed).toBe(1);
        expect(rightBin.consumed).toBe(0);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[1].id);
        expect(component.ammoState(row).text).toBe('[RT] ATM 6 Standard (5/5)');

        await component.consumeSelectedHeatAndAmmo();

        expect(leftBin.consumed).toBe(1);
        expect(rightBin.consumed).toBe(1);
    });

    it('does not switch to a different ammo type after the selected bin is depleted', async () => {
        const fragAmmo = ammo('LRM 15 Frag', 'MML', 15);
        const smokeAmmo = ammo('LRM 15 Smoke', 'MML', 15);
        const lrm = entry({
            id: 'lrm',
            equipment: weapon('LRM 15', 'MML', 15),
            el: svgEntry('<g><g class="name"><text>LRM 15</text></g><text class="heat">5</text><text class="range_short">7</text></g>')
        });
        const fragBin = entry({ id: 'frag-ammo', equipment: fragAmmo, totalAmmo: 10, consumed: 5, locations: new Set(['LT']) });
        const smokeBin = entry({ id: 'smoke-ammo', equipment: smokeAmmo, totalAmmo: 1, consumed: 0, locations: new Set(['LT']) });
        const emptySmokeBin = entry({ id: 'empty-smoke-ammo', equipment: smokeAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [fragAmmo.internalName]: fragAmmo,
            [smokeAmmo.internalName]: smokeAmmo,
        };
        const { component, dialogsService } = createComponent([lrm, fragBin, smokeBin, emptySmokeBin], equipmentMap, [], new Map(), { tracksHeat: false });
        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        component.selectAmmoOption(row, row.ammo.options[1].id);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.ammoState(row).text).toBe('[LT] LRM 15 Smoke (1/1)');
        component.toggleSelected(row);

        await component.consumeSelectedHeatAndAmmo();

        expect(smokeBin.consumed).toBe(1);
        expect(fragBin.consumed).toBe(5);
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[1].id);
        expect(component.ammoState(row).text).toBe('[LT] LRM 15 Smoke (0/1)');

        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('LRM 15 has no available ammo.', 'No Ammo');
        expect(fragBin.consumed).toBe(5);
    });

    it('starts selected heat projection from existing pending heat', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture, unit, heat } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3, heatNext: 8 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()).toEqual(jasmine.objectContaining({
            current: 8,
            sources: 0,
            selection: 4,
            dissipation: 3,
            final: 9,
            pendingWidth: 40
        }));

        await component.consumeSelectedHeatAndAmmo();

        expect(unit.setHeat).not.toHaveBeenCalled();
        expect(heat.next).toBe(8);
    });

    it('includes current turn heat sources in selected heat projection', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3, heatSources: 5 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()).toEqual(jasmine.objectContaining({
            current: 2,
            sources: 5,
            selection: 4,
            dissipation: 3,
            pending: 11,
            final: 8,
            pendingWidth: 36.666666666666664
        }));
    });

    it('fills projected heat bar when final heat reaches the heat scale cap', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 1, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin], equipmentMap, [], new Map(), { heatDissipation: 3, heatNext: 29 });
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        fixture.detectChanges();

        expect(component.selectedHeatProjection()?.final).toBe(30);
        expect(component.selectedHeatProjection()?.retainedWidth).toBe(100);
    });

    it('blocks heat and ammo consumption when a selected weapon has no ammo', async () => {
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const { component, dialogsService, unit } = createComponent([atm]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        component.toggleSelected(row);
        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('ATM 6 has no available ammo.', 'No Ammo');
        expect(unit.setHeat).not.toHaveBeenCalled();
    });

    it('blocks heat and ammo consumption when a shared selected bin is short', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const first = entry({
            id: 'first-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">4</text><text class="range_short">5</text></g>')
        });
        const second = entry({
            id: 'second-atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><text class="heat">3</text><text class="range_short">5</text></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 5, consumed: 4, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, dialogsService, unit } = createComponent([first, second, ammoBin], equipmentMap);
        const rows = component.groups().find(group => group.id === 'ranged')!.rows;

        component.toggleSelected(rows[0]);
        component.toggleSelected(rows[1]);
        await component.consumeSelectedHeatAndAmmo();

        expect(dialogsService.showError).toHaveBeenCalledWith('ATM 6 Standard (1/5) does not have enough ammo for the selected weapons.', 'Not Enough Ammo');
        expect(ammoBin.consumed).toBe(4);
        expect(unit.setHeat).not.toHaveBeenCalled();
    });

    it('hides the action column when no group has ammo or controls', () => {
        const laser = entry({ id: 'laser', equipment: weapon('laser'), el: svgEntry('<g><g class="name"><text>Laser</text></g></g>') });
        const { component, fixture } = createComponent([laser], {}, [], new Map(), { readOnly: true });

        expect(component.hasAmmoColumn()).toBeFalse();
        expect(component.hasControlsColumn()).toBeFalse();
        expect(component.hasActionsColumn()).toBeFalse();

        fixture.detectChanges();
        const root = fixture.nativeElement.querySelector('.weapons-equipment-panel') as HTMLElement;
        expect(root.classList.contains('hide-actions-column')).toBeTrue();
        expect(fixture.nativeElement.querySelector('.ammo-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.controls-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.actions-header')).toBeNull();
        expect(fixture.nativeElement.querySelector('.ammo-cell')).toBeNull();
        expect(fixture.nativeElement.querySelector('.controls-cell')).toBeNull();
        expect(fixture.nativeElement.querySelector('.actions-cell')).toBeNull();
    });

    it('combines optional ammo and controls into one action column', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin, punch], equipmentMap, [], new Map(), { readOnly: true });
        const rangedGroup = component.groups().find(group => group.id === 'ranged')!;
        const physicalGroup = component.groups().find(group => group.id === 'physical')!;

        expect(component.hasAmmoColumn()).toBeTrue();
        expect(component.hasControlsColumn()).toBeFalse();
        expect(component.hasActionsColumn()).toBeTrue();
        expect(component.groupTracksAmmo(rangedGroup)).toBeTrue();
        expect(component.groupHasControls(rangedGroup)).toBeFalse();
        expect(component.groupHasActions(rangedGroup)).toBeTrue();
        expect(component.groupActionsHeader(rangedGroup)).toBe('Ammo');
        expect(component.groupTracksAmmo(physicalGroup)).toBeFalse();
        expect(component.groupHasControls(physicalGroup)).toBeFalse();
        expect(component.groupHasActions(physicalGroup)).toBeFalse();
        expect(component.groupActionsHeader(physicalGroup)).toBe('');

        fixture.detectChanges();
        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const physicalSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Physical Weapons')!;
        expect(rangedSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Ammo');
        expect(rangedSection.querySelector('.ammo-header')).toBeNull();
        expect(rangedSection.querySelector('.controls-header')).toBeNull();
        expect(physicalSection.querySelector('.actions-header')?.textContent?.trim()).toBe('');
        expect(physicalSection.querySelector('.ammo-header')).toBeNull();
        expect(physicalSection.querySelector('.controls-header')).toBeNull();
        expect(physicalSection.querySelector('.actions-cell')).not.toBeNull();
        expect(physicalSection.querySelector('.actions-cell')?.classList.contains('empty-row-actions')).toBeTrue();
        expect(physicalSection.querySelector('.ammo-cell')).toBeNull();
        expect(rangedSection.querySelector('.name-cell .mode-badge')?.textContent?.trim()).toBe('STD');
    });

    it('labels the combined action column from group contents', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const ammoBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const punch = entry({ id: 'punch', physical: true, el: svgEntry('<g><g class="name"><text>Punch</text></g><text class="range_short">1</text><text class="range_medium">2</text><text class="range_long">3</text></g>') });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, ammoBin, punch], equipmentMap);
        const rangedGroup = component.groups().find(group => group.id === 'ranged')!;
        const physicalGroup = component.groups().find(group => group.id === 'physical')!;

        expect(component.groupActionsHeader(rangedGroup)).toBe('Ammo & Controls');
        expect(component.groupActionsHeader(physicalGroup)).toBe('Controls');

        fixture.detectChanges();
        const sections = Array.from(fixture.nativeElement.querySelectorAll('.weapon-equipment-section')) as HTMLElement[];
        const rangedSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Ranged Weapons')!;
        const physicalSection = sections.find(section => section.querySelector('h3')?.textContent?.trim() === 'Physical Weapons')!;
        expect(rangedSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Ammo & Controls');
        expect(physicalSection.querySelector('.actions-header')?.textContent?.trim()).toBe('Controls');
    });

    it('shows mode-aware ammo totals and marks empty ammo', async () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const erAmmo = ammo('ATM 6 ER', 'ATM', 6, ['M_EXTENDED_RANGE']);
        const heAmmo = ammo('ATM 6 HE', 'ATM', 6, ['M_HIGH_EXPLOSIVE']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry(`
                <g>
                    <g class="name"><text>ATM 6</text></g>
                    <text class="location">RT</text>
                    <g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g>
                    <g class="alternativeMode" mode="Extended Range"><g class="name"><text>Extended Range</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">9</text></g>
                    <g class="alternativeMode" mode="High Explosive"><g class="name"><text>High Explosive</text></g><g class="damage"><text>3/Msl</text></g><text class="range_short">3</text></g>
                </g>
            `)
        });
        const standardBin = entry({ id: 'std-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 2, locations: new Set(['CT']) });
        const erBin = entry({ id: 'er-ammo', equipment: erAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const destroyedHeBin = entry({ id: 'he-ammo', equipment: heAmmo, totalAmmo: 10, consumed: 0, destroyed: true });
        const equipmentMap: EquipmentMap = {
            [standardAmmo.internalName]: standardAmmo,
            [erAmmo.internalName]: erAmmo,
            [heAmmo.internalName]: heAmmo,
        };
        const { component, fixture } = createComponent([atm, standardBin, erBin, destroyedHeBin], equipmentMap);

        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.selectedMode).toBe('Standard');
        expect(component.modeChoice(row)?.choices?.map(choice => choice.label)).toEqual(['STD', 'ER', 'HE']);
        expect(component.ammoState(row).text).toBe('ATM 6 Standard (8/10)');
        expect(component.ammoState(row).depleted).toBeFalse();
        expect(row.ammo.options.map(option => option.label)).toEqual(['ATM 6 Standard (8/10)']);
        fixture.detectChanges();
        const inlineMode = fixture.nativeElement.querySelector('.name-cell .mode-choice') as HTMLElement;
        expect(inlineMode.textContent?.trim()).toContain('STD');

        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'Extended Range', label: 'ER' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.tracksAmmo).toBeTrue();
        expect(component.ammoState(row).hasAmmo).toBeFalse();
        expect(component.ammoState(row).text).toBe('');
        expect(component.ammoState(row).depleted).toBeTrue();
        component.selectAmmoOption(row, row.ammo.options[0].id);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);

        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'High Explosive', label: 'HE' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        expect(row.tracksAmmo).toBeTrue();
        expect(component.ammoState(row).hasAmmo).toBeFalse();
        expect(component.ammoState(row).text).toBe('');
        expect(component.ammoState(row).depleted).toBeTrue();
        expect(component.ammoState(row).destroyed).toBeFalse();
    });

    it('uses a flat dropdown only when multiple compatible ammo sources exist', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 1, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 5, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => option.label)).toEqual([
            '[LT] ATM 6 Standard (9/10)',
            '[RT] ATM 6 Standard (5/10)'
        ]);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[0].id);
        expect(component.ammoState(row).text).toBe('[LT] ATM 6 Standard (9/10)');
    });

    it('shows No ammo only when a weapon has no ammo choices', () => {
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const { component, fixture } = createComponent([atm]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options).toEqual([]);
        expect(row.tracksAmmo).toBeTrue();
        expect(component.ammoState(row).hasAmmo).toBeFalse();
        expect(component.ammoState(row).depleted).toBeTrue();
        expect(component.ammoState(row).text).toBe('');
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
    });

    it('shows No ammo instead of a dropdown when all ammo choices are depleted', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ remaining: option.remaining, destroyed: option.destroyed }))).toEqual([
            { remaining: 0, destroyed: false },
            { remaining: 0, destroyed: false }
        ]);
        expect(component.ammoState(row).showDropdown).toBeFalse();
        expect(row.tracksAmmo).toBeTrue();
        expect(component.ammoState(row).hasAmmo).toBeFalse();
        expect(component.ammoState(row).text).toBe('');
        expect(component.ammoState(row).depleted).toBeTrue();
        expect(component.ammoState(row).destroyed).toBeFalse();
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
    });

    it('shows No ammo instead of a dropdown when all ammo choices are destroyed', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const leftBin = entry({ id: 'left-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['LT']) });
        const rightBin = entry({ id: 'right-ammo', equipment: standardAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component, fixture } = createComponent([atm, leftBin, rightBin], equipmentMap);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ remaining: option.remaining, destroyed: option.destroyed }))).toEqual([
            { remaining: 0, destroyed: true },
            { remaining: 0, destroyed: true }
        ]);
        expect(component.ammoState(row).showDropdown).toBeFalse();
        expect(row.tracksAmmo).toBeTrue();
        expect(component.ammoState(row).hasAmmo).toBeFalse();
        expect(component.ammoState(row).text).toBe('');
        expect(component.ammoState(row).depleted).toBeTrue();
        expect(component.ammoState(row).destroyed).toBeFalse();
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.ammo-cell') as HTMLElement).textContent?.trim()).toBe('NO AMMO');
        expect(fixture.nativeElement.querySelectorAll('.ammo-stepper-button').length).toBe(0);
    });

    it('groups same-location ammo bins', () => {
        const lrmAmmo = ammo('MML 9/LRM Artemis', 'MML', 9, [], ['F_MML_LRM']);
        const srmAmmo = ammo('MML 9/SRM Artemis', 'MML', 9, [], ['F_MML_SRM']);
        const mml = entry({
            id: 'mml',
            equipment: weapon('MML 9', 'MML', 9),
            el: svgEntry('<g><g class="name"><text>MML 9</text></g><g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">7</text></g></g>')
        });
        const fullBin = entry({ id: 'full-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 0, locations: new Set(['RT']) });
        const partialBin = entry({ id: 'partial-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 3, locations: new Set(['RT']) });
        const srmBin = entry({ id: 'srm', equipment: srmAmmo, totalAmmo: 11, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [lrmAmmo.internalName]: lrmAmmo,
            [srmAmmo.internalName]: srmAmmo,
        };
        const created = createComponent([mml, fullBin, partialBin, srmBin], equipmentMap);
        const row = created.component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => option.label)).toEqual(['MML 9/LRM Artemis (23/26)']);
        expect(created.component.ammoState(row).text).toBe('MML 9/LRM Artemis (23/26)');
    });

    it('counts destroyed ammo bins as empty inside grouped ammo', () => {
        const lrmAmmo = ammo('MML 9/LRM Artemis', 'MML', 9, [], ['F_MML_LRM']);
        const srmAmmo = ammo('MML 9/SRM Artemis', 'MML', 9, [], ['F_MML_SRM']);
        const mml = entry({
            id: 'mml',
            equipment: weapon('MML 9', 'MML', 9),
            el: svgEntry('<g><g class="name"><text>MML 9</text></g><g class="alternativeMode" mode="LRM"><g class="name"><text>LRM</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">7</text></g></g>')
        });
        const fullBin = entry({ id: 'full-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 0, locations: new Set(['RT']) });
        const srmBin = entry({ id: 'srm', equipment: srmAmmo, totalAmmo: 11, consumed: 0, locations: new Set(['RT']) });
        const equipmentMap: EquipmentMap = {
            [lrmAmmo.internalName]: lrmAmmo,
            [srmAmmo.internalName]: srmAmmo,
        };

        const destroyedBin = entry({ id: 'destroyed-lrm', equipment: lrmAmmo, totalAmmo: 13, consumed: 3, destroyed: true, locations: new Set(['RT']) });
        const created = createComponent([mml, fullBin, destroyedBin, srmBin], equipmentMap);
        const row = created.component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ label: option.label, destroyed: option.destroyed, disabled: option.disabled }))).toEqual([
            { label: 'MML 9/LRM Artemis (13/26)', destroyed: false, disabled: false }
        ]);
        expect(created.component.ammoState(row).text).toBe('MML 9/LRM Artemis (13/26)');
        expect(created.component.ammoState(row).destroyed).toBeFalse();
    });

    it('prefers a non-destroyed non-empty ammo bin when mode changes', async () => {
        const erAmmo = ammo('ATM 6 ER', 'ATM', 6, ['M_EXTENDED_RANGE']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry(`
                <g>
                    <g class="name"><text>ATM 6</text></g>
                    <g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g>
                    <g class="alternativeMode" mode="Extended Range"><g class="name"><text>Extended Range</text></g><g class="damage"><text>1/Msl</text></g><text class="range_short">9</text></g>
                </g>
            `)
        });
        const destroyedBin = entry({ id: 'destroyed-er', equipment: erAmmo, totalAmmo: 10, consumed: 0, destroyed: true, locations: new Set(['LT']) });
        const emptyBin = entry({ id: 'empty-er', equipment: erAmmo, totalAmmo: 10, consumed: 10, locations: new Set(['RT']) });
        const liveBin = entry({ id: 'live-er', equipment: erAmmo, totalAmmo: 10, consumed: 4, locations: new Set(['CT']) });
        const equipmentMap: EquipmentMap = { [erAmmo.internalName]: erAmmo };
        const { component } = createComponent([atm, destroyedBin, emptyBin, liveBin], equipmentMap);

        let row = component.groups().find(group => group.id === 'ranged')!.rows[0];
        await component.handleChoice(row, { ...component.modeChoice(row)!, value: 'Extended Range', label: 'ER' });
        row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(row.ammo.options.map(option => ({ label: option.label, disabled: option.disabled, destroyed: option.destroyed }))).toEqual([
            { label: '[LT] ATM 6 ER (0/10)', disabled: true, destroyed: true },
            { label: '[RT] ATM 6 ER (0/10)', disabled: false, destroyed: false },
            { label: '[CT] ATM 6 ER (6/10)', disabled: false, destroyed: false },
        ]);
        expect(component.ammoState(row).selectedOptionId).toBe(row.ammo.options[2].id);
        expect(component.ammoState(row).text).toBe('[CT] ATM 6 ER (6/10)');
        expect(component.ammoState(row).destroyed).toBeFalse();
    });

    it('includes ammo location labels for units with critical slots', () => {
        const standardAmmo = ammo('ATM 6 Standard', 'ATM', 6, ['M_STANDARD']);
        const atm = entry({
            id: 'atm',
            equipment: weapon('ATM 6', 'ATM', 6),
            el: svgEntry('<g><g class="name"><text>ATM 6</text></g><g class="alternativeMode" mode="Standard"><g class="name"><text>Standard</text></g><g class="damage"><text>2/Msl</text></g><text class="range_short">5</text></g></g>')
        });
        const critSlot = {
            loc: 'CT',
            slot: 0,
            id: standardAmmo.internalName,
            name: standardAmmo.internalName,
            eq: standardAmmo,
            totalAmmo: 20,
            consumed: 10
        } as CriticalSlot;
        const equipmentMap: EquipmentMap = { [standardAmmo.internalName]: standardAmmo };
        const { component } = createComponent([atm], equipmentMap, [critSlot]);
        const row = component.groups().find(group => group.id === 'ranged')!.rows[0];

        expect(component.ammoState(row).text).toBe('ATM 6 Standard (10/20)');
    });
});