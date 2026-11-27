// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import type { Quirk } from '../../models/quirks.model';
import type { EntityMountedEquipment } from '../../models/entity/types/equipment';
import type { EntityWeaponQuirk } from '../../models/entity/types/common';
import {
  canAssignWeaponQuirks,
  canHaveWeaponQuirks,
  weaponQuirkAddress,
  weaponQuirkMount,
} from '../../models/entity/utils/weapon-quirks';
import { normalizeLooseText } from '../../utils/string.util';
import { isMekEntity } from '../../models/entity/utils/entity-type-guards';
import { WeaponEquipment } from '../../models/equipment.model';

export interface BmmChassisQuirk {
  readonly key: string;
  readonly value?: string;
}

export interface BmmChassisRule {
  readonly chassis: string;
  readonly quirks: readonly BmmChassisQuirk[];
}

export interface BmmWeaponQuirk {
  readonly key: string;
  readonly names?: readonly string[];
  readonly locations?: readonly string[];
}

export interface BmmChassisWeaponRule {
  readonly chassis: string;
  readonly quirks: readonly BmmWeaponQuirk[];
}

const quirk = (key: string, value?: string): BmmChassisQuirk => ({ key, value });
const rule = (chassis: string, ...quirks: BmmChassisQuirk[]): BmmChassisRule => ({ chassis, quirks });
const weapon = (key: string, names?: string | readonly string[], locations?: readonly string[]): BmmWeaponQuirk => ({
  key,
  names: names === undefined ? undefined : typeof names === 'string' ? [names] : names,
  locations,
});
const weaponRule = (chassis: string, ...quirks: BmmWeaponQuirk[]): BmmChassisWeaponRule => ({ chassis, quirks });

const battleFists = () => quirk('battle_fists');
const barrelFists = () => quirk('barrel_fists');
const vestigialHands = () => quirk('vestigial_hands');
const ubiquitous = () => quirk('ubiquitous');
const badReputation = () => quirk('bad_rep');

/** BattleMech Manual, 7th printing, pp. 90-95. */
export const BMM_CHASSIS_QUIRKS: readonly BmmChassisRule[] = [
  rule('Akuma', quirk('easy_maintain')),
  rule('Albatross', quirk('easy_maintain'), quirk('imp_target_long')),
  rule('Alfar', quirk('non_standard')),
  rule('Annihilator', quirk('easy_maintain')),
  rule('Anubis', quirk('ext_twist'), quirk('difficult_maintain'), quirk('exp_actuator')),
  rule('Anvil', quirk('ext_twist'), quirk('imp_target_med')),
  rule('Apollo', quirk('fast_reload'), quirk('rugged_1')),
  rule('Aquagladius', quirk('difficult_eject'), quirk('difficult_maintain')),
  rule('Arbalest', quirk('easy_maintain')),
  rule('Arcas', quirk('pro_actuator')),
  rule('Archangel', quirk('command_mech'), quirk('imp_com'), quirk('imp_sensors'), badReputation()),
  rule('Archer', battleFists(), quirk('command_mech'), quirk('stable'), ubiquitous()),
  rule('Arctic Fox', quirk('weak_head_1')),
  rule('Arctic Wolf', quirk('imp_target_short')),
  rule('Arctic Wolf II', quirk('imp_target_short')),
  rule('Argus', quirk('easy_maintain'), quirk('no_arms')),
  rule('Assassin', quirk('easy_maintain'), quirk('cramped_cockpit'), quirk('non_standard'), quirk('poor_life_support')),
  rule('Atlas', battleFists(), quirk('command_mech'), quirk('distracting'), quirk('imp_com')),
  rule('Atlas II', battleFists(), quirk('command_mech'), quirk('distracting')),
  rule('Awesome', quirk('battle_fists_la')),
  rule('Axman', quirk('pro_actuator')),
  rule('Baboon (Howler)', quirk('ext_twist'), quirk('low_profile'), quirk('searchlight')),
  rule('Balius', quirk('rugged_1')),
  rule('Bandersnatch', quirk('stable'), ubiquitous()),
  rule('Banshee', quirk('rugged_1'), badReputation()),
  rule('Banzai', quirk('difficult_maintain'), quirk('non_standard'), quirk('prototype')),
  rule('Barghest', quirk('directional_torso_mount', 'LT RT')),
  rule('Battle Cobra', quirk('ext_twist')),
  rule('Battle Hawk', quirk('rugged_1'), badReputation()),
  rule('BattleMaster', quirk('command_mech'), quirk('weak_head_1')),
  rule('BattleAxe', quirk('difficult_maintain')),
  rule('Bear Cub', quirk('easy_pilot'), quirk('ext_twist'), quirk('cramped_cockpit')),
  rule(
    'Behemoth (Stone Rhino)',
    barrelFists(),
    quirk('pro_actuator'),
    quirk('oversized'),
    quirk('poor_performance'),
    quirk('weak_head_1'),
  ),
  rule('Beowulf', quirk('command_mech'), quirk('ext_twist'), quirk('exp_actuator')),
  rule('Berserker', quirk('distracting')),
  rule('Bishamon', quirk('difficult_maintain')),
  rule('Black Hawk (Nova)', quirk('combat_computer'), quirk('low_profile')),
  rule('Black Hawk-KU', quirk('easy_maintain')),
  rule('Black Knight', quirk('command_mech')),
  rule('Black Lanner', quirk('stable')),
  rule('Black Watch', quirk('easy_pilot')),
  rule('Blackjack', badReputation()),
  rule('Blackjack (Omni)', quirk('non_standard')),
  rule('Blade', quirk('easy_maintain')),
  rule('Blitzkrieg', quirk('directional_torso_mount', 'CT LT'), quirk('no_arms')),
  rule('Blood Asp', quirk('rugged_1')),
  rule('Blood Kite', quirk('easy_maintain'), quirk('rugged_2')),
  rule('Blood Reaper', quirk('hyper_actuator'), quirk('rugged_1')),
  rule('Bloodhound', quirk('imp_sensors'), quirk('pro_actuator')),
  rule('Blue Flame', quirk('directional_torso_mount', 'HD LT RT'), badReputation()),
  rule('Bombard', badReputation(), quirk('non_standard')),
  rule('Bombardier', badReputation()),
  rule('Bowman', quirk('stable'), quirk('bad_rep_clan')),
  rule('Brigand', quirk('nimble_jumper')),
  rule('Bruin', quirk('rugged_1'), quirk('exp_actuator')),
  rule('Buccaneer', quirk('imp_target_short'), badReputation()),
  rule('Burrock', quirk('stable')),
  rule('Bushwacker', quirk('low_profile')),
  rule('Caesar', quirk('hyper_actuator')),
  rule('Canis', quirk('fast_reload')),
  rule('Cataphract', quirk('pro_actuator')),
  rule('Catapult', quirk('no_arms'), quirk('weak_head_1')),
  rule('Cauldron-Born (Ebon Jaguar)', quirk('low_profile')),
  rule('Centurion', quirk('imp_target_short'), quirk('non_standard')),
  rule('Cephalus', quirk('imp_life_support'), quirk('bad_rep_clan'), quirk('difficult_maintain'), quirk('no_arms')),
  rule('Cerberus', barrelFists(), quirk('imp_target_long'), vestigialHands()),
  rule('Chameleon', quirk('easy_pilot')),
  rule('Champion', quirk('no_arms')),
  rule('Charger', quirk('barrel_fists_la'), quirk('easy_maintain'), badReputation()),
  rule('Chimera', quirk('nimble_jumper')),
  rule('Cicada', quirk('no_arms')),
  rule(
    'Clint',
    quirk('imp_target_med'),
    quirk('imp_target_long'),
    quirk('exp_actuator'),
    quirk('difficult_maintain'),
    quirk('non_standard'),
  ),
  rule('Clint IIC', quirk('imp_target_med'), quirk('imp_target_long')),
  rule('Cobra', quirk('pro_actuator')),
  rule('Colossus', quirk('stable'), quirk('low_arms')),
  rule('Commando', quirk('low_profile'), quirk('exp_actuator')),
  rule('Commando IIC', quirk('low_profile'), quirk('exp_actuator')),
  rule('Copperhead', quirk('difficult_maintain')),
  rule('Cossack', quirk('ext_twist')),
  rule('Cougar', ubiquitous()),
  rule('Coyotl', quirk('ext_twist')),
  rule('Crab', quirk('easy_maintain')),
  rule('Crimson Hawk', quirk('pro_actuator')),
  rule('Crimson Langur', quirk('easy_maintain'), quirk('imp_com'), quirk('pro_actuator')),
  rule('Crockett', quirk('easy_pilot'), quirk('poor_life_support')),
  rule('Cronus', quirk('easy_maintain')),
  rule('Crossbow', quirk('obsolete', '2550,3070'), quirk('poor_target_long')),
  rule('Crossbow (Omni)', quirk('imp_target_short')),
  rule('Crusader', quirk('easy_maintain'), quirk('rugged_1'), ubiquitous()),
  rule('Cudgel', quirk('difficult_maintain')),
  rule('Cuirass', quirk('easy_maintain')),
  rule('Cyclops', quirk('battle_computer'), quirk('cowl'), quirk('difficult_eject'), quirk('weak_head_2')),
  rule('Daboku', quirk('prototype')),
  rule('Daedalus', quirk('difficult_maintain')),
  rule('Daikyu', quirk('ext_twist')),
  rule('Daimyo', quirk('ext_twist'), quirk('low_profile'), quirk('difficult_maintain')),
  rule('Daishi (Dire Wolf)', quirk('imp_target_long'), quirk('difficult_eject')),
  rule('Dark Crow', quirk('low_arms')),
  rule('Dart', quirk('ext_twist')),
  rule('Dasher (Fire Moth)', quirk('low_profile'), quirk('overhead_arms')),
  rule('Dasher II', quirk('poor_performance')),
  rule('Defiance', barrelFists(), quirk('hyper_actuator'), quirk('searchlight'), quirk('stable')),
  rule('Deimos', quirk('anti_air')),
  rule('Dervish', quirk('easy_maintain'), quirk('hyper_actuator')),
  rule('Deva', quirk('imp_com'), quirk('imp_sensors'), badReputation()),
  rule('Devastator', quirk('hyper_actuator'), quirk('searchlight')),
  rule('Dragon', quirk('low_profile'), quirk('stable')),
  rule('Dragon Fire', quirk('good_rep_1'), quirk('no_arms')),
  rule('Dragonfly (Viper)', quirk('imp_target_long'), quirk('low_profile')),
  rule('Dragoon', quirk('easy_maintain'), badReputation(), quirk('obsolete', '2780')),
  rule('Duan Gung', quirk('pro_actuator'), quirk('non_standard')),
  rule('Eagle', quirk('ext_twist'), quirk('weak_head_1')),
  rule('Ebony', quirk('imp_target_med')),
  rule('Eidolon', quirk('non_standard')),
  rule('Eisenfaust', battleFists(), quirk('easy_maintain'), quirk('pro_actuator')),
  rule('Emperor', quirk('command_mech')),
  rule('Enfield', quirk('ext_twist')),
  rule('Enforcer', barrelFists()),
  rule('Enforcer III', barrelFists()),
  rule('Epimetheus', quirk('non_standard'), quirk('prototype')),
  rule('Excalibur', vestigialHands()),
  rule('Exterminator', quirk('difficult_maintain')),
  rule('Eyleuka', quirk('exp_actuator')),
  rule('Fafnir', quirk('no_arms')),
  rule('Falcon', quirk('low_profile')),
  rule('Falcon Hawk', quirk('good_rep_1')),
  rule('Falconer', quirk('stable')),
  rule('Fennec', quirk('no_arms')),
  rule('Fenris (Ice Ferret)', quirk('imp_sensors')),
  rule('Fire Falcon', quirk('imp_sensors')),
  rule('Fire Scorpion', quirk('cowl')),
  rule('Fireball', quirk('imp_com'), quirk('low_profile')),
  rule('Firebee', quirk('poor_life_support'), quirk('weak_legs')),
  rule('Firefly', quirk('no_arms')),
  rule('Firestarter', ubiquitous()),
  rule('Firestarter (Omni)', quirk('cowl'), quirk('difficult_maintain')),
  rule('Flamberge', quirk('imp_target_med')),
  rule('Flashfire', quirk('non_standard')),
  rule('Flashman', quirk('rugged_1')),
  rule('Flea', quirk('easy_maintain'), quirk('imp_life_support'), quirk('no_arms')),
  rule('Galahad', quirk('difficult_maintain')),
  rule('Galahad (Glass Spider)', quirk('anti_air'), quirk('ext_twist'), quirk('multi_trac')),
  rule('Gallowglas', quirk('good_rep_1')),
  rule('Garm', quirk('ext_twist')),
  rule('Ghost', quirk('ext_twist'), quirk('imp_com'), quirk('imp_sensors')),
  rule('Gladiator', quirk('cowl'), badReputation()),
  rule('Gladiator (Executioner)', quirk('distracting')),
  rule('Goliath', quirk('multi_trac'), quirk('exp_actuator')),
  rule('Goshawk (Vapor Eagle)', quirk('nimble_jumper')),
  rule('Goshawk II', quirk('imp_life_support'), quirk('nimble_jumper')),
  rule('Grand Crusader', quirk('directional_torso_mount', 'LT RT'), badReputation()),
  rule('Grand Crusader II', quirk('easy_maintain'), quirk('stable'), badReputation()),
  rule('Grand Dragon', quirk('ext_twist'), quirk('low_profile'), quirk('stable')),
  rule('Grand Titan', quirk('multi_trac'), quirk('difficult_maintain')),
  rule('Grasshopper', quirk('rugged_1')),
  rule('Great Turtle', quirk('imp_target_short'), quirk('poor_performance')),
  rule('Great Wyrm', quirk('stable')),
  rule('Grendel (Mongrel)', quirk('rugged_1')),
  rule('Griffin', battleFists(), quirk('rugged_1'), ubiquitous()),
  rule('Griffin IIC', battleFists()),
  rule('Grigori', quirk('imp_com'), quirk('imp_sensors'), badReputation()),
  rule('Grim Reaper', quirk('easy_maintain'), quirk('pro_actuator')),
  rule('Grizzly', quirk('difficult_maintain'), quirk('exp_actuator')),
  rule('Guillotine', quirk('searchlight')),
  rule('Guillotine IIC', quirk('searchlight')),
  rule('Gunslinger', quirk('cowl')),
  rule('Gurkha', badReputation(), quirk('exp_actuator')),
  rule('Ha Otoko', quirk('bad_rep_clan')),
  rule('Hachiwara', quirk('difficult_maintain')),
  rule('Hammer', quirk('ext_twist'), quirk('imp_target_long')),
  rule('Hammerhands', barrelFists(), quirk('pro_actuator')),
  rule('Hankyu (Arctic Cheetah)', quirk('pro_actuator')),
  rule('Hatamoto', quirk('barrel_fists_la'), quirk('easy_maintain')),
  rule('Hatchetman', quirk('anti_air')),
  rule('Hauptmann', quirk('easy_maintain'), quirk('ext_twist')),
  rule('Hector', badReputation(), quirk('exp_actuator'), quirk('obsolete', '2420')),
  rule('Helepolis', quirk('reinforced_legs'), quirk('stable')),
  rule('Helios', quirk('easy_maintain')),
  rule('Hellfire', quirk('difficult_maintain')),
  rule('Hellhound (Conjurer)', quirk('ext_twist')),
  rule('Hellion', quirk('weak_head_1')),
  rule('Hellspawn', badReputation()),
  rule('Hellstar', barrelFists(), quirk('exp_actuator')),
  rule('Hercules', quirk('difficult_maintain')),
  rule('Hermes', quirk('imp_com'), quirk('stable')),
  rule('Hermes II', quirk('easy_maintain'), quirk('imp_com')),
  rule('Highlander', quirk('command_mech'), quirk('cowl'), quirk('reinforced_legs'), quirk('difficult_eject')),
  rule('Highlander IIC', quirk('command_mech'), quirk('cowl'), quirk('reinforced_legs'), quirk('difficult_eject')),
  rule('Hollander', quirk('reinforced_legs'), quirk('unbalanced')),
  rule('Hollander II', quirk('reinforced_legs')),
  rule('Hoplite', quirk('no_arms')),
  rule('Hornet', quirk('low_profile'), quirk('no_arms')),
  rule('Hunchback', battleFists()),
  rule('Hunchback IIC', quirk('bad_rep_clan')),
  rule('Huron Warrior', quirk('imp_sensors')),
  rule('Hussar', quirk('directional_torso_mount', 'CT'), quirk('imp_com'), quirk('rugged_1')),
  rule('Icarus II', quirk('imp_target_short')),
  rule('Icestorm', quirk('imp_sensors'), quirk('rugged_1')),
  rule('Imp', quirk('command_mech'), quirk('difficult_maintain')),
  rule('Initiate', quirk('hyper_actuator'), badReputation()),
  rule('Jackal', quirk('weak_legs')),
  rule('Jackrabbit', quirk('easy_maintain'), badReputation()),
  rule('JagerMech', quirk('anti_air')),
  rule('JagerMech III', quirk('anti_air'), quirk('overhead_arms')),
  rule('Javelin', quirk('unbalanced')),
  rule('Jenner', quirk('no_arms')),
  rule('Jenner IIC', quirk('no_arms')),
  rule('Jinggau', quirk('low_profile'), quirk('weak_head_2')),
  rule('Juggernaut', quirk('imp_life_support'), quirk('difficult_maintain')),
  rule('Jupiter', quirk('fine_manipulators'), quirk('imp_sensors'), quirk('imp_target_long')),
  rule('Kabuto', quirk('ext_twist')),
  rule('Karhu', quirk('em_inter_whole')),
  rule('King Crab', quirk('command_mech')),
  rule('Kingfisher', quirk('rugged_1')),
  rule('Kintaro', quirk('rugged_1')),
  rule('Kodiak', battleFists(), quirk('distracting')),
  rule('Komodo', quirk('ext_twist'), quirk('low_profile'), quirk('pro_actuator'), quirk('weak_head_2')),
  rule('Koschei', quirk('imp_life_support'), quirk('weak_head_1')),
  rule('Koshi (Mist Lynx)', quirk('imp_sensors'), quirk('low_profile')),
  rule('Koto', quirk('em_inter_whole')),
  rule('Kraken (Bane)', quirk('ext_twist'), quirk('pro_actuator')),
  rule('Kuma', quirk('hard_pilot')),
  rule('Kyudo', quirk('easy_pilot'), quirk('exp_actuator')),
  rule('Lancelot', quirk('anti_air'), quirk('low_profile'), badReputation()),
  rule('Lao Hu', quirk('good_rep_1')),
  rule('Legacy', quirk('directional_torso_mount', 'LT RT'), badReputation()),
  rule('Legionnaire', quirk('easy_maintain'), quirk('imp_target_med')),
  rule('Lightray', quirk('hyper_actuator'), badReputation(), quirk('exp_actuator')),
  rule('Linebacker', quirk('stable')),
  rule('Lineholder', quirk('easy_maintain')),
  rule('Lobo', quirk('directional_torso_mount', 'AMS'), quirk('ext_twist'), quirk('difficult_maintain')),
  rule('Locust', quirk('low_profile'), ubiquitous(), quirk('cramped_cockpit'), quirk('no_arms'), quirk('weak_legs')),
  rule('Locust IIC', quirk('easy_maintain'), quirk('low_profile'), quirk('no_arms'), quirk('weak_legs')),
  rule('Loki (Hellbringer)', quirk('searchlight')),
  rule('Longbow', quirk('anti_air'), quirk('searchlight'), ubiquitous(), quirk('no_arms')),
  rule('Longshot', quirk('difficult_maintain')),
  rule('Lupus', quirk('exp_actuator')),
  rule('Lynx', quirk('multi_trac')),
  rule('Mackie', quirk('easy_maintain'), quirk('pro_actuator'), quirk('rugged_1'), quirk('oversized')),
  rule('Mad Cat (Timber Wolf)', quirk('imp_target_med'), quirk('weak_head_1')),
  rule('Mad Cat Mk II', quirk('imp_target_med')),
  rule('Maelstrom', quirk('good_rep_1')),
  rule('Malak', quirk('imp_com'), quirk('imp_sensors'), badReputation()),
  rule('Mandrill', quirk('low_profile')),
  rule('Mangonel', quirk('difficult_maintain'), quirk('no_arms')),
  rule('Mantis', quirk('non_standard')),
  rule(
    'Marauder',
    quirk('command_mech'),
    quirk('directional_torso_mount', 'RT'),
    quirk('hyper_actuator'),
    quirk('low_profile'),
  ),
  rule('Marauder II', quirk('command_mech'), quirk('hyper_actuator'), quirk('low_profile')),
  rule('Marauder IIC', quirk('command_mech'), quirk('hyper_actuator'), quirk('exp_actuator')),
  rule('Marshal', quirk('easy_maintain'), quirk('rugged_2')),
  rule('Masakari (Warhawk)', quirk('imp_target_long')),
  rule('Matador', battleFists()),
  rule('Men Shen', quirk('imp_com'), quirk('imp_sensors'), quirk('exp_actuator')),
  rule('Mercury', quirk('easy_maintain')),
  rule('Mercury II', quirk('low_profile'), quirk('bad_rep_clan')),
  rule('Merlin', quirk('easy_maintain'), quirk('rugged_1')),
  rule('Mjolnir', quirk('easy_maintain')),
  rule('Mongoose', quirk('command_mech'), quirk('easy_pilot')),
  rule('Mongoose II', quirk('command_mech'), quirk('imp_com')),
  rule('Morpheus', quirk('pro_actuator'), quirk('difficult_maintain')),
  rule('Morrigan', quirk('weak_legs')),
  rule('Naga', quirk('ext_twist'), quirk('bad_rep_clan'), quirk('no_arms')),
  rule('Naginata', quirk('cowl'), quirk('stable')),
  rule('Nexus', badReputation()),
  rule('Nexus II', quirk('ext_twist'), badReputation()),
  rule('Night Gyr', quirk('difficult_maintain')),
  rule('Night Hawk', quirk('easy_maintain')),
  rule('Night Wolf', quirk('directional_torso_mount', 'AMS'), quirk('hyper_actuator')),
  rule(
    'Nightstar',
    quirk('command_mech'),
    quirk('good_rep_1'),
    quirk('variable_range_targeting'),
    quirk('difficult_maintain'),
  ),
  rule('Ninja-To', quirk('stable')),
  rule('Nobori-nin (Huntsman)', quirk('stable')),
  rule('No-Dachi', quirk('hyper_actuator')),
  rule('Nova Cat', quirk('ext_twist'), quirk('exp_actuator')),
  rule('Nyx', quirk('low_profile'), quirk('difficult_maintain')),
  rule('O-Bakemono', quirk('no_arms')),
  rule('Omen', quirk('pro_actuator'), quirk('rugged_1')),
  rule('Onager', quirk('battle_fists_ra'), quirk('exp_actuator')),
  rule('Onslaught', quirk('pro_actuator'), quirk('non_standard')),
  rule('Orion', quirk('anti_air'), quirk('easy_maintain'), quirk('rugged_1')),
  rule('Orion IIC', quirk('anti_air'), quirk('easy_maintain'), quirk('rugged_1')),
  rule('Orochi', quirk('no_arms')),
  rule('Osiris', quirk('directional_torso_mount', 'CT'), quirk('ext_twist')),
  rule('Osprey', quirk('directional_torso_mount', 'RT'), quirk('no_arms')),
  rule('Osteon', quirk('ext_twist'), quirk('multi_trac'), quirk('pro_actuator'), quirk('bad_rep_clan')),
  rule('Ostroc', quirk('low_profile')),
  rule('Ostscout', quirk('imp_com'), quirk('imp_sensors'), quirk('low_profile'), quirk('rugged_1')),
  rule('Ostsol', quirk('imp_sensors'), quirk('low_profile')),
  rule('Ostwar', quirk('easy_maintain')),
  rule('Owens', quirk('imp_sensors')),
  rule('Pack Hunter', quirk('reinforced_legs')),
  rule('Paladin', quirk('difficult_maintain'), quirk('non_standard')),
  rule('Panther', quirk('imp_target_short'), quirk('nimble_jumper')),
  rule('Parash', quirk('low_profile')),
  rule('Pariah (Septicemia)', quirk('ext_twist'), quirk('multi_trac'), quirk('bad_rep_clan')),
  rule('Pathfinder', quirk('imp_sensors')),
  rule('Patriot', quirk('pro_actuator'), quirk('stable')),
  rule('Peacekeeper', quirk('rugged_1')),
  rule('Penetrator', quirk('good_rep_1'), quirk('stable')),
  rule('Penthesilea', quirk('rugged_1')),
  rule('Perseus', quirk('anti_air'), quirk('easy_maintain')),
  rule('Phantom', quirk('imp_sensors')),
  rule('Phoenix', quirk('directional_torso_mount', 'LT'), quirk('em_inter_whole')),
  rule('Phoenix Hawk', quirk('command_mech'), quirk('imp_com'), ubiquitous()),
  rule('Phoenix Hawk IIC', quirk('easy_maintain')),
  rule('Pillager', battleFists()),
  rule('Pinion', quirk('bad_rep_clan')),
  rule('Piranha', quirk('imp_target_short')),
  rule('Porcupine', quirk('distracting')),
  rule('Pouncer', quirk('weak_head_2')),
  rule('Predator', quirk('cramped_cockpit'), quirk('difficult_eject')),
  rule('Prefect', quirk('ext_twist')),
  rule('Preta', quirk('imp_com'), quirk('imp_sensors'), badReputation(), quirk('exp_actuator')),
  rule('Prometheus', quirk('non_standard'), quirk('prototype')),
  rule('Prowler', quirk('poor_life_support')),
  rule('Pulverizer', quirk('easy_maintain'), quirk('pro_actuator'), quirk('bad_rep_clan')),
  rule('Puma (Adder)', quirk('low_profile')),
  rule('Quickdraw', quirk('hyper_actuator'), quirk('exp_actuator')),
  rule('Rabid Coyote', quirk('imp_target_short'), quirk('bad_rep_clan')),
  rule('Raijin', quirk('directional_torso_mount', 'LT RT'), quirk('ext_twist'), badReputation()),
  rule('Raijin II', quirk('ext_twist'), badReputation()),
  rule('Rakshasa', quirk('easy_maintain'), quirk('weak_head_1')),
  rule('Rampage', quirk('vestigial_hands_ra'), badReputation(), quirk('obsolete', '2780')),
  rule('Raptor', quirk('easy_maintain')),
  rule('Raptor II', quirk('no_arms'), quirk('no_eject')),
  rule('Raven', quirk('no_arms')),
  rule('Razorback', quirk('low_profile'), quirk('no_arms')),
  rule('Red Shift', quirk('imp_com'), quirk('low_profile'), badReputation()),
  rule('Rifleman', quirk('anti_air'), quirk('imp_com'), quirk('searchlight'), ubiquitous()),
  rule('Rifleman II', quirk('anti_air'), quirk('imp_com'), quirk('searchlight')),
  rule('Rifleman IIC', quirk('anti_air'), quirk('imp_com')),
  rule('Ronin', quirk('non_standard')),
  rule('Rook', quirk('rugged_1')),
  rule('Ryoken (Stormcrow)', quirk('stable')),
  rule('Ryoken II', quirk('stable')),
  rule('Sagittaire', quirk('imp_target_short'), quirk('difficult_maintain'), quirk('weak_head_1')),
  rule('Salamander', quirk('difficult_maintain')),
  rule('Sasquatch', quirk('difficult_maintain')),
  rule('Savage Coyote', quirk('oversized')),
  rule('Scarabus', quirk('rugged_1')),
  rule('Scorpion', badReputation(), quirk('hard_pilot')),
  rule('Scylla', quirk('oversized')),
  rule('Sentinel', quirk('imp_com')),
  rule('Sentry', quirk('easy_maintain'), quirk('easy_pilot'), quirk('rugged_1'), ubiquitous()),
  rule('Seraph', quirk('imp_com'), quirk('imp_sensors'), badReputation()),
  rule('Sha Yu', quirk('imp_com')),
  rule('Shadow Cat', quirk('low_profile')),
  rule('Shadow Cat II', quirk('easy_maintain'), quirk('low_profile')),
  rule('Shadow Hawk', battleFists(), quirk('imp_life_support'), quirk('rugged_1'), ubiquitous()),
  rule('Shadow Hawk IIC', battleFists(), quirk('imp_life_support')),
  rule('Shen Yi', quirk('weak_head_1')),
  rule('Shockwave', battleFists(), quirk('easy_maintain')),
  rule('Shogun', barrelFists(), quirk('difficult_maintain'), quirk('non_standard')),
  rule('Shootist', quirk('command_mech')),
  rule('Shugenja', quirk('cowl'), quirk('hyper_actuator'), quirk('exp_actuator')),
  rule('Silver Fox', quirk('non_standard'), quirk('weak_head_1')),
  rule('Sirocco', quirk('directional_torso_mount', 'CT LT RT'), quirk('difficult_maintain')),
  rule('Slagmaiden', quirk('exp_actuator'), quirk('prototype')),
  rule('Sling', quirk('cramped_cockpit')),
  rule('Snake', quirk('imp_target_short'), quirk('pro_actuator')),
  rule('Snow Fox', quirk('low_profile'), quirk('hard_pilot')),
  rule('Solitaire', quirk('exp_actuator')),
  rule('Spartan', quirk('imp_sensors')),
  rule('Spatha', quirk('difficult_maintain'), quirk('non_standard')),
  rule('Spector', quirk('difficult_maintain'), quirk('rugged_1')),
  rule('Sphinx', quirk('easy_maintain'), quirk('rugged_1')),
  rule('Spider', quirk('easy_maintain'), quirk('nimble_jumper'), quirk('no_eject')),
  rule('Stag', quirk('imp_com'), quirk('imp_sensors'), quirk('bad_rep_clan')),
  rule('Stalker', quirk('combat_computer'), ubiquitous(), quirk('no_arms')),
  rule('Stalking Spider', quirk('stable')),
  rule('Starslayer', quirk('rugged_1')),
  rule('Stealth', quirk('imp_sensors')),
  rule('Stiletto', quirk('multi_trac'), quirk('difficult_eject')),
  rule('Stinger', quirk('rugged_1'), ubiquitous(), quirk('cramped_cockpit')),
  rule('Stooping Hawk', quirk('rugged_2')),
  rule('Strider', quirk('easy_pilot')),
  rule('Striker', quirk('easy_maintain')),
  rule('Sun Cobra', quirk('pro_actuator')),
  rule('Sunder', quirk('ext_twist')),
  rule('Supernova', quirk('imp_target_long')),
  rule('Tai-sho', quirk('imp_com')),
  rule('Talon', quirk('rugged_1'), quirk('no_arms')),
  rule('Talos', quirk('easy_pilot')),
  rule('Tarantula', quirk('easy_pilot'), quirk('ext_twist'), quirk('exp_actuator')),
  rule('Targe', quirk('ext_twist'), badReputation(), quirk('no_arms')),
  rule('Tempest', quirk('directional_torso_mount', 'HD')),
  rule('Templar', quirk('easy_maintain')),
  rule('Tessen', badReputation()),
  rule('Thanatos', quirk('stable')),
  rule('Thor (Summoner)', quirk('imp_com'), ubiquitous()),
  rule('Thorn', quirk('easy_maintain')),
  rule('Thresher', quirk('imp_target_med')),
  rule('Thug', quirk('rugged_1')),
  rule('Thunder', quirk('cowl')),
  rule('Thunder Fox', quirk('easy_maintain')),
  rule(
    'Thunder Hawk',
    quirk('command_mech'),
    quirk('good_rep_1'),
    quirk('variable_range_targeting'),
    quirk('difficult_maintain'),
  ),
  rule('Thunder Stallion', quirk('cramped_cockpit')),
  rule('Thunderbolt', quirk('multi_trac'), quirk('rugged_2'), ubiquitous()),
  rule("Ti Ts'ang", quirk('hyper_actuator')),
  rule('Titan', quirk('pro_actuator')),
  rule('Titan II', quirk('pro_actuator')),
  rule('Toro', quirk('cramped_cockpit')),
  rule('Toyama', badReputation()),
  rule('Trebaruna', quirk('command_mech')),
  rule('Trebuchet', quirk('easy_maintain')),
  rule('Tsunami', quirk('difficult_maintain')),
  rule('Tundra Wolf', quirk('easy_maintain'), quirk('weak_head_1')),
  rule('Turkina', quirk('easy_pilot')),
  rule('Uller (Kit Fox)', quirk('low_profile')),
  rule('UrbanMech', quirk('ext_twist'), quirk('low_profile'), quirk('no_arms')),
  rule('UrbanMech IIC', quirk('ext_twist'), quirk('low_profile'), quirk('no_arms')),
  rule('Ursus', quirk('distracting'), quirk('pro_actuator'), quirk('cramped_cockpit')),
  rule('Ursus II', quirk('distracting'), quirk('pro_actuator')),
  rule('Uziel', quirk('cowl'), badReputation(), quirk('exp_actuator')),
  rule('Valiant', quirk('imp_target_short'), quirk('pro_actuator'), quirk('weak_head_1')),
  rule('Valkyrie', quirk('easy_maintain'), quirk('imp_com')),
  rule('Vanquisher', quirk('stable'), badReputation(), quirk('no_arms')),
  rule('Venom', quirk('nimble_jumper'), quirk('difficult_eject')),
  rule('Verfolger', quirk('hyper_actuator'), quirk('difficult_maintain')),
  rule('Victor', quirk('rugged_1')),
  rule('Viking', quirk('easy_maintain'), quirk('multi_trac'), quirk('no_arms')),
  rule('Vindicator', quirk('rugged_1'), quirk('difficult_eject')),
  rule('Viper (Black Python)', quirk('imp_target_short')),
  rule('Vixen (Incubus)', quirk('no_arms')),
  rule('Volkh', quirk('non_standard')),
  rule('Von Rohrs (Hebi)', badReputation()),
  rule('Vulcan', quirk('low_profile')),
  rule('Vulture (Mad Dog)', quirk('imp_target_med')),
  rule('Wakazashi', quirk('difficult_maintain')),
  rule('Warhammer', quirk('rugged_2'), quirk('searchlight'), quirk('stable'), ubiquitous()),
  rule('Warhammer IIC', quirk('searchlight'), quirk('stable')),
  rule('Warlord', quirk('easy_maintain')),
  rule('Wasp', quirk('easy_maintain'), quirk('ext_twist'), ubiquitous()),
  rule('Watchman', quirk('easy_maintain'), quirk('easy_pilot'), quirk('rugged_1')),
  rule('Werewolf', quirk('non_standard')),
  rule('White Flame', quirk('directional_torso_mount', 'LT RT'), badReputation(), quirk('exp_actuator')),
  rule('Whitworth', quirk('rugged_1'), quirk('weak_legs')),
  rule('Wight', quirk('exp_actuator'), quirk('weak_legs')),
  rule('Wildfire', quirk('non_standard'), quirk('prototype')),
  rule('Wolf Trap (Tora)', badReputation()),
  rule('Wolfhound', quirk('easy_maintain'), quirk('good_rep_1')),
  rule(
    'Wolverine',
    quirk('command_mech'),
    quirk('ext_twist'),
    quirk('imp_com'),
    quirk('pro_actuator'),
    ubiquitous(),
    quirk('cramped_cockpit'),
  ),
  rule('Wolverine II', quirk('command_mech'), quirk('imp_com'), quirk('pro_actuator')),
  rule('Woodsman', quirk('easy_maintain')),
  rule('Wraith', ubiquitous(), quirk('difficult_maintain')),
  rule('Wyvern', quirk('rugged_1')),
  rule('Wyvern IIC', quirk('pro_actuator')),
  rule('Xanthos', quirk('imp_life_support')),
  rule('Yao Lien', quirk('non_standard')),
  rule('Yeoman', quirk('no_arms')),
  rule('Ymir', quirk('stable')),
  rule('Yu Huang', quirk('command_mech'), quirk('good_rep_1')),
  rule('Zeus', quirk('barrel_fists_ra'), quirk('easy_maintain')),
];

const TORSO_LOCATIONS = ['CT', 'LT', 'RT'] as const;
const LEG_LOCATIONS = ['LL', 'RL'] as const;

export const BMM_CHASSIS_WEAPON_QUIRKS: readonly BmmChassisWeaponRule[] = [
  weaponRule('Avatar', weapon('stable_weapon', 'Medium Laser', ['CT'])),
  weaponRule('BattleMaster', weapon('jettison_capable', 'PPC')),
  weaponRule('Banzai', weapon('stable_weapon', 'Large Pulse Laser', ['RA'])),
  weaponRule('Blade', weapon('mod_weapons'), weapon('exposed_linkage', 'Rotary AC/5'), weapon('static_feed')),
  weaponRule('Bowman', weapon('fast_reload', 'Arrow IV')),
  weaponRule('Brahma', weapon('stable_weapon', 'LAC/5')),
  weaponRule('Cestus', weapon('stable_weapon', 'Gauss Rifle')),
  weaponRule('Corvis', weapon('mod_weapons')),
  weaponRule('Crusader', weapon('stable_weapon', undefined, LEG_LOCATIONS)),
  weaponRule('Crossbow', weapon('mod_weapons', 'LRM 10')),
  weaponRule('Cygnus', weapon('exposed_linkage'), weapon('static_feed')),
  weaponRule('Daboku', weapon('stable_weapon', 'Autocannon')),
  weaponRule('Dragoon', weapon('mod_weapons')),
  weaponRule('Emperor', weapon('imp_cooling', 'Large Laser', ['LA', 'RA'])),
  weaponRule(
    'Enforcer',
    weapon('fast_reload', 'AC/10'),
    weapon('imp_cooling', 'AC/10'),
    weapon('ammo_feed_problems', 'AC/10'),
  ),
  weaponRule('Enforcer III', weapon('fast_reload', 'Ultra AC/10')),
  weaponRule('Fafnir', weapon('stable_weapon', 'Heavy Gauss Rifle', ['LT', 'RT'])),
  weaponRule('Firestarter', weapon('exposed_linkage', 'Flamer', ['LA', 'RA'])),
  weaponRule('Flashfire', weapon('mod_weapons', 'Fluid Gun')),
  weaponRule('Gallant', weapon('stable_weapon', 'Large Pulse Laser', ['RA'])),
  weaponRule('Griffin', weapon('jettison_capable', 'PPC')),
  weaponRule('Hitman', weapon('accurate', 'TAG'), weapon('stable_weapon', 'TAG')),
  weaponRule('Hatamoto', weapon('mod_weapons', 'SRM', TORSO_LOCATIONS)),
  weaponRule('Hollander', weapon('stable_weapon', 'Gauss Rifle')),
  weaponRule('Hollander II', weapon('stable_weapon', 'Gauss Rifle')),
  weaponRule('Jackal', weapon('imp_cooling', 'ER PPC')),
  weaponRule('Kuma', weapon('accurate', 'Heavy Large Laser')),
  weaponRule('Legionnaire', weapon('exposed_linkage')),
  weaponRule('Man O War (Gargoyle)', weapon('stable_weapon', undefined, ['LA', 'RA'])),
  weaponRule('Marauder', weapon('exposed_linkage', 'AC/5')),
  weaponRule('Mauler', weapon('stable_weapon', 'Autocannon')),
  weaponRule('Mjolnir', weapon('accurate', 'Mace')),
  weaponRule('Mongoose', weapon('stable_weapon', 'Small Laser'), weapon('stable_weapon', 'Medium Laser', ['CT'])),
  weaponRule('Mercury', weapon('mod_weapons')),
  weaponRule('Mercury II', weapon('stable_weapon', 'Medium Laser', ['CT'])),
  weaponRule('Morrigan', weapon('stable_weapon', 'Heavy Large Laser')),
  weaponRule('Nightsky', weapon('mod_weapons', 'Hatchet')),
  weaponRule('O-Bakemono', weapon('mod_weapons')),
  weaponRule('Ocelot', weapon('jettison_capable', 'Medium Laser', ['RA'])),
  weaponRule('Onager', weapon('exposed_linkage', 'HAG/30')),
  weaponRule('Pack Hunter II', weapon('stable_weapon', 'ER PPC')),
  weaponRule('Parash', weapon('jettison_capable', 'Large Pulse Laser')),
  weaponRule('Penthesilea', weapon('stable_weapon', 'ER Medium Laser', ['CT'])),
  weaponRule('Peregrine (Horned Owl)', weapon('stable_weapon', undefined, ['CT'])),
  weaponRule('Phoenix Hawk', weapon('jettison_capable', 'Large Laser')),
  weaponRule('Phoenix Hawk IIC', weapon('fast_reload', undefined, TORSO_LOCATIONS)),
  weaponRule('Pulverizer', weapon('accurate', 'Enhanced PPC')),
  weaponRule('Red Shift', weapon('accurate', 'TAG')),
  weaponRule('Sentinel', weapon('ammo_feed_problems', 'SRM 2')),
  weaponRule('Shockwave', weapon('exposed_linkage', 'Rotary AC/5')),
  weaponRule('Slagmaiden', weapon('jettison_capable', 'Shield')),
  weaponRule('Solitaire', weapon('imp_cooling', 'Heavy Large Laser'), weapon('stable_weapon', 'Heavy Large Laser')),
  weaponRule('Spirit', weapon('jettison_capable', 'Streak SRM 4')),
  weaponRule('Stag', weapon('stable_weapon', 'ER Large Laser', ['RA'])),
  weaponRule('Tai-sho', weapon('stable_weapon', 'Ultra AC/10')),
  weaponRule('Trebuchet', weapon('fast_reload', undefined, TORSO_LOCATIONS)),
  weaponRule('Vixen (Incubus)', weapon('jettison_capable', 'Large Pulse Laser')),
  weaponRule('War Dog', weapon('accurate', 'Streak SRM 2 (OS)'), weapon('fast_reload', 'Streak SRM 2 (OS)')),
  weaponRule('Wolverine', weapon('jettison_capable', 'AC/5')),
];

const rulesByChassis = new Map(BMM_CHASSIS_QUIRKS.map((entry) => [normalizeLooseText(entry.chassis), entry]));
const weaponRulesByChassis = new Map(
  BMM_CHASSIS_WEAPON_QUIRKS.map((entry) => [normalizeLooseText(entry.chassis), entry]),
);

function resolveKey(entity: BaseEntity, key: string): string {
  if (key === 'ubiquitous') return entity.techBase() === 'Clan' ? 'ubiquitous_clan' : 'ubiquitous_is';
  if (key === 'bad_rep') return entity.techBase() === 'Clan' ? 'bad_rep_clan' : 'bad_rep_is';
  return key;
}

function expandQuirks(entity: BaseEntity, source: readonly BmmChassisQuirk[]): BmmChassisQuirk[] {
  return source.flatMap((entry) => {
    if (entry.key === 'battle_fists') return [quirk('battle_fists_la'), quirk('battle_fists_ra')];
    if (entry.key === 'barrel_fists') return [quirk('barrel_fists_la'), quirk('barrel_fists_ra')];
    if (entry.key === 'vestigial_hands') return [quirk('vestigial_hands_la'), quirk('vestigial_hands_ra')];
    return [quirk(resolveKey(entity, entry.key), entry.value)];
  });
}

/**
 * BMM rows key off the canonical "Inner Sphere (Clan)" name, `chassis (clanName)`, never the
 * options-controlled display-name format. The bare chassis is the fallback for split tables.
 */
function bmmChassisNames(entity: BaseEntity): readonly string[] {
  const chassis = entity.chassis();
  const clanName = entity.clanName();
  return (clanName ? [`${chassis} (${clanName})`, chassis] : [chassis]).map(normalizeLooseText);
}

function chassisRow<T extends { readonly chassis: string }>(
  rows: ReadonlyMap<string, T>,
  entity: BaseEntity,
): T | undefined {
  for (const name of bmmChassisNames(entity)) {
    const row = rows.get(name);
    if (row) return row;
  }
  return undefined;
}

function addChassisQuirks(entity: BaseEntity, catalog: ReadonlyMap<string, Quirk>): void {
  const row = chassisRow(rulesByChassis, entity);
  if (!row) return;
  const assigned = new Set(entity.quirks().map((entry) => entry.quirk.key));
  const additions = expandQuirks(entity, row.quirks).flatMap((assignment) => {
    const definition = catalog.get(assignment.key);
    if (!definition || assigned.has(assignment.key)) return [];
    assigned.add(assignment.key);
    return [assignment.value === undefined ? { quirk: definition } : { quirk: definition, value: assignment.value }];
  });
  if (additions.length) entity.quirks.update((rows) => [...rows, ...additions]);
}

function mountNames(mount: EntityMountedEquipment): readonly string[] {
  return [mount.equipmentId, mount.equipment?.name, ...(mount.equipment?.aliases ?? [])]
    .filter((name): name is string => !!name)
    .map(normalizeLooseText);
}

function weaponNameMatches(mount: EntityMountedEquipment, target: string): boolean {
  const normalizedTarget = normalizeLooseText(target);
  if (mountNames(mount).includes(normalizedTarget)) return true;
  const equipment = mount.equipment;
  if (normalizedTarget === 'shield') return equipment?.hasFlag('F_SHIELD') === true;
  if (!(equipment instanceof WeaponEquipment)) return false;
  if (normalizedTarget === 'autocannon') return ['AC', 'LBX_AC'].includes(equipment.weapon.atClass ?? '');
  if (normalizedTarget === 'srm') return equipment.ammoType === 'SRM';
  return false;
}

function weaponAssignmentMatches(mount: EntityMountedEquipment, assignment: BmmWeaponQuirk): boolean {
  return (
    (!assignment.locations?.length || assignment.locations.includes(mount.location)) &&
    (!assignment.names?.length || assignment.names.some((name) => weaponNameMatches(mount, name)))
  );
}

export function applyBmmWeaponQuirks(entity: BaseEntity, mounts: readonly EntityMountedEquipment[]): void {
  if (!isMekEntity(entity)) return;
  const row = chassisRow(weaponRulesByChassis, entity);
  if (!row) return;
  const assigned = new Set(
    entity.weaponQuirks().flatMap((entry) => {
      const mount = weaponQuirkMount(entity, entry);
      return mount ? [`${entry.name}|${mount.mountId}`] : [];
    }),
  );
  const additions: EntityWeaponQuirk[] = [];
  for (const mount of mounts) {
    if (!canHaveWeaponQuirks(mount)) continue;
    for (const assignment of row.quirks) {
      const identity = `${assignment.key}|${mount.mountId}`;
      if (assigned.has(identity) || !weaponAssignmentMatches(mount, assignment)) continue;
      assigned.add(identity);
      additions.push({ name: assignment.key, ...weaponQuirkAddress(entity, mount) });
    }
  }
  if (additions.length) entity.weaponQuirks.update((rows) => [...rows, ...additions]);
}

/**
 * Add every BattleMech Manual row entry this design is missing, called when the chassis or clan name
 * changes. Applicability is deliberately not checked here: suppressed assignments stay stored and
 * become visible and active again through `applicableQuirks` / `applicableWeaponQuirks` once the
 * design allows them.
 */
export function applyBmmQuirks(entity: BaseEntity, catalog: ReadonlyMap<string, Quirk>): void {
  if (!isMekEntity(entity)) return;
  addChassisQuirks(entity, catalog);
  applyBmmWeaponQuirks(
    entity,
    entity.equipment().filter((mount) => canAssignWeaponQuirks(entity, mount)),
  );
}
