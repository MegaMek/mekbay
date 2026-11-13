// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import { isPlainRecord } from '../../utils/json-value.util';
import type { CBTOptionalRules } from '../options.model';

/**
 * The optional rules bound into every unit's runtime, with the value a scenario that leaves one out plays. They change
 * unit state, so changing one rebinds the loaded forces. Binding another rule is adding its key here.
 */
export const BOUND_OPTIONAL_RULE_DEFAULTS = Object.freeze({
    forcedWithdrawal: true,
    sprinting: false,
    hotLoadedAmmo: false,
} as const satisfies Partial<Record<keyof CBTOptionalRules, boolean>>);

export type BoundOptionalRules = Readonly<Record<keyof typeof BOUND_OPTIONAL_RULE_DEFAULTS, boolean>>;

const BOUND_KEYS = Object.freeze(Object.keys(BOUND_OPTIONAL_RULE_DEFAULTS) as (keyof BoundOptionalRules)[]);

/** The bound rules as the application options set them; an option they lack plays its default. */
export function boundOptionalRulesFromOptions(rules: Partial<CBTOptionalRules>): BoundOptionalRules {
    return Object.freeze(Object.fromEntries(BOUND_KEYS.map(key =>
        [key, rules[key] ?? BOUND_OPTIONAL_RULE_DEFAULTS[key]]))) as BoundOptionalRules;
}

/** One reason a scenario's options cannot bind, under the option it names. */
export type BoundOptionalRulesProblem = Readonly<{ key: string; message: string }>;

/**
 * Reads a scenario's options as bound rules: each must be a bound rule set to an exact boolean, and a rule left out
 * plays its default. Every malformed or unknown option fails closed.
 */
export function readBoundOptionalRules(options: unknown):
    | Readonly<{ kind: 'supported'; rules: BoundOptionalRules }>
    | Readonly<{ kind: 'unsupported'; problems: readonly BoundOptionalRulesProblem[] }> {
    if (options === undefined) return Object.freeze({ kind: 'supported', rules: BOUND_OPTIONAL_RULE_DEFAULTS });
    if (!isPlainRecord(options)) {
        return Object.freeze({ kind: 'unsupported', problems: Object.freeze([Object.freeze({
            key: '<invalid-options>', message: 'Scenario options must be a plain record',
        })]) });
    }
    const problems = Object.keys(options).sort(compareText).flatMap((key): BoundOptionalRulesProblem[] => {
        if (!Object.prototype.hasOwnProperty.call(BOUND_OPTIONAL_RULE_DEFAULTS, key)) {
            return [{ key, message: `Scenario option ${key} is not an optional rule bound into units` }];
        }
        return typeof options[key] === 'boolean' ? [] : [{ key, message: `Scenario option ${key} must be an exact boolean` }];
    });
    if (problems.length > 0) return Object.freeze({ kind: 'unsupported', problems: Object.freeze(problems) });
    const rules = Object.freeze({ ...BOUND_OPTIONAL_RULE_DEFAULTS, ...options }) as BoundOptionalRules;
    return Object.freeze({ kind: 'supported', rules });
}
