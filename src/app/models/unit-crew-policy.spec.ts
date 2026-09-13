// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { unitCrewKind, unitCrewSkillSet, crewSkillsForUnit } from './unit-crew-policy';

describe('unit crew policy', () => {
    it('selects independent ground and aerospace ratings, including vehicle VTOLs and both LAM pairs', () => {
        const skills = { gunnery: 2, piloting: 6, aeroGunnery: 5, aeroPiloting: 3 };
        expect(unitCrewSkillSet('VTOL', 'Combat Vehicle')).toBe('ground');
        expect(crewSkillsForUnit(skills, 'VTOL', 'Combat Vehicle')).toEqual({ gunnery: 2, piloting: 6 });
        expect(crewSkillsForUnit(skills, 'Mek', 'BattleMek')).toEqual({ gunnery: 2, piloting: 6 });
        expect(crewSkillsForUnit(skills, 'Aero', 'Aerospace Fighter')).toEqual({ gunnery: 5, piloting: 3 });
        expect(unitCrewSkillSet('Mek', 'Land-Air BattleMek')).toBe('both');
        expect(crewSkillsForUnit(skills, 'Mek', 'Land-Air BattleMek')).toEqual({ gunnery: 2, piloting: 3 });
        expect(crewSkillsForUnit({ gunnery: 1, piloting: 1 }, 'Aero', 'Aerodyne Small Craft')).toEqual({ gunnery: 4, piloting: 5 });
    });
    it('distinguishes crewless equipment, integrated infantry, and swappable crew', () => {
        expect(unitCrewKind('Building', 'Building')).toBe('none');
        expect(unitCrewKind('Handheld Weapon', 'Handheld Weapon')).toBe('none');
        expect(unitCrewKind('Tank', 'Support Vehicle', 0)).toBe('none');
        expect(unitCrewKind('Infantry', 'Conventional Infantry')).toBe('integrated');
        expect(unitCrewKind('Infantry', 'Mechanized Conventional Infantry')).toBe('integrated');
        expect(unitCrewKind('Infantry', 'Battle Armor')).toBe('swappable');
        expect(unitCrewKind('ProtoMek', 'ProtoMek')).toBe('swappable');
        expect(unitCrewKind('Mek', 'Tripod BattleMek')).toBe('swappable');
    });
});
