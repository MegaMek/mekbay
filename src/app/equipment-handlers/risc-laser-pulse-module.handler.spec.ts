
import { componentRiscLaserPulseDefinition } from '../models/runtime/component-risc-laser-pulse';
import { emptyCBTEncounterSnapshot } from '../models/runtime/encounter-runtime';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import { createDirectRiscLaserPulseRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    RISC_LASER_PULSE_MODE,
    RISC_LASER_STANDARD_MODE,
    RiscLaserPulseModuleHandler,
} from '../models/runtime/component-risc-laser-pulse';

describe('RiscLaserPulseModuleHandler', () => {
    const handler = new RiscLaserPulseModuleHandler();

    it('offers and dispatches canonical modes from the direct entity/runtime pair', () => {
        const fixture = createDirectRiscLaserPulseRuntimeFixture();
        const module = fixture.equipmentComponent('Test RISC Laser Pulse Module');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const definition = componentRiscLaserPulseDefinition(fixture.index, module.id, laser.id);
        const runtime = fixture.instance;

        expect(handler.getComponentRiscLaserPulseChoices(runtime, definition, {} as never)[0])
            .toEqual(jasmine.objectContaining({
                value: RISC_LASER_STANDARD_MODE,
                choices: [
                    { label: 'STD', value: RISC_LASER_STANDARD_MODE },
                    { label: 'PULSE', value: RISC_LASER_PULSE_MODE },
                ],
            }));
        expect(handler.handleComponentRiscLaserPulseSelection(
            runtime,
            definition,
            { value: RISC_LASER_PULSE_MODE } as never,
            {} as never,
        )).toBeTrue();
        expect(fixture.instance.query().componentMode(laser.id)).toBe(RISC_LASER_PULSE_MODE);
        expect(handler.handleComponentRiscLaserPulseSelection(
            runtime,
            definition,
            { value: 'bad' } as never,
            {} as never,
        )).toBeFalse();
    });

    it('calculates Pulse heat and to-hit directly and stops when the module is disabled', () => {
        const fixture = createDirectRiscLaserPulseRuntimeFixture();
        const module = fixture.equipmentComponent('Test RISC Laser Pulse Module');
        const laser = fixture.equipmentComponent('ISMediumLaser');
        const panelRow = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(row => row.componentId === laser.id)!;

        expect(fixture.instance.dispatch({
            type: 'set-component-mode',
            
            
            componentId: laser.id,
            mode: RISC_LASER_PULSE_MODE,
        }).accepted).toBeTrue();
        expect(panelRow().weapon).toEqual(jasmine.objectContaining({
            heat: 5,
            firingHeat: 5,
        }));
        expect(panelRow().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'RISC Laser Pulse Module',
            modifier: -2,
        }));

        expect(fixture.instance.dispatch({
            type: 'fire-weapons',
            
            
            heatPolicy: 'manual',
            selections: [{ weaponId: laser.id }],
        }).accepted).toBeTrue();
        expect(fixture.instance.query().turnState().weaponsHeat).toBe(5);

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            
            
            componentId: module.id,
            status: 'disabled',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(panelRow().weapon).toEqual(jasmine.objectContaining({
            heat: 3,
            firingHeat: 3,
        }));
        expect(panelRow().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'RISC Laser Pulse Module Inactive',
            modifier: 0,
        }));
    });
});
