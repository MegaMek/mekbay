import { MiscEquipment } from '../../equipment.model';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { VtolEntity } from '../entities/vehicle/vtol-entity';
import { EntityMountedEquipment } from '../types';

describe('getEquipmentBV', () => {
    let entity: BipedMekEntity;

    beforeEach(() => {
        entity = new BipedMekEntity();
        entity.tonnage.set(75);
        entity.originalWalkMP.set(3);
    });

    const cases: Array<[string, string[], number]> = [
        ['hatchet', ['F_CLUB', 'S_HATCHET'], 22.5],
        ['sword', ['F_CLUB', 'S_SWORD'], 15.525],
        ['lance', ['F_CLUB', 'S_LANCE'], 15],
        ['mace', ['F_CLUB', 'S_MACE'], 19],
        ['retractable blade', ['F_CLUB', 'S_RETRACTABLE_BLADE'], 13.8],
        ['claw', ['F_HAND_WEAPON', 'S_CLAW'], 14.025],
        ['talons', ['F_TALON'], 8],
    ];

    for (const [name, flags, expectedBV] of cases) {
        it(`resolves ${name}`, () => {
            expect(mount(name, 'RA', variableEquipment(name, flags)).getBV(entity)).toBe(expectedBV);
        });
    }

    it('uses installed TSM', () => {
        entity.equipment.set([mount('tsm', 'CT', fixedEquipment('tsm', ['F_TSM']))]);

        expect(mount('hatchet', 'RA', variableEquipment('hatchet', ['F_CLUB', 'S_HATCHET'])).getBV(entity)).toBe(45);
    });

    it('counts distinct torso locations containing spikes for ram plate damage', () => {
        const spikes = fixedEquipment('spikes', ['F_SPIKES']);
        entity.equipment.set([
            mount('left-spikes', 'LT', spikes),
            mount('left-spikes-duplicate', 'LT', spikes),
            mount('right-spikes', 'RT', spikes),
            mount('leg-spikes', 'LL', spikes),
        ]);

        expect(mount('ram-plate', 'CT', variableEquipment('ram plate', ['F_RAM_PLATE'])).getBV(entity)).toBe(22);
    });

    it('passes through fixed BV', () => {
        expect(mount('fixed', 'CT', fixedEquipment('fixed', [], 25)).getBV(entity)).toBe(25);
    });

    it('adds the VTOL mast-mount bonus to eligible rotor equipment', () => {
        const vtol = new VtolEntity();
        const mastMount = mount('mast', 'Rotor', fixedEquipment('mast', ['F_MAST_MOUNT']));
        const ecm = mount('ecm', 'Rotor', fixedEquipment('ecm', ['F_ECM'], 20));
        vtol.equipment.set([mastMount, ecm]);

        expect(ecm.getBV(vtol)).toBe(30);
        expect(ecm.clone({ location: 'Body' }).getBV(vtol)).toBe(20);
    });

    it('returns zero for variable BV handled by specialized calculators', () => {
        expect(mount('aes', 'RA', variableEquipment('AES', ['F_ACTUATOR_ENHANCEMENT_SYSTEM'])).getBV(entity)).toBe(0);
        expect(mount('armor', 'CT', variableEquipment('modular armor', ['F_MODULAR_ARMOR'])).getBV(entity)).toBe(0);
        expect(mount('mast', 'HD', variableEquipment('mast mount', ['F_MAST_MOUNT'])).getBV(entity)).toBe(0);
    });
});

function variableEquipment(name: string, flags: string[]): MiscEquipment {
    return new MiscEquipment({ id: name, name, type: 'misc', flags, stats: { bv: 'variable' } });
}

function fixedEquipment(name: string, flags: string[], bv = 0): MiscEquipment {
    return new MiscEquipment({ id: name, name, type: 'misc', flags, stats: { bv } });
}

function mount(mountId: string, location: string, equipment: MiscEquipment): EntityMountedEquipment {
    return new EntityMountedEquipment({
        mountId,
        equipmentId: equipment.id,
        equipment,
        location,
        rearMounted: false,
        turretMounted: false,
        omniPodMounted: false,
        armored: false,
    });
}