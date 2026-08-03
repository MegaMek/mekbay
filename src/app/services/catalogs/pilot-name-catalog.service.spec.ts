/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import type { CompactPilotNameCatalog } from '../../models/pilot-name-catalog.model';
import { generatePilotName } from '../../utils/pilot-name-generator.util';
import { expandCompactPilotNameCatalog, normalizePilotNameCatalog } from './pilot-name-catalog.service';

describe('pilot name catalog validation', () => {
    it('expands scalar and weighted compact entries with indexed faction mappings', () => {
        const compact: CompactPilotNameCatalog = {
            v: 1,
            n: [
                [['John', ['Jack', 2]]],
                [['Jane']],
                [['Smith']],
            ],
            c: ['Ace', ['Specter', 3]],
            f: [['General', [1], [[1]]]],
            m: [[27, 0, 0]],
            bc: [['CW', 0, 2807, 9999, 0, []]],
            b: [['Kerensky', 'CW', 'Mek', 1, 2807, 0, 0, 0, [], [], 0]],
        };

        const expanded = expandCompactPilotNameCatalog(compact);
        expect(expanded.maleGivenNames[1]).toEqual([
            { value: 'John', weight: 1 },
            { value: 'Jack', weight: 2 },
        ]);
        expect(expanded.callsigns[1]).toEqual({ value: 'Specter', weight: 3 });
        expect(expanded.factions['General'].surnameEthnicities).toEqual([{ value: 1, weight: 1 }]);
        expect(expanded.factionProfiles).toEqual({ 27: { generator: 'General', isClan: false } });
        expect(expanded.bloodnames[0].name).toBe('Kerensky');
        const randomSequence = (...values: number[]) => {
            let index = 0;
            return () => values[index++] ?? 0;
        };
        expect(generatePilotName(expanded, { factionId: 27, includeCallsign: false }, randomSequence(0, 0, 0.5, 0, 0)))
            .toBe('John Smith');
        expect(generatePilotName(expanded, { factionId: 27, includeCallsign: true }, randomSequence(0, 0, 0.5, 0, 0, 0)))
            .toBe('John "Ace" Smith');
    });

    it('rejects unsupported or absent catalog versions', () => {
        expect(() => normalizePilotNameCatalog({ v: 0, n: [], c: [], f: [], m: [] }))
            .toThrowError('pilot name catalog uses an unsupported version');
        expect(() => normalizePilotNameCatalog(null))
            .toThrowError('pilot name catalog uses an unsupported version');
    });
});