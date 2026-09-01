
import {
    applyComponentApolloWeaponTypes,
    ApolloHandler,
    componentApolloDefinition,
} from '../models/runtime/component-apollo';
import { emptyCBTEncounterSnapshot } from '../models/runtime/encounter-runtime';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import { createDirectApolloRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import {
    APOLLO_SATURATION_MODE,
    APOLLO_STANDARD_MODE,
} from '../models/apollo-mode.model';

describe('ApolloHandler', () => {
    const handler = new ApolloHandler();

    it('dispatches the Core saturation mode and applies AE from entity plus runtime state', () => {
        const fixture = createDirectApolloRuntimeFixture('core-2026');
        const source = fixture.equipmentComponent('Test Apollo');
        const parent = fixture.equipmentComponent('Test MRM');
        const definition = componentApolloDefinition(
            fixture.index,
            source.id,
            parent.id,
            fixture.instance.ruleset(),
        );
        const runtime = fixture.instance;
        const baseTypes = new Set(['C', 'M'] as const);

        expect(handler.getComponentApolloChoices(runtime, definition, {} as never)[0])
            .toEqual(jasmine.objectContaining({
                value: APOLLO_STANDARD_MODE,
                disabled: false,
            }));
        expect(handler.handleComponentApolloSelection(
            runtime,
            definition,
            { value: APOLLO_SATURATION_MODE } as never,
            {} as never,
        )).toBeTrue();
        expect([...applyComponentApolloWeaponTypes(
            fixture.index,
            fixture.instance.query(),
            parent.id,
            fixture.instance.ruleset(),
            baseTypes,
        )]).toEqual(['C', 'M', 'AE']);
        expect([...baseTypes]).toEqual(['C', 'M']);
        expect(handler.handleComponentApolloSelection(
            runtime,
            definition,
            { value: 'bad' } as never,
            {} as never,
        )).toBeFalse();

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            
            
            componentId: source.id,
            status: 'disabled',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(handler.getComponentApolloChoices(runtime, definition, {} as never)[0])
            .toEqual(jasmine.objectContaining({
                value: APOLLO_STANDARD_MODE,
                disabled: true,
            }));
        expect([...applyComponentApolloWeaponTypes(
            fixture.index,
            fixture.instance.query(),
            parent.id,
            fixture.instance.ruleset(),
            baseTypes,
        )]).toEqual(['C', 'M']);
    });

    it('projects the Total Warfare passive bonus and weakens it when Apollo is unavailable', () => {
        const fixture = createDirectApolloRuntimeFixture('total-warfare');
        const source = fixture.equipmentComponent('Test Apollo');
        const parent = fixture.equipmentComponent('Test MRM');
        const definition = componentApolloDefinition(
            fixture.index,
            source.id,
            parent.id,
            fixture.instance.ruleset(),
        );
        const runtime = fixture.instance;
        const row = () => projectMekEquipmentPanel(
            fixture.entity,
            fixture.index,
            fixture.instance.ruleset(),
            fixture.instance.query(),
            emptyCBTEncounterSnapshot(),
        ).components.find(component => component.componentId === parent.id)!;

        expect(handler.getComponentApolloChoices(runtime, definition, {} as never)).toEqual([]);
        expect(row().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Apollo Fire Control System',
            modifier: -1,
            weakened: false,
        }));

        expect(fixture.instance.dispatch({
            type: 'set-component-status',
            
            
            componentId: source.id,
            status: 'destroyed',
            target: 'committed',
        }).accepted).toBeTrue();
        expect(row().weapon?.hitModifierBreakdown).toContain(jasmine.objectContaining({
            label: 'Apollo Fire Control System Destroyed',
            modifier: 0,
            weakened: true,
        }));
    });
});
