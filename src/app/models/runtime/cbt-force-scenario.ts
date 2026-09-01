// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JsonObject, JsonValue } from '../persisted-unit-state';
import {
    scenarioRuleset,
    type ScenarioRules,
} from './unit-state-initializer';

export function scenarioRulesFromPersistence(value: JsonValue): ScenarioRules {
    if (!isJsonObject(value)
        || Object.keys(value).some(key => key !== 'id' && key !== 'ruleset' && key !== 'options')
        || typeof value['id'] !== 'string'
        || !value['id'].trim()) {
        throw new Error('Persisted scenario rules are not a restorable ScenarioRules value');
    }
    const rawOptions = value['options'];
    if (rawOptions !== undefined && (!isJsonObject(rawOptions)
        || Object.values(rawOptions).some(option =>
            typeof option !== 'string' && typeof option !== 'number' && typeof option !== 'boolean'))) {
        throw new Error('Persisted scenario options are not restorable scalar values');
    }
    return Object.freeze({
        id: value['id'],
        ...(value['ruleset'] === undefined ? {} : { ruleset: scenarioRuleset({
            id: value['id'],
            ruleset: value['ruleset'] as ScenarioRules['ruleset'],
        }) }),
        ...(rawOptions === undefined
            ? {}
            : { options: Object.freeze({ ...(rawOptions as Readonly<Record<string, string | number | boolean>>) }) }),
    });
}

function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
