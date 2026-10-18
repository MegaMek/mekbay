// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal, type Injector } from '@angular/core';
import { CBTUnitService } from '../../../services/cbt-unit.service';
import type { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { ForceCustomDesignsService } from '../../../services/force-custom-designs.service';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { ToastService } from '../../../services/toast.service';
import { MM_DATA_UNIT_PROVIDER_ID } from '../../../services/unit-catalog/unit-catalog.types';
import { CBTForce } from '../../cbt-force.model';
import type { CBTRuleset } from '../../cbt-ruleset.model';
import { GameSystem } from '../../common.model';
import type { MekEntity } from '../../entity/entities/mek/mek-entity';
import type { SerializedCBTForce } from '../../force-serialization';
import type { UnitSummary } from '../../unit-summary.model';
import { restoreMekUnit } from '../cbt-mek-unit';
import { restoreNonMekUnit } from '../cbt-non-mek-unit';
import { isCBTMekUnit,type CBTUnit } from '../cbt-unit';
import { isSerializedNonMekUnit,type SerializedNonMekUnit } from '../non-mek-unit-persistence';
import {
CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
asForceId,
emptyRuntimeHistory,
type SerializedCBTUnitV2,
} from '../persistence-v2';
import type { ScenarioRules } from '../unit-state-initializer';

/** The scenario the fixture options bind for `ruleset`, with the default optional rules. */
export function fixtureScenario(ruleset: CBTRuleset): ScenarioRules {
    return { id: 'megamek', ruleset, options: { forcedWithdrawal: true, sprinting: false, hotLoadedAmmo: false } };
}

export interface CBTForceFixture {
    readonly force: CBTForce;
    /** The application rules: a reload binds to them, as a page load does. */
    readonly options: ReturnType<typeof signal<{ CBTRules: CBTRuleset; CBTOptionalRules: Readonly<Record<string, boolean>> }>>;
    readonly toast: jasmine.SpyObj<ToastService>;
    /** Loads a saved force through the same services, under the current options. */
    reload(record: SerializedCBTForce): Promise<CBTForce>;
}

/**
 * A loaded CBT force over ready units, as the app restores it: each saved unit is restored through
 * the unit codecs under the rules in the options when it loads.
 */
export async function loadCBTForceFixture(
    units: readonly CBTUnit[],
    ruleset: CBTRuleset,
    settings: Readonly<{ owned?: boolean; name?: string }> = {},
): Promise<CBTForceFixture> {
    const options = signal({
        CBTRules: ruleset,
        CBTOptionalRules: { forcedWithdrawal: true, sprinting: false, hotLoadedAmmo: false } as Readonly<Record<string, boolean>>,
    });
    const optionsService = { options, cbtAutomationMode: () => 'no' } as unknown as OptionsService;
    const byInstance = new Map(units.map(unit => [unit.instanceId, unit] as const));
    const summaries = new Map(units.map(unit => {
        const entity = unit.getUnit();
        return [unit.uuid, {
            name: entity.displayName(), chassis: entity.chassis(), model: '', provider: MM_DATA_UNIT_PROVIDER_ID,
            uuid: unit.uuid, entityType: entity.entityType, bv: 0,
        } as unknown as UnitSummary] as const;
    }));
    const dataService = {
        getFactionById: () => null,
        getEraById: () => null,
        getUnitByUuid: (uuid: string) => summaries.get(uuid as CBTUnit['uuid']),
    } as unknown as DataService;
    const cbtUnits = {
        restore: async (saved: SerializedCBTUnitV2 | SerializedNonMekUnit, scenario: ScenarioRules) => {
            const original = byInstance.get(saved.instanceId);
            if (!original) throw new Error(`Unknown fixture unit ${saved.instanceId}`);
            const unit = isSerializedNonMekUnit(saved)
                ? restoreNonMekUnit(saved, original.getUnit(), original.uuid, scenario)
                : isCBTMekUnit(original)
                    ? await restoreMekUnit(saved, original.getUnit() as MekEntity, original.uuid, {
                        initializerRevision: saved.baselineRefAtSave.initialStateProfile.initializerRevision,
                        profileId: saved.baselineRefAtSave.initialStateProfile.profileId,
                        deployment: saved.deployment.values,
                        scenario,
                    })
                    : (() => { throw new Error('Saved Mek runtime for a non-Mek fixture'); })();
            return { unit, warnings: [] };
        },
    } as unknown as CBTUnitService;
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
    const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showNotice']);
    dialogs.showNotice.and.resolveTo();
    const injector = {
        get: (token: unknown) => token === CBTUnitService ? cbtUnits
            : token === OptionsService ? optionsService
                : token === ToastService ? toast
                    : token === DialogsService ? dialogs
                        : token === ForceCustomDesignsService ? { checkNative: async () => true, resetIfEmbedded: () => {} }
                            : token === LoggerService ? jasmine.createSpyObj<LoggerService>('LoggerService', ['error', 'warn'])
                                : null,
    } as unknown as Injector;
    const forceId = asForceId('force:rules-switch');
    const record: SerializedCBTForce = {
        version: 2,
        timestamp: '2026-01-01T00:00:00.000Z',
        instanceId: forceId,
        type: GameSystem.CBT,
        name: settings.name ?? 'Rules switch force',
        ...(settings.owned === false ? { owned: false } : {}),
        cbt: {
            schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
            forceId,
            forceRevision: 0,
            history: emptyRuntimeHistory(),
            units: units.map(unit => {
                const saved = unit.serialize();
                return { instanceId: unit.instanceId, stateRevision: saved.stateRevision, unit: saved };
            }),
            roster: {
                schemaVersion: 1,
                groups: [{
                    groupId: 'group:rules-switch', order: 0, name: 'Lance',
                    members: units.map((unit, order) => ({ instanceId: unit.instanceId, order })),
                }],
            },
            encounter: { networks: [] },
        },
    };
    const reload = (saved: SerializedCBTForce) => CBTForce.deserialize(structuredClone(saved), dataService, injector);
    return { force: await reload(record), options, toast, reload };
}
