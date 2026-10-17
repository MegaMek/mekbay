// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import { weaponQuirkLabels } from '../../models/entity/utils/weapon-quirks';

/**
 * MegaMek's Quirks option registration order (positive group, then negative), which
 * MegaMekLab's PrintEntity.formatQuirks walks. Neither unit files nor quirks.json keep it.
 */
const QUIRK_PRINT_ORDER: ReadonlyMap<string, number> = new Map([
    'animalistic', 'anti_air', 'atmo_flyer', 'battle_computer', 'barrel_fists_la', 'barrel_fists_ra',
    'battle_fists_la', 'battle_fists_ra', 'combat_computer', 'command_mech', 'compact_mech', 'cowl',
    'directional_torso_mount', 'directional_torso_mount_360', 'distracting', 'docking_arms', 'easy_maintain',
    'easy_pilot', 'ext_twist', 'fast_reload', 'fine_manipulators', 'good_rep_1', 'good_rep_2', 'hyper_actuator',
    'imp_com', 'imp_life_support', 'imp_target_long', 'imp_target_med', 'imp_target_short', 'imp_sensors',
    'internal_bomb', 'low_profile', 'multi_trac', 'nimble_jumper', 'overhead_arms', 'power_reverse',
    'pro_actuator', 'reinforced_legs', 'rugged_1', 'rugged_2', 'rumble_seat', 'scout_bike', 'searchlight',
    'stable', 'trailer_hitch', 'ubiquitous_is', 'ubiquitous_clan', 'variable_range_targeting',
    'vestigial_hands_la', 'vestigial_hands_ra', 'vtol_rotor_coaxial', 'vtol_rotor_dual',
    'bad_rep_is', 'bad_rep_clan', 'cramped_cockpit', 'difficult_eject', 'difficult_maintain', 'em_inter_whole',
    'exp_actuator', 'flawed_cooling', 'fragile_fuel', 'gas_hog', 'hard_pilot', 'illegal_design', 'large_dropper',
    'low_arms', 'no_arms', 'no_eject', 'no_twist', 'non_standard', 'obsolete', 'poor_life_support',
    'poor_performance', 'poor_sealing', 'poor_target_long', 'poor_target_med', 'poor_target_short', 'poor_work',
    'prototype', 'ramshackle', 'sensor_ghosts', 'susceptible_cws', 'unbalanced', 'unstreamlined', 'weak_head_1',
    'weak_head_2', 'weak_head_3', 'weak_head_4', 'weak_head_5', 'weak_legs', 'weak_undercarriage',
    'atmo_instability', 'oversized',
].map((key, index) => [key, index]));

/**
 * The printed quirk footer for every family, or '' when hidden or empty: unit quirks in
 * MegaMekLab order (catalogue keys unknown to MegaMek follow their group in source order),
 * then the weapon quirks this app folds into the same line.
 */
export function recordSheetQuirksText(entity: BaseEntity, showQuirks?: boolean): string {
    if (showQuirks === false) return '';
    const rank = ({ key, type }: { readonly key: string; readonly type: string }) =>
        (type === 'positive' ? 0 : QUIRK_PRINT_ORDER.size) + (QUIRK_PRINT_ORDER.get(key) ?? QUIRK_PRINT_ORDER.size);
    const names = entity.applicableQuirks()
        .map(({ quirk }) => quirk)
        .sort((left, right) => rank(left) - rank(right)) // Stable: equal ranks keep source order.
        .map(quirk => quirk.name)
        .concat(weaponQuirkLabels(entity));
    return names.length > 0 ? `Quirks: ${names.join(', ')}` : '';
}
