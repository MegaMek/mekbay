// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { getConstructionMassCapacity } from './construction-factory';
import { constructionMaterialSlotCount } from './construction-rules';
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { AeroEntity } from '../../models/entity/entities/aero/aero-entity';
import { calculateEntityWeightBreakdown } from '../../models/entity/utils/weight/entity-weight';
import { calculateMekEquipmentWeightDetails } from '../../models/entity/utils/weight/mek-weight';
import { calculateCompositeTechRating, getTechIntroductionYear, type TechRatingSource } from '../../models/entity/types/tech';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import { ArmorEquipment, StructureEquipment, WeaponEquipment, AmmoEquipment } from '../../models/equipment.model';
import { isHeatSinkEquipment } from '../../models/heat-equipment.model';
import { isJumpJetEquipment, isUmuEquipment, isAnyJumpBoosterEquipment } from '../../models/jump-equipment.model';
import { getStructureTechAdvancement } from '../../models/entity/components/structure';

export interface ConstructionSummaryRow {
    readonly key: string;
    readonly label: string;
    readonly weight: number | null;
    readonly criticals: number | null;
    readonly availability: string;
}

const LABELS: Readonly<Record<string, string>> = {
    structure: 'Internal structure', engine: 'Engine', cockpit: 'Cockpit', gyro: 'Gyro',
    heatSinks: 'Heat sinks', armor: 'Armor', jump: 'Jump jets / UMUs', enhancements: 'Enhancements',
    equipment: 'Equipment', miscellaneous: 'Miscellaneous equipment', ammo: 'Ammunition',
    carryingSpace: 'Transport space', conversion: 'Conversion equipment', powerAmplifiers: 'Power amplifiers',
    capitalControls: 'Capital weapon controls and stabilizers',
    elevators: 'Elevator mechanisms',
    armoredComponents: 'Armored components', jumpDrive: 'K-F drive', lithiumFusionBattery: 'Lithium-fusion battery',
};

/** MML SummaryView: each row uses the same construction mass and technology sources as the design. */
export function constructionSummary(entity: BaseEntity) {
    const breakdown = calculateEntityWeightBreakdown(entity);
    const mounts = entity.equipment();
    const group = (mount: EntityMountedEquipment): string => {
        const eq = mount.equipment;
        if (eq instanceof ArmorEquipment) return 'armor';
        if (eq instanceof StructureEquipment) return 'structure';
        if (isHeatSinkEquipment(eq)) return 'heatSinks';
        if (isJumpJetEquipment(eq) || isUmuEquipment(eq) || isAnyJumpBoosterEquipment(eq)) return 'jump';
        if (eq?.hasFlag('F_TSM') || eq?.hasFlag('F_INDUSTRIAL_TSM') || eq?.hasFlag('F_MASC') || eq?.hasFlag('F_SCM')) return 'enhancements';
        if (entity instanceof MekEntity) return 'equipment';
        return eq instanceof WeaponEquipment ? 'weapons' : eq instanceof AmmoEquipment ? 'ammo' : 'miscellaneous';
    };
    const technologies = new Map<string, TechRatingSource[]>();
    const setTech = (key: string, sources: readonly TechRatingSource[]) => technologies.set(key, [...sources]);
    for (const mount of mounts) {
        if (!mount.equipment) continue;
        const key = group(mount);
        technologies.set(key, [...technologies.get(key) ?? [], mount.equipment.tech]);
    }
    setTech('structure', [...entity.structureByLocation().values()].map(value => getStructureTechAdvancement(value.structure)));
    setTech('armor', [...entity.armorByLocation().values()].map(value => value.armor.tech));
    if (entity.mountedEngine().installed) setTech('engine', [entity.mountedEngine().getTechAdvancement({ supportVee: entity.isSupportVehicle() })]);
    if (entity instanceof MekEntity) {
        setTech('cockpit', [entity.mountedCockpit().tech]);
        setTech('gyro', [entity.mountedGyro().tech]);
        const sink = entity.heatSinkEquipment();
        if (sink) setTech('heatSinks', [sink.tech]);
    } else if (entity instanceof AeroEntity) setTech('controls', [entity.mountedCockpitTech()]);

    const mass = new Map<string, number>();
    for (const [key, value] of Object.entries(breakdown)) {
        if (key === 'exact' || key === 'rounded') continue;
        if (typeof value === 'number') mass.set(key, value);
        if (key === 'suits' && Array.isArray(value)) for (const suit of value) {
            for (const [part, weight] of Object.entries(suit)) {
                if (part !== 'trooper' && part !== 'exact' && typeof weight === 'number') mass.set(part, (mass.get(part) ?? 0) + weight);
            }
        }
    }
    if (entity instanceof MekEntity) {
        // Jump systems and myomer enhancements are already in the equipment subtotal.
        for (const key of ['jump', 'enhancements']) {
            const weight = calculateMekEquipmentWeightDetails(entity).filter(row => group(row.mount) === key).reduce((sum, row) => sum + row.tonnage, 0);
            mass.set(key, weight);
            mass.set('equipment', (mass.get('equipment') ?? 0) - weight);
        }
    }
    const crits = (key: string): number | null => {
        if (!(entity instanceof MekEntity)) return null;
        if (key === 'engine') return entity.mountedEngine().getCTSlots(entity.gyroType()).length + 2 * entity.mountedEngine().getSideTorsoSlots().length;
        if (key === 'gyro') return entity.mountedGyro().criticalSlots;
        if (key === 'cockpit') return [...entity.criticalSlotGrid().values()].flat().filter(slot => slot.type === 'system' && slot.systemType === 'Cockpit').length;
        const equipment = mounts.filter(mount => group(mount) === key);
        if (key === 'structure' || key === 'armor') {
            const materials = key === 'structure' ? [...entity.structureByLocation().values()].map(m => m.structure) : [...entity.armorByLocation().values()].map(m => m.armor);
            return [...new Set<ArmorEquipment | StructureEquipment>(materials)].reduce((sum, eq) => sum + constructionMaterialSlotCount(entity, eq), 0);
        }
        return equipment.reduce((sum, mount) => sum + (mount.allocation.kind === 'engine' ? 0 : mount.getNumCriticalSlots(entity) ?? 0), 0);
    };
    const order = ['structure', 'engine', 'gyro', 'cockpit', 'controls', 'heatSinks', 'armor', 'jump', 'enhancements', 'equipment'];
    const rows: ConstructionSummaryRow[] = [...mass].filter(([key, weight]) => order.includes(key) || weight !== 0).sort(([a], [b]) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    }).map(([key, weight]) => ({
        key, label: LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()), weight,
        criticals: crits(key),
        availability: technologies.get(key)?.length ? calculateCompositeTechRating(technologies.get(key)!, { techBase: entity.techBase() }) : '—',
    }));
    const chassisTech = entity.entityTechAdvancements();
    rows.unshift({ key: 'unitType', label: 'Unit type', weight: null, criticals: null,
        availability: chassisTech.length ? calculateCompositeTechRating(chassisTech, { techBase: entity.techBase() }) : '—' });
    const allTech = entity.techRatingSources();
    const earliestYears = allTech.flatMap(source => {
        const dates = source.dates ?? source.advancement;
        if (!dates) return [];
        const bases = entity.mixedTech() ? ['IS', 'Clan'] as const : [entity.techBase()];
        const years = bases.map(techBase => getTechIntroductionYear({ dates, level: source.level ?? 'Standard' }, { techBase }))
            .filter((year): year is number => year !== undefined);
        return years.length ? [Math.min(...years)] : [];
    });
    const rounding = breakdown.rounded - breakdown.exact;
    if (Math.abs(rounding) > 0.000001) rows.push({ key: 'rounding', label: 'Rounding', weight: rounding, criticals: null, availability: '—' });
    return {
        rows, total: breakdown.rounded, free: getConstructionMassCapacity(entity) - breakdown.rounded,
        earliestYear: earliestYears.length ? Math.max(...earliestYears) : null,
        showCriticals: entity instanceof MekEntity,
    };
}
