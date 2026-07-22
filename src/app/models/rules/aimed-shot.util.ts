import { AmmoEquipment, type AmmoType, WeaponEquipment } from '../equipment.model';
import type { MountedEquipment } from '../mounted-equipment.model';
import type { TnTargetNumberCalculatorState } from '../target-number-calculator.model';

export type AimingMode = 'none' | 'immobile' | 'targeting-computer';

export interface AimedShotContext {
    mode?: AimingMode;
    selectedMode?: string | null;
    selectedAmmo?: AmmoEquipment | null;
}

export type AimedShotAmmoContext = AimedShotContext;

export interface AimedShotEligibility {
    allowed: boolean;
    reason: string | null;
}

const AIMED_SHOT_CLUSTER_AMMO_TYPES = new Set<AmmoType>([
    'LRM_STREAK',
    'LRM',
    'LRM_IMP',
    'LRM_TORPEDO',
    'SRM',
    'SRM_IMP',
    'SRM_TORPEDO',
    'SRM_STREAK',
    'MRM',
    'NARC',
    'INARC',
    'AMS',
    'ARROW_IV',
    'LONG_TOM',
    'SNIPER',
    'THUMPER',
    'SRM_ADVANCED',
    'LRM_TORPEDO_COMBO',
    'ATM',
    'IATM',
    'MML',
    'EXLRM',
    'NLRM',
    'ROCKET_LAUNCHER',
    'HAG',
    'MEK_MORTAR'
]);

const T_BOLT_AMMO_TYPES = new Set<AmmoType>(['TBOLT_5', 'TBOLT_10', 'TBOLT_15', 'TBOLT_20']);
const FLAK_AMMO_TYPES = new Set<AmmoType>(['AC', 'AC_ULTRA', 'AC_ULTRA_THB']);

// TODO: this whole logic has to be moved inside the handlers. Handlers should decide if the shot is allowed with that weapon/ammo/mode

export function canPerformAimedShot(entry: MountedEquipment, calculator: TnTargetNumberCalculatorState | null | undefined, context: AimedShotAmmoContext = {}): boolean {
    return aimedShotNotAllowedText(entry, calculator, context) === null;
}

export function aimedShotNotAllowedText(entry: MountedEquipment, calculator: TnTargetNumberCalculatorState | null | undefined, context: AimedShotAmmoContext = {}): string | null {
    const eligibility = resolveAimedShotEligibility(entry, { ...context, mode: context.mode ?? 'targeting-computer' });
    return eligibility.allowed ? null : `No aimed shot: ${eligibility.reason}`;
}

export function resolveAimedShotEligibility(entry: MountedEquipment, context: AimedShotContext = {}): AimedShotEligibility {
    const mode = context.mode ?? 'immobile';
    if (mode === 'none') return allowed();
    if (!(entry.equipment instanceof WeaponEquipment)) return allowed();

    const weapon = entry.equipment;
    if (isLegAttack(entry)) return disallowed('Leg attacks cannot make aimed shots.');
    if (isSwarmAttack(entry)) return disallowed('Swarm attacks cannot make aimed shots.');
    if (isBattleArmorLbxAttack(entry)) return disallowed('Battle armor LB-X attacks cannot make aimed shots.');
    if (hasMultiShotMode(context.selectedMode)) return disallowed('Multi-shot attacks cannot make aimed shots.');

    if (mode === 'targeting-computer') {
        if (!weapon.flags.has('F_DIRECT_FIRE')) return disallowed('Only direct-fire weapons can use targeting-computer aimed shots.');
        if (weapon.flags.has('F_PULSE')) return disallowed('Pulse weapons cannot make aimed shots.');
        if (context.selectedMode?.toLowerCase().startsWith('pulse')) return disallowed('Pulse fire modes cannot make aimed shots.');
        if (weapon.ammoType === 'HAG') return disallowed('HAG weapons cannot make aimed shots.');
    }

    const ammo = context.selectedAmmo;
    if (disallowsAimedShotByAmmo(weapon, ammo)) return disallowed('The selected ammo cannot make aimed shots.');
    return allowed();
}

function disallowsAimedShotByAmmo(weapon: WeaponEquipment, ammo: AmmoEquipment | null | undefined): boolean {
    if (weapon.isInfantryWeapon()) return false;
    const ammoType = ammo?.ammoType ?? weapon.ammoType;
    if (AIMED_SHOT_CLUSTER_AMMO_TYPES.has(ammoType)) return true;
    if (T_BOLT_AMMO_TYPES.has(ammoType) && weapon.rackSize > 1) return true;
    if (ammo?.hasMunitionType('M_CLUSTER') && (ammoType === 'AC_LBX' || ammoType === 'AC_LBX_THB' || ammoType === 'SBGAUSS')) return true;
    if (ammo?.hasMunitionType('M_FLAK') && FLAK_AMMO_TYPES.has(ammoType)) return true;
    return false;
}

function hasMultiShotMode(selectedMode: string | null | undefined): boolean {
    if (!selectedMode) return false;
    const normalized = selectedMode.trim().toLowerCase();
    return /^\d+\s*[- ]?shot/.test(normalized)
        || normalized.includes('rapid')
        || normalized.includes('ultra')
        || normalized.includes('rotary');
}

function isLegAttack(entry: MountedEquipment): boolean {
    return /leg attack/i.test(entry.name);
}

function isSwarmAttack(entry: MountedEquipment): boolean {
    return /swarm/i.test(entry.name);
}

function isBattleArmorLbxAttack(entry: MountedEquipment): boolean {
    return /ba .*lb-?x|lb-?x.*ba/i.test(entry.name);
}

function allowed(): AimedShotEligibility {
    return { allowed: true, reason: null };
}

function disallowed(reason: string): AimedShotEligibility {
    return { allowed: false, reason };
}