import { GameSystem } from '../models/common.model';
import { isClan } from './org/org-registry.util';
import type { FormationFactKey, FormationPredicateId } from './formation-requirement.model';
import { cbtCanDealDamage, cbtHasArtillery, cbtHasAutocannon, type FormationUnitFacts } from './formation-unit-facts.util';

type FormationPredicate = (facts: FormationUnitFacts, gameSystem: GameSystem) => boolean;

const AEROSPACE_AS_TYPES = new Set(['AF', 'CF', 'SC', 'DS', 'DA', 'WS', 'SS', 'JS']);
const TRANSPORT_AS_TYPES = new Set(['AF', 'CF', 'SC', 'DS', 'SV', 'DA']);
const EW_SPECIALS = ['PRB', 'AECM', 'BH', 'ECM', 'LPRB', 'LECM', 'LTAG', 'TAG', 'WAT'];

function hasAsSpecialPrefix(facts: FormationUnitFacts, prefix: string): boolean {
    return facts.asSpecials.some(special => special.startsWith(prefix));
}

function hasAnyAsSpecialPrefix(facts: FormationUnitFacts, prefixes: readonly string[]): boolean {
    return prefixes.some(prefix => hasAsSpecialPrefix(facts, prefix));
}

function roleIn(facts: FormationUnitFacts, roles: readonly string[]): boolean {
    return roles.includes(facts.role);
}

function roleIncludes(facts: FormationUnitFacts, tokens: readonly string[]): boolean {
    return tokens.some(token => facts.role?.includes(token));
}

function asOrCbt(gameSystem: GameSystem, alphaStrike: boolean, classic: boolean): boolean {
    return gameSystem === GameSystem.ALPHA_STRIKE ? alphaStrike : classic;
}

function isClanForce(facts: FormationUnitFacts): boolean {
    const faction = facts.forceUnit.force.faction();
    return !!faction && isClan(faction);
}

export const FORMATION_PREDICATES: Readonly<Record<FormationPredicateId, FormationPredicate>> = {
    'anti-air-equipment': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAnyAsSpecialPrefix(facts, ['FLK', 'AC', 'ART'])
        : cbtHasAutocannon(facts.unit) || cbtHasArtillery(facts.unit) || facts.unit.quirks.includes('Anti-Aircraft Targeting'),
    'anvil-armor': (facts, gameSystem) => asOrCbt(gameSystem, facts.asArmor >= 4, facts.cbtArmor >= 105),
    'anvil-weapon': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAnyAsSpecialPrefix(facts, ['AC', 'FLK', 'LRM', 'SRM'])
        : cbtHasAutocannon(facts.unit)
            || facts.unit.comp?.some(component => component.n?.includes('LRM')) === true
            || facts.unit.comp?.some(component => component.n?.includes('SRM')) === true,
    'artillery-equipment': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAsSpecialPrefix(facts, 'ART')
        : cbtHasArtillery(facts.unit),
    'assault-armor': (facts, gameSystem) => asOrCbt(gameSystem, facts.asArmor >= 5, facts.cbtArmor >= 135),
    'assault-damage': (facts, gameSystem) => asOrCbt(gameSystem, facts.asMediumDamage >= 3, cbtCanDealDamage(facts.unit, 25, 7)),
    'assault-role-juggernaut': (facts) => facts.role === 'Juggernaut',
    'assault-role-sniper': (facts) => facts.role === 'Sniper',
    'assault-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize >= 4, facts.cbtIsAssaultOrLarger),
    'aerospace-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? AEROSPACE_AS_TYPES.has(facts.asType ?? '')
        : facts.unit.type === 'Aero',
    'aerospace-superiority-role': (facts) => roleIn(facts, ['Interceptor', 'Fast Dogfighter']),
    'attack-or-dogfighter-role': (facts) => roleIncludes(facts, ['Attack', 'Dogfighter']),
    'battle-armor-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BA'
        : facts.unit.subtype === 'Battle Armor',
    'battle-role': (facts) => roleIn(facts, ['Brawler', 'Sniper', 'Skirmisher']),
    'bm-or-mek-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BM'
        : facts.unit.type === 'Mek',
    'clan-force': (facts) => isClanForce(facts),
    'command-diverse-role': (facts) => roleIn(facts, ['Brawler', 'Striker', 'Scout']),
    'command-heavy-role': (facts) => roleIn(facts, ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut']),
    'combat-vehicle': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'CV' || facts.asType === 'SV'
        : facts.unit.type === 'Tank' || facts.unit.type === 'VTOL',
    'direct-fire-damage': (facts, gameSystem) => asOrCbt(gameSystem, facts.asLongDamage >= 2, cbtCanDealDamage(facts.unit, 10, 18)),
    'dogfighter-role': (facts) => roleIncludes(facts, ['Dogfighter']),
    'ew-equipment': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAnyAsSpecialPrefix(facts, EW_SPECIALS)
        : facts.unit.comp?.some(component => component.eq?.hasAnyFlag(['F_ECM', 'F_BAP', 'F_TAG'])) === true,
    'fast-assault-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asGroundMove >= 10 || facts.asJumpMove > 0, facts.cbtWalk >= 5 || facts.cbtJump > 0),
    'fire-support-equipment': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAsSpecialPrefix(facts, 'IF')
        : facts.unit.comp?.some(component => component.n?.includes('LRM')) === true || cbtHasArtillery(facts.unit),
    'fire-support-role': (facts) => facts.role === 'Fire Support',
    'fire-role': (facts) => roleIn(facts, ['Missile Boat', 'Sniper']),
    'heavy-bm-or-mek': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BM' && facts.asSize >= 3
        : facts.unit.type === 'Mek' && facts.cbtIsHeavyOrLarger,
    'heavy-recon-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 8, facts.cbtWalk >= 4),
    'heavy-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize >= 3, facts.cbtIsHeavyOrLarger),
    'hunter-role': (facts) => roleIn(facts, ['Ambusher', 'Juggernaut']),
    'infantry-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'CI' || facts.asType === 'BA' || facts.asType === 'PM'
        : facts.unit.type === 'Infantry',
    'indirect-fire-equipment': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAsSpecialPrefix(facts, 'IF')
        : facts.unit.comp?.some(component => component.n?.includes('LRM')) === true || cbtHasArtillery(facts.unit),
    'interceptor-role': (facts) => facts.role === 'Interceptor',
    'jump-or-infantry': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asJumpMove > 0 || FORMATION_PREDICATES['infantry-unit'](facts, gameSystem)
        : facts.cbtJump > 0 || facts.unit.type === 'Infantry',
    'light-bm-or-mek': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BM' && facts.asSize === 1
        : facts.unit.type === 'Mek' && facts.cbtIsLight,
    'light-fire-role': (facts) => roleIn(facts, ['Missile Boat', 'Sniper']),
    'light-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize === 1, facts.cbtIsLight),
    'long-damage-2': (facts, gameSystem) => asOrCbt(gameSystem, facts.asLongDamage >= 2, cbtCanDealDamage(facts.unit, 10, 18)),
    'long-damage-positive': (facts, gameSystem) => asOrCbt(gameSystem, facts.asLongDamage > 0, cbtCanDealDamage(facts.unit, 5, 18)),
    'long-damage-strong': (facts, gameSystem) => asOrCbt(gameSystem, facts.asLongDamage > 1, cbtCanDealDamage(facts.unit, 5, 18)),
    'low-medium-damage': (facts, gameSystem) => asOrCbt(gameSystem, facts.asMediumDamage < 2, !cbtCanDealDamage(facts.unit, 11, 9)),
    'medium-damage-2': (facts, gameSystem) => asOrCbt(gameSystem, facts.asMediumDamage >= 2, cbtCanDealDamage(facts.unit, 10, 9)),
    'medium-damage-positive': (facts, gameSystem) => asOrCbt(gameSystem, facts.asMediumDamage > 1, cbtCanDealDamage(facts.unit, 5, 15)),
    'medium-heavy-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize >= 2 && facts.asSize <= 3, facts.cbtIsMedium || (facts.cbtIsHeavyOrLarger && !facts.cbtIsAssaultOrLarger)),
    'medium-plus-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize >= 2, facts.cbtIsMediumOrLarger),
    'medium-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize === 2, facts.cbtIsMedium),
    'phalanx-allowed-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BM' || facts.asType === 'BA' || facts.asType === 'CV'
        : facts.unit.type === 'Mek' || facts.unit.subtype === 'Battle Armor' || ['Tank', 'VTOL', 'Naval'].includes(facts.unit.type),
    'phalanx-ba-or-cv': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BA' || facts.asType === 'CV'
        : facts.unit.subtype === 'Battle Armor' || ['Tank', 'VTOL', 'Naval'].includes(facts.unit.type),
    'phalanx-bm-or-ba': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'BM' || facts.asType === 'BA'
        : facts.unit.type === 'Mek' || facts.unit.subtype === 'Battle Armor',
    'phalanx-bm-or-mek': (facts, gameSystem) => FORMATION_PREDICATES['bm-or-mek-unit'](facts, gameSystem),
    'phalanx-cv': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'CV'
        : ['Tank', 'VTOL', 'Naval'].includes(facts.unit.type),
    'probe-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 10, facts.cbtWalk >= 6),
    'pursuit-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 12, facts.cbtWalk >= 6),
    'ranger-size': (facts, gameSystem) => asOrCbt(gameSystem, facts.asSize < 4, !facts.cbtIsAssaultOrLarger),
    'recon-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 10, facts.cbtWalk >= 5),
    'rifle-autocannon': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? hasAsSpecialPrefix(facts, 'AC') || hasAsSpecialPrefix(facts, 'FLK')
        : cbtHasAutocannon(facts.unit),
    'rifle-medium-heavy-size': (facts, gameSystem) => FORMATION_PREDICATES['medium-heavy-size'](facts, gameSystem),
    'rifle-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asGroundMove >= 8, facts.cbtWalk >= 4),
    'scout-or-striker-role': (facts) => roleIn(facts, ['Scout', 'Striker']),
    'scout-role': (facts) => facts.role === 'Scout',
    'security-heavy-role': (facts) => roleIn(facts, ['Sniper', 'Missile Boat']),
    'security-light-role': (facts) => roleIn(facts, ['Scout', 'Striker']),
    'short-damage-2': (facts, gameSystem) => asOrCbt(gameSystem, facts.asShortDamage >= 2, cbtCanDealDamage(facts.unit, 10, 6)),
    'slow-urban-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asGroundMove <= 8, facts.cbtWalk <= 4),
    'strategic-aero': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? facts.asType === 'AF'
        : facts.unit.type === 'Aero',
    'strategic-skill-3': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? (facts.pilotSkill ?? Number.POSITIVE_INFINITY) <= 3
        : (facts.gunnerySkill ?? Number.POSITIVE_INFINITY) <= 3,
    'striker-or-skirmisher-role': (facts) => roleIn(facts, ['Striker', 'Skirmisher']),
    'striker-speed': (facts, gameSystem) => asOrCbt(gameSystem, facts.asGroundMove >= 10 || facts.asJumpMove >= 8, facts.cbtWalk >= 5 || facts.cbtJump >= 4),
    'sweep-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 10, facts.cbtWalk >= 5),
    'transport-role': (facts) => roleIncludes(facts, ['Transport']),
    'transport-squadron-unit': (facts, gameSystem) => gameSystem === GameSystem.ALPHA_STRIKE
        ? TRANSPORT_AS_TYPES.has(facts.asType ?? '')
        : facts.unit.type === 'Aero',
    'very-fast-move': (facts, gameSystem) => asOrCbt(gameSystem, facts.asAnyGroundOrJumpMove >= 12, facts.cbtWalk >= 6),
};

export function evaluateFormationPredicate(
    predicateId: FormationPredicateId,
    facts: FormationUnitFacts,
    gameSystem: GameSystem,
): boolean {
    return FORMATION_PREDICATES[predicateId](facts, gameSystem);
}

export function getFormationFactValue(
    factKey: FormationFactKey,
    facts: FormationUnitFacts,
): string | number | undefined {
    switch (factKey) {
        case 'asSize':
            return facts.asSize;
        case 'cbtWeightClass':
            return facts.cbtWeightClass;
        case 'chassis':
            return facts.chassis;
    }
}
