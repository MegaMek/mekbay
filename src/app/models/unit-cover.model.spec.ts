// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { deserializeUnitCover, resolveUnitBuildingCoverState, resolveUnitWaterState, serializeUnitCover } from './unit-cover.model';

describe('unit cover', () => {
    it('serializes water depths as 3, 4, and 5', () => {
        expect(serializeUnitCover('underwater-depth-1')).toBe(3);
        expect(serializeUnitCover('underwater-depth-2')).toBe(4);
        expect(serializeUnitCover('underwater-depth-3')).toBe(5);
        expect(deserializeUnitCover(3)).toBe('underwater-depth-1');
        expect(deserializeUnitCover(4)).toBe('underwater-depth-2');
        expect(deserializeUnitCover(5)).toBe('underwater-depth-3');
    });

    it('serializes building levels as 6 and 7', () => {
        expect(serializeUnitCover('building-1')).toBe(6);
        expect(serializeUnitCover('building-2')).toBe(7);
        expect(serializeUnitCover('building-3')).toBe(8);
        expect(deserializeUnitCover(6)).toBe('building-1');
        expect(deserializeUnitCover(7)).toBe('building-2');
        expect(deserializeUnitCover(8)).toBe('building-3');
    });

    it('resolves water cover from water level and current unit height', () => {
        expect(resolveUnitWaterState('underwater-depth-1', 1)).toEqual({ partiallyUnderwater: false, submerged: true });
        expect(resolveUnitWaterState('underwater-depth-1', 2)).toEqual({ partiallyUnderwater: true, submerged: false });
        expect(resolveUnitWaterState('underwater-depth-1', 3)).toEqual({ partiallyUnderwater: false, submerged: false });
        expect(resolveUnitWaterState('underwater-depth-2', 3)).toEqual({ partiallyUnderwater: true, submerged: false });
        expect(resolveUnitWaterState('underwater-depth-2', 2)).toEqual({ partiallyUnderwater: false, submerged: true });
        expect(resolveUnitWaterState('underwater-depth-3', 3)).toEqual({ partiallyUnderwater: false, submerged: true });
    });

    it('resolves building cover from unit height and posture', () => {
        expect(resolveUnitBuildingCoverState('building-1', 1)).toEqual({ effect: 'heavy', modifier: 2 });
        expect(resolveUnitBuildingCoverState('building-2', 1)).toEqual({ effect: 'heavy', modifier: 2 });
        expect(resolveUnitBuildingCoverState('building-1', 2)).toEqual({ effect: 'partial', modifier: 1 });
        expect(resolveUnitBuildingCoverState('building-2', 2)).toEqual({ effect: 'heavy', modifier: 2 });
        expect(resolveUnitBuildingCoverState('building-1', 3)).toEqual({ effect: 'none', modifier: 0 });
        expect(resolveUnitBuildingCoverState('building-2', 3)).toEqual({ effect: 'partial', modifier: 1 });
    });
});
