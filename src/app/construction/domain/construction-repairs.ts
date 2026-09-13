// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { hasMekRuntime, hasNonMekRuntime, type CBTUnitSnapshot } from '../../models/cbt-unit-snapshot';
import { CrewMember } from '../../models/crew-member.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import type { ArmorFaceId, ComponentId, LocationId } from '../../models/entity/entity-identifiers';
import { isVehicleEntity } from '../../models/entity/utils/entity-type-guards';
import { AmmoEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { ConstructionRuntimeCommand } from '../../models/runtime/construction-runtime';
import { entityAmmoLoadout, mekAmmoLoadout } from '../../models/runtime/mek-ammo';
import type { CBTUnitCommand } from '../../models/runtime/unit-command';

export interface ConstructionRepairQuote {
    readonly cost: number | null;
    readonly basis: string;
    readonly spCost: number | null;
    readonly spBasis: string;
}

/** Campaign Operations, p. 144, simplified repairs. Tactical rules do not set campaign prices. */
export function constructionRepairQuote(source: CBTUnitSnapshot, componentId?: ComponentId): ConstructionRepairQuote {
    const sp = supportPointQuote(source, componentId ? constructionComponentHasRepairDamage(source, componentId) : constructionHasRepairDamage(source),
        componentId ? 0 : crewHealingSP(source), componentId ? 0 : rearmingSP(source));
    return { ...repairCBillQuote(source, componentId), ...sp };
}

function repairCBillQuote(source: CBTUnitSnapshot, componentId?: ComponentId, includeCrew = true): Pick<ConstructionRepairQuote, 'cost' | 'basis'> {
    const basis = 'Campaign Operations, p. 144 · simplified repairs';
    if (!hasMekRuntime(source)) return { cost: null, basis: 'Repair pricing is not defined for this unit family.' };
    let baseCost: number;
    try { baseCost = source.entity.cost(); }
    catch { return { cost: null, basis: 'The unit C-Bill cost is unavailable for repair pricing.' }; }
    if (componentId) {
        const component = source.index.components.get(componentId);
        if (!component) return { cost: null, basis };
        const state = source.state.components.get(componentId);
        const shield = source.state.pendingCombat.shieldDamage.get(componentId);
        if (state?.jammed || state?.escalatingFailure?.active
            || (state?.shieldDamage?.absorptionDamage ?? 0) + (shield?.absorptionDamage ?? 0) > 0
            || (state?.shieldDamage?.capacityDamage ?? 0) + (shield?.capacityDamage ?? 0) > 0) {
            return { cost: null, basis: 'The simplified repair table does not price this kind of component damage.' };
        }
        const hits = componentHits(source, componentId);
        // Status-only damage has no authored critical-hit count to price.
        if (!hits && source.query.componentStatus(componentId, 'preview') !== 'available') return { cost: null, basis };
        const rate = component.kind === 'system'
            ? /Engine|Gyro/.test(component.systemType) ? baseCost * .05
                : /Actuator|Shoulder|Hip/.test(component.systemType) ? baseCost * .03 : 5000
            : component.mount.equipment instanceof WeaponEquipment ? 20000 : 5000;
        return { cost: Math.round(rate * hits), basis: `${basis} · spot critical repairs` };
    }
    const destroyed = destroyedInPreview(source);
    const crippled = source.query.hasCondition('crippled');
    const internal = hasInternalDamage(source);
    const critical = [...source.index.slots.values()].some(slot => (source.state.slots.get(slot.id)?.hits ?? 0)
        + (source.state.pendingCombat.criticalHits.get(slot.id) ?? 0) > 0);
    const damagedEquipment = [...source.index.components.keys()].some(id => componentHasCriticalDamage(source, id));
    const crew = includeCrew ? [...source.index.crewPositions.keys()].map(id => source.query.crewState(id)) : [];
    const rate = destroyed ? .4 : crippled ? .3 : internal || critical || damagedEquipment ? .2 : 0;
    const ejection = !destroyed && !crippled && crew.some(member => member.ejected) ? baseCost * .05 : 0;
    return { cost: Math.round(baseCost * rate + ejection + crew.reduce((sum, member) => sum + member.wounds * 50000, 0)),
        basis: `${basis} · ${rate * 100}% of base unit cost; armor and ammunition reloads free; crew healing 50,000 C-Bills per wound` };
}

/** Actual repairs come from the detached runtime result; duplicate or undone commands cost nothing. */
export function constructionPendingRepairQuote(
    source: CBTUnitSnapshot, preview: CBTUnitSnapshot, commands: readonly ConstructionRuntimeCommand[],
): ConstructionRepairQuote | null {
    const all = commands.some(command => command.type === 'repair-all');
    const componentIds = new Set<ComponentId>();
    for (const command of commands) {
        if (command.type === 'repair-critical' && hasMekRuntime(source)) {
            for (const id of source.index.slots.get(command.slotId)?.componentIds ?? []) componentIds.add(id);
        } else if (command.type === 'repair-shield'
            || command.type === 'set-component-status' && command.status === 'available'
            || command.type === 'set-component-jammed' && !command.jammed
            || command.type === 'edit-escalating-failure' && command.edit.kind === 'set-status' && command.edit.status === 'available') {
            componentIds.add(command.componentId);
        }
    }
    const repairedComponents = [...(all ? source.index.components.keys() : componentIds)]
        .filter(id => componentImproved(source, preview, id));
    const armor = [...source.index.armorFaces.keys()].some(id =>
        preview.query.remainingArmor(id, 'preview') > source.query.remainingArmor(id, 'preview'));
    const internal = [...source.index.locations.keys()].some(id =>
        preview.query.remainingInternal(id, 'preview') > source.query.remainingInternal(id, 'preview'));
    const tracks = hasNonMekRuntime(source) && hasNonMekRuntime(preview)
        && [...source.index.damageTracks.keys()].some(id =>
            (source.state.damageTracks.get(id)?.hits ?? 0) + (source.state.pendingCombat.damageTrackHits.get(id)?.hitDelta ?? 0)
                > (preview.state.damageTracks.get(id)?.hits ?? 0) + (preview.state.pendingCombat.damageTrackHits.get(id)?.hitDelta ?? 0));
    const repaired = armor || internal || tracks || repairedComponents.length > 0
        || destroyedInPreview(source) && !destroyedInPreview(preview);
    const ejection = [...source.index.crewPositions.keys()].some(id => source.query.crewState(id).ejected && !preview.query.crewState(id).ejected);
    const healing = crewHealingSP(source, preview), rearming = rearmingSP(source, preview);
    if (!repaired && !ejection && healing === 0 && rearming === 0) return null;
    const sp = supportPointQuote(source, repaired, healing, rearming);
    if (all || internal || tracks || !hasMekRuntime(source)) return { ...repairCBillQuote(source, undefined, all), ...sp };
    const quotes = repairedComponents.map(id => {
        const before = repairCBillQuote(source, id), after = repairCBillQuote(preview, id);
        return { ...before, cost: before.cost === null || after.cost === null ? null : Math.max(0, before.cost - after.cost) };
    });
    return { cost: quotes.some(quote => quote.cost === null) ? null
        : quotes.reduce((sum, quote) => sum + quote.cost!, 0),
        basis: quotes.find(quote => quote.cost === null)?.basis
            ?? 'Campaign Operations, p. 144 · spot critical repairs; armor and ammunition reloads free', ...sp };
}

/** Physical damage only: ammunition use and crew injuries do not change the Omni chassis. */
export function constructionHasRepairDamage(source: CBTUnitSnapshot): boolean {
    return destroyedInPreview(source) || hasInternalDamage(source)
        || [...source.index.armorFaces.values()].some(face => source.query.remainingArmor(face.id, 'preview') < face.maximumPoints)
        || [...source.index.components.keys()].some(id => constructionComponentHasRepairDamage(source, id))
        || hasNonMekRuntime(source) && [...source.index.damageTracks.keys()].some(id =>
            (source.state.damageTracks.get(id)?.hits ?? 0) + (source.state.pendingCombat.damageTrackHits.get(id)?.hitDelta ?? 0) > 0);
}

/** Replacing a design is explicit and requires repaired committed and pending state. */
export function constructionCanUpdateDesign(source: CBTUnitSnapshot): boolean {
    return !constructionHasRepairDamage(source)
        && [...source.index.armorFaces.values()].every(face => source.query.remainingArmor(face.id) >= face.maximumPoints)
        && [...source.index.locations.values()].every(location => source.query.remainingInternal(location.id) >= location.internalPoints)
        && [...source.state.crew.values()].every(crew => CrewMember.from(crew).isPristine())
        && !source.query.hasPendingCombat();
}

/** Hot Spots: Draconis Reach, pp. 32–33. Repair modifiers do not apply to reconfiguration. */
export function constructionReconfigurationSPCost(entity: BaseEntity): number {
    return entity.tonnage() / 2;
}

function hasInternalDamage(source: CBTUnitSnapshot): boolean {
    return [...source.index.locations.values()].some(location => source.query.remainingInternal(location.id, 'preview') < location.internalPoints);
}

function destroyedInPreview(source: CBTUnitSnapshot): boolean {
    if (!hasMekRuntime(source)) return source.query.destroyed();
    const destruction = source.query.mekDestruction();
    return destruction.kind === 'supported' ? destruction.facts.preview.destroyed : source.state.explicitlyDestroyed;
}

function componentHits(source: CBTUnitSnapshot, id: ComponentId): number {
    return hasMekRuntime(source) ? [...source.index.slots.values()].filter(slot => slot.componentIds.includes(id))
        .reduce((sum, slot) => sum + Math.max(0, (source.state.slots.get(slot.id)?.hits ?? 0)
            + (source.state.pendingCombat.criticalHits.get(slot.id) ?? 0)), 0) : 0;
}

function componentDamage(source: CBTUnitSnapshot, id: ComponentId): number {
    const state = source.state.components.get(id);
    const pending = hasMekRuntime(source) ? source.state.pendingCombat : undefined;
    return componentHits(source, id) + Number(state?.jammed ?? false) + Number(state?.escalatingFailure?.active ?? false)
        + Math.max(0, (state?.shieldDamage?.absorptionDamage ?? 0) + (pending?.shieldDamage.get(id)?.absorptionDamage ?? 0))
        + Math.max(0, (state?.shieldDamage?.capacityDamage ?? 0) + (pending?.shieldDamage.get(id)?.capacityDamage ?? 0))
        + modularArmorDamage(source, id);
}

export function constructionComponentHasRepairDamage(source: CBTUnitSnapshot, id: ComponentId): boolean {
    return source.index.components.has(id) && (source.query.componentStatus(id, 'preview') !== 'available' || componentDamage(source, id) > 0);
}

function modularArmorDamage(source: CBTUnitSnapshot, id: ComponentId): number {
    return Math.max(0, (source.state.components.get(id)?.modularArmorDamage ?? 0)
        + (hasMekRuntime(source) ? source.state.pendingCombat.modularArmorDamage.get(id) ?? 0 : 0));
}

function componentHasCriticalDamage(source: CBTUnitSnapshot, id: ComponentId): boolean {
    return source.query.componentStatus(id, 'preview') !== 'available' || componentDamage(source, id) > modularArmorDamage(source, id);
}

function componentImproved(source: CBTUnitSnapshot, preview: CBTUnitSnapshot, id: ComponentId): boolean {
    return componentDamage(source, id) > componentDamage(preview, id)
        || source.query.componentStatus(id, 'preview') !== 'available' && preview.query.componentStatus(id, 'preview') === 'available';
}

function supportPointQuote(source: CBTUnitSnapshot, repaired: boolean, healing: number, rearming: number | null): Pick<ConstructionRepairQuote, 'spCost' | 'spBasis'> {
    const basis = 'Hot Spots: Draconis Reach, pp. 31–33';
    const locations = [...source.index.locations.values()].filter(location => location.internalPoints > 0);
    const lost = locations.filter(location => source.query.remainingInternal(location.id, 'preview') === 0);
    const vehicle = isVehicleEntity(source.entity);
    const trulyDestroyed = source.entity.entityType === 'Mek' && lost.some(location => location.code === 'CT')
        || vehicle && (lost.some(location => !location.code.includes('Turret') && location.code !== 'Rotor')
            || hasNonMekRuntime(source) && [...source.index.damageTracks.values()].some(track => track.system === 'fuel-tank'
                && (source.state.damageTracks.get(track.id)?.hits ?? 0) + (source.state.pendingCombat.damageTrackHits.get(track.id)?.hitDelta ?? 0) > 0));
    if (repaired && trulyDestroyed) return { spCost: null, spBasis: `${basis} · truly destroyed units cannot be repaired under these campaign rules` };
    const battleArmor = source.entity.entityType === 'BattleArmor';
    const destroyed = destroyedInPreview(source) || battleArmor && lost.length === locations.length && lost.length > 0;
    const crippled = source.query.hasCondition('crippled') || battleArmor && lost.length > locations.length / 2;
    const critical = [...source.index.components.keys()].some(id => componentHasCriticalDamage(source, id))
        || hasNonMekRuntime(source) && [...source.index.damageTracks.values()].some(track => track.system !== 'motive'
            && (source.state.damageTracks.get(track.id)?.hits ?? 0) + (source.state.pendingCombat.damageTrackHits.get(track.id)?.hitDelta ?? 0) > 0);
    const multiplier = !repaired ? 0 : destroyed ? 5 : crippled ? 3 : hasInternalDamage(source) || critical ? 2 : .5;
    let repair = source.entity.tonnage() * multiplier;
    if (source.entity.techBase() === 'Clan' || source.entity.mixedTech()) repair = Math.ceil(repair * 1.5);
    if (battleArmor || vehicle && !source.entity.isSupportVehicle()) repair = Math.ceil(repair / 2);
    const level = multiplier === 5 ? 'destroyed' : multiplier === 3 ? 'crippled'
        : multiplier === 2 ? 'structure/critical damage' : 'armor/motive damage';
    return { spCost: rearming === null ? null : repair + healing + rearming,
        spBasis: `${basis}${repaired ? ` · ${level}; highest repair level only` : ''}`
            + (healing ? ` · crew healing ${healing} SP` : '')
            + (rearming === null ? ' · consumable tonnage unavailable' : rearming ? ` · rearming ${rearming} SP` : '') };
}

function crewHealingSP(source: CBTUnitSnapshot, preview?: CBTUnitSnapshot): number {
    return [...source.index.crewPositions.keys()].reduce((sum, id) => {
        const crew = source.query.crewState(id);
        return sum + (crew.isDeathCommitted() ? 0 : Math.max(0, crew.wounds - (preview?.query.crewState(id).wounds ?? 0)) * 30);
    }, 0);
}

/** Each replenished bin is charged at its full capacity, even if only one round was used. */
function rearmingSP(source: CBTUnitSnapshot, preview?: CBTUnitSnapshot): number | null {
    let cost = 0;
    for (const component of source.index.components.values()) {
        if (!component.mount) continue;
        const destination = preview ?? source;
        const override = preview?.state.ammo.get(component.id)?.munitionOverride;
        const loadout = hasMekRuntime(destination)
            ? mekAmmoLoadout(destination.entity, destination.index, component.id, destination.ruleset, override)
            : entityAmmoLoadout(destination.entity, component.mount, destination.ruleset, override);
        if (!loadout) continue;
        const oldAmmo = source.query.ammoEquipment(component.id);
        const oldRemaining = source.query.remainingAmmo(component.id);
        const newRemaining = preview?.query.remainingAmmo(component.id) ?? loadout.capacity;
        if (newRemaining <= 0 || oldAmmo?.id === loadout.equipment.id && newRemaining <= oldRemaining) continue;
        const tons = component.mount.equipment instanceof AmmoEquipment ? component.mount.getTonnage(source.entity)
            : loadout.capacity * loadout.equipment.kgPerShot / 1000;
        if (tons === undefined) return null;
        const rate = ['Advanced', 'Experimental'].includes(loadout.equipment.level) ? 100 : 10;
        cost += tons * rate;
    }
    return cost;
}

/** Repair one facing without changing its design allocation or the opposite facing. */
export function constructionArmorRepairCommands(source: CBTUnitSnapshot, faceId: ArmorFaceId): readonly CBTUnitCommand[] {
    const face = source.index.armorFaces.get(faceId);
    if (!face) return [];
    const pending = source.state.pendingCombat.armorDamage.get(faceId) ?? 0;
    const committed = source.state.locations.get(face.locationId)?.armorDamage.find(damage => damage.faceId === faceId)?.damage ?? 0;
    const commands: CBTUnitCommand[] = [];
    if (pending > 0) commands.push({ type: 'repair-armor', faceId, amount: pending, target: 'pending' });
    // Preserve existing pending repairs; adding damage to cancel them could hit modular armor instead.
    const remaining = committed + Math.min(0, pending);
    if (remaining > 0) commands.push({ type: 'repair-armor', faceId, amount: remaining, target: 'committed' });
    return commands;
}

/** Repair structure independently of armor, equipment and other body locations. */
export function constructionInternalRepairCommands(source: CBTUnitSnapshot, locationId: LocationId): readonly CBTUnitCommand[] {
    if (!source.index.locations.has(locationId)) return [];
    const pending = source.state.pendingCombat.locationInternalDamage.get(locationId) ?? 0;
    const committed = source.state.locations.get(locationId)?.internalDamage ?? 0;
    const commands: CBTUnitCommand[] = [];
    if (pending > 0) commands.push({ type: 'repair-internal', locationId, amount: pending, target: 'pending' });
    const remaining = committed + Math.min(0, pending);
    if (remaining > 0) commands.push({ type: 'repair-internal', locationId, amount: remaining, target: 'committed' });
    return commands;
}

/** Clear authored component damage through the existing force command owner. */
export function constructionComponentRepairCommands(source: CBTUnitSnapshot, componentId: ComponentId): readonly CBTUnitCommand[] {
    const component = source.index.components.get(componentId);
    if (!component) throw new Error('The original component is no longer in the force unit.');
    if (modularArmorDamage(source, componentId) > 0) {
        throw new Error('Use Repair All to restore modular armor.');
    }
    const commands: CBTUnitCommand[] = [];
    if (hasMekRuntime(source)) {
        for (const slot of source.index.slots.values()) {
            if (!slot.componentIds.includes(componentId)) continue;
            const pending = source.state.pendingCombat.criticalHits.get(slot.id) ?? 0;
            const committed = source.state.slots.get(slot.id)?.hits ?? 0;
            if (pending) commands.push({ type: pending > 0 ? 'repair-critical' : 'hit-critical', slotId: slot.id, hits: Math.abs(pending), target: 'pending' });
            if (committed) commands.push({ type: 'repair-critical', slotId: slot.id, hits: committed, target: 'committed' });
        }
        for (const [track, field] of [['absorption', 'absorptionDamage'], ['capacity', 'capacityDamage']] as const) {
            const pending = source.state.pendingCombat.shieldDamage.get(componentId)?.[field] ?? 0;
            const committed = source.state.components.get(componentId)?.shieldDamage?.[field] ?? 0;
            if (pending) commands.push({ type: pending > 0 ? 'repair-shield' : 'damage-shield', componentId, track, amount: Math.abs(pending), target: 'pending' });
            if (committed) commands.push({ type: 'repair-shield', componentId, track, amount: committed, target: 'committed' });
        }
    }
    if (component.kind === 'equipment') {
        commands.push({ type: 'set-component-status', componentId, status: 'available', target: 'committed' },
            { type: 'set-component-status', componentId, status: 'available', target: 'pending' });
        if (source.state.components.get(componentId)?.jammed) commands.push({ type: 'set-component-jammed', componentId, jammed: false });
        if (source.state.components.get(componentId)?.escalatingFailure) commands.push({ type: 'edit-escalating-failure', componentId, edit: { kind: 'set-status', status: 'available' } });
    }
    return commands;
}
