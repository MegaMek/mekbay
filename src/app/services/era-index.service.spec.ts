// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MULFaction } from '../models/mulfactions.model';
import { EraIndexService } from './era-index.service';

describe('EraIndexService', () => {
    it('exposes the complete application-owned era chronology without external data', () => {
        const service = new EraIndexService();

        expect(service.getEras()).toHaveSize(12);
        expect(service.getEraById(9)).toEqual(jasmine.objectContaining({
            name: 'Age of War',
            years: { from: 2005, to: 2570 },
        }));
        expect(service.getEraByName('ilClan')?.id).toBe(257);
    });

    it('derives era unit and faction memberships from non-empty faction entries', () => {
        const service = new EraIndexService();
        const draconisCombine = faction(27, {
            9: new Set([8297]),
            10: new Set(),
        });
        const federatedSuns = faction(5, {
            9: new Set([8297, 9000]),
        });

        const prepared = service.prepareFromFactions([draconisCombine, federatedSuns]);
        const ageOfWar = prepared.eraIdMap.get(9)!;
        const starLeague = prepared.eraIdMap.get(10)!;

        expect(ageOfWar.units).toEqual(new Set([8297, 9000]));
        expect(ageOfWar.factions).toEqual(new Set([27, 5]));
        expect(starLeague.units).toEqual(new Set());
        expect(starLeague.factions).toEqual(new Set());

        service.commitPreparedIndex(prepared);
        expect(service.getEraById(9)).toBe(ageOfWar);
    });

    it('rejects faction membership for an unknown era', () => {
        const service = new EraIndexService();

        expect(() => service.prepareFromFactions([faction(27, { 999: new Set([8297]) })]))
            .toThrowError(/unknown era 999/u);
    });
});

function faction(id: number, eras: MULFaction['eras']): MULFaction {
    return {
        id,
        name: `Faction ${id}`,
        group: 'Inner Sphere',
        img: '',
        eras,
    };
}
