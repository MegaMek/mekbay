import type { Unit } from '../models/units.model';
import { CBTInventoryControlRuntime } from '../models/cbt-inventory-control-runtime.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { AmmoEquipment, Equipment, EquipmentMap } from '../models/equipment.model';
import type { InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../models/inventory-control-runtime-state.model';
import { type MountedEquipmentInit, MountedEquipment  } from '../models/mounted-equipment.model';
import { type CriticalSlot, type HeatProfile } from '../models/force-serialization';
import { getMotiveModeLabel, type MotiveModes } from '../models/motiveModes.model';
import { CORE_2026_GAME_RULES, type CBTGameRules, type ToHitAdjustment } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE, type UnitModifierBreakdownEntry } from '../models/rules/unit-type-rules';
import type { InventoryControlDisplayData, InventoryControlRules } from '../utils/inventory-control.util';

type TestAlphaStrikeOverrides = Partial<Omit<Unit['as'], 'dmg'>> & {
    dmg?: Partial<Unit['as']['dmg']>;
};

export type TestUnitOverrides = Partial<Omit<Unit, 'as'>> & {
    as?: TestAlphaStrikeOverrides;
};

function createEmptyAlphaStrikeStats(overrides: TestAlphaStrikeOverrides = {}): Unit['as'] {
    const base: Unit['as'] = {
        TP: 'BM',
        PV: 0,
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
    };

    return {
        ...base,
        ...overrides,
        MVm: overrides.MVm ? { ...overrides.MVm } : base.MVm,
        specials: overrides.specials ? [...overrides.specials] : base.specials,
        dmg: {
            ...base.dmg,
            ...overrides.dmg,
        },
    };
}

export function createEmptyUnit(overrides: TestUnitOverrides = {}): Unit {
    const { as: asOverrides, ...unitOverrides } = overrides;
    const unit: Unit = {
        name: 'Test Unit',
        id: -1,
        chassis: 'Test',
        model: 'TST-1',
        year: 3151,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 'Introductory',
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
        published: [],
        canon: true,
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
        as: createEmptyAlphaStrikeStats(asOverrides),
        _searchKey: '',
        _displayType: '',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...unitOverrides,
    };

    unit.source = unitOverrides.source ? [...unitOverrides.source] : [];
    unit.published = unitOverrides.published ? [...unitOverrides.published] : [];
    unit.comp = unitOverrides.comp ? [...unitOverrides.comp] : [];
    unit.quirks = unitOverrides.quirks ? [...unitOverrides.quirks] : [];
    unit.features = unitOverrides.features ? [...unitOverrides.features] : [];
    unit.sheets = unitOverrides.sheets ? [...unitOverrides.sheets] : [];
    unit._nameTags = unitOverrides._nameTags ? [...unitOverrides._nameTags] : [];
    unit._chassisTags = unitOverrides._chassisTags ? [...unitOverrides._chassisTags] : [];

    return unit;
}

export interface CBTForceUnitTestEntryState {
    isDamaged: boolean;
    isDisabled: boolean;
    hitMod: number;
    weakenedHitMod?: boolean;
}

export interface CBTForceUnitTestHarnessOptions {
    id?: string;
    unit?: TestUnitOverrides;
    gameRules?: CBTGameRules;
    components?: readonly MountedEquipment[];
    criticalSlots?: readonly CriticalSlot[];
    equipment?: EquipmentMap;
    entryStates?: ReadonlyMap<MountedEquipment, CBTForceUnitTestEntryState>;
    heat?: Partial<HeatProfile>;
    tracksHeat?: boolean;
    heatDissipation?: number;
    heatSources?: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
    moveMode?: MotiveModes | null;
    attackModifierBreakdown?: UnitModifierBreakdownEntry[];
    attackMovementCanAffectTargetNumbers?: boolean;
    hasLinkedC3Network?: boolean;
    readOnly?: boolean;
    hasDirectInventory?: boolean;
    computeEntryState?: (entry: MountedEquipment) => CBTForceUnitTestEntryState;
    isEquipmentUnavailable?: (source: MountedEquipment | CriticalSlot, location?: string) => boolean;
    applyInventoryControlDisplayEffects?: (entry: MountedEquipment, display: InventoryControlDisplayData) => InventoryControlDisplayData;
}

export interface CBTForceUnitTestTurnState {
    moveMode(): MotiveModes | null;
    airborne(): boolean;
    getAttackMovementModifier(): number;
    getAttackModifierBreakdown(): UnitModifierBreakdownEntry[];
    missingAttackMovementModifier(): boolean;
    getSpottingModifier(): number;
    heatSources(): Array<{ id: string; label: string; value: number }>;
    addFiredHeat(amount: number): void;
}

export class CBTForceUnitTestHarness {
    readonly components: MountedEquipment[] = [];
    readonly criticalSlots: CriticalSlot[] = [];
    readonly equipment: EquipmentMap;
    readonly entryStates: Map<MountedEquipment, CBTForceUnitTestEntryState>;
    readonly heat: HeatProfile;
    readonly turnState: CBTForceUnitTestTurnState;
    readonly unit: CBTForceUnit;
    readonly runtime: CBTInventoryControlRuntime;

    private inventoryControlRules: InventoryControlRules = {};
    private toHitAdjustments: (
        entry: MountedEquipment,
        selectedAmmo?: AmmoEquipment | null
    ) => readonly ToHitAdjustment[] = () => [];

    constructor(readonly options: CBTForceUnitTestHarnessOptions = {}) {
        this.equipment = { ...options.equipment };
        this.entryStates = new Map(options.entryStates);
        this.heat = {
            current: options.heat?.current ?? 2,
            previous: options.heat?.previous ?? 1,
            next: options.heat?.next
        };

        const baseUnit = createEmptyUnit({ id: -1, name: options.id ?? 'Test Unit', ...options.unit });
        const attackMovementModifier = (): number => {
            switch (options.moveMode ?? null) {
                case 'walk': return 1;
                case 'run': return 2;
                case 'jump': return 3;
                default: return 0;
            }
        };
        this.turnState = {
            moveMode: () => options.moveMode ?? null,
            airborne: () => false,
            getAttackMovementModifier: attackMovementModifier,
            getAttackModifierBreakdown: () => options.attackModifierBreakdown ?? (attackMovementModifier() !== 0
                ? [{ label: getMotiveModeLabel(options.moveMode!, baseUnit, false), modifier: attackMovementModifier() }]
                : []),
            missingAttackMovementModifier: () => (options.moveMode ?? null) === null && (options.attackMovementCanAffectTargetNumbers ?? true),
            getSpottingModifier: () => 0,
            heatSources: () => options.heatSources ? [{ id: 'test-source', label: 'Test Source', value: options.heatSources }] : [],
            addFiredHeat: () => undefined
        };

        const rules = {
            computeAllEntryStates: () => this.entryStates,
            computeEntryState: (entry: MountedEquipment) => this.entryStates.get(entry)
                ?? options.computeEntryState?.(entry)
                ?? defaultEntryState(entry),
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
            },
            getTargetNumberGunnerySkill: () => options.gunnerySkill ?? 4,
            getTargetNumberPilotingSkill: () => options.pilotingSkill ?? 5,
            getTargetNumberGunneryModifierBreakdown: () => [],
            getTargetNumberPilotingModifierBreakdown: () => [],
            applyInventoryControlDisplayEffects: (entry: MountedEquipment, display: InventoryControlDisplayData) =>
                options.applyInventoryControlDisplayEffects?.(entry, display) ?? display
        };

        this.unit = {
            id: options.id,
            gameRules: options.gameRules ?? CORE_2026_GAME_RULES,
            getInventory: () => this.components,
            getCritSlots: () => this.criticalSlots,
            getAvailableEquipment: () => this.equipment,
            getUnit: () => baseUnit,
            getHeat: () => this.heat,
            setHeat: (value: number) => this.heat.next = value,
            gunnerySkill: () => options.gunnerySkill ?? 4,
            pilotingSkill: () => options.pilotingSkill ?? 5,
            turnState: () => this.turnState,
            svgService: { inventoryTargetHeatFireModifier: () => 0 },
            hasLinkedC3Network: () => options.hasLinkedC3Network ?? false,
            readOnly: () => options.readOnly ?? false,
            hasDirectInventory: () => options.hasDirectInventory ?? true,
            setInventoryEntry: (entry: MountedEquipment) => {
                this.addComponent(entry);
                this.runtime.markInventoryViewChanged();
            },
            setCritSlot: () => undefined,
            isEquipmentUnavailable: options.isEquipmentUnavailable ?? defaultEquipmentUnavailable,
            getInventoryControlRules: () => this.inventoryControlRules,
            rules
        } as unknown as CBTForceUnit;

        this.runtime = installInventoryControlRuntime(this.unit);
        options.components?.forEach(component => this.addComponent(component));
        options.criticalSlots?.forEach(slot => this.addCriticalSlot(slot));
    }

    addComponent(component: MountedEquipment | Omit<MountedEquipmentInit, 'owner'>): MountedEquipment {
        const mounted = component instanceof MountedEquipment
            ? component
            : MountedEquipment.from({ ...component, owner: this.unit });
        mounted.owner = this.unit;
        const existingIndex = this.components.findIndex(candidate => candidate.id === mounted.id);
        if (existingIndex === -1) {
            this.components.push(mounted);
        } else {
            this.components[existingIndex] = mounted;
        }
        if (mounted.equipment) this.addEquipment(mounted.equipment);
        return mounted;
    }

    addCriticalSlot(slot: CriticalSlot): CriticalSlot {
        const existingIndex = this.criticalSlots.findIndex(candidate => candidate === slot
            || (candidate.loc === slot.loc && candidate.slot === slot.slot));
        if (existingIndex === -1) {
            this.criticalSlots.push(slot);
        } else {
            this.criticalSlots[existingIndex] = slot;
        }
        if (slot.eq) this.addEquipment(slot.eq);
        return slot;
    }

    addEquipment(equipment: Equipment): Equipment {
        this.equipment[equipment.internalName] = equipment;
        return equipment;
    }

    setEntryState(entry: MountedEquipment, state: CBTForceUnitTestEntryState): this {
        this.entryStates.set(entry, state);
        return this;
    }

    setInventoryControlRules(rules: InventoryControlRules): this {
        this.inventoryControlRules = rules;
        return this;
    }

    setToHitAdjustments(
        resolver: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => readonly ToHitAdjustment[]
    ): this {
        this.toHitAdjustments = resolver;
        this.inventoryControlRules = {
            ...this.inventoryControlRules,
            resolveToHitAdjustments: (entry, selectedAmmo) => this.toHitAdjustments(entry, selectedAmmo)
        };
        return this;
    }
}

export function createCBTForceUnitTestHarness(options: CBTForceUnitTestHarnessOptions = {}): CBTForceUnitTestHarness {
    return new CBTForceUnitTestHarness(options);
}

function defaultEntryState(entry: MountedEquipment): CBTForceUnitTestEntryState {
    return {
        isDamaged: entry.committedDestroyed(),
        isDisabled: entry.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE,
        hitMod: 0
    };
}

function defaultEquipmentUnavailable(source: MountedEquipment | CriticalSlot): boolean {
    if (source instanceof MountedEquipment) {
        return source.committedDestroyed() || !!source.critSlots?.some(slot => !!slot.destroyed);
    }
    return !!source.destroyed;
}

function installInventoryControlRuntime(unit: CBTForceUnit): CBTInventoryControlRuntime {
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
        setInventoryControlEntryRange: (entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null) => runtime.setEntryRange(entry, range),
        toggleInventoryControlEntryRange: (entry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false) => runtime.toggleEntryRange(entry, range, forceSelected),
        setInventoryControlEntryAmmoOption: (entryId: string, optionId: string) => runtime.setEntryAmmoOption(entryId, optionId),
        setInventoryControlEntryTarget: (entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null) => runtime.setEntryTarget(entry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>) => runtime.updateTarget(targetId, patch),
        deleteInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.deleteTarget(targetId),
        resetInventoryControlTargets: () => runtime.resetTargets(),
        clearInventoryControlSelection: () => runtime.clearSelection(),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    return runtime;
}