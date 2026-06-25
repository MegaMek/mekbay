import { getMotiveModesByUnit } from './motiveModes.model';
import type { Unit } from './units.model';

function createUnit(overrides: Partial<Unit> = {}): Unit {
    return {
        type: 'Mek',
        subtype: 'Biped',
        walk: 5,
        walk2: 0,
        run: 8,
        run2: 0,
        jump: 5,
        umu: 0,
        ...overrides,
    } as Unit;
}

describe('motiveModes', () => {
    it('omits stationary for airborne LAMs', () => {
        const unit = createUnit({ subtype: 'Land-Air BattleMek' });

        expect(getMotiveModesByUnit(unit, true)).not.toContain('stationary');
        expect(getMotiveModesByUnit(unit, true)).toContain('walk');
        expect(getMotiveModesByUnit(unit, true)).toContain('run');
    });

    it('keeps stationary for grounded LAMs and non-LAM airborne units', () => {
        expect(getMotiveModesByUnit(createUnit({ subtype: 'Land-Air BattleMek' }), false)).toContain('stationary');
        expect(getMotiveModesByUnit(createUnit({ moveType: 'VTOL' }), true)).toContain('stationary');
    });
});