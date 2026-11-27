// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Adds every generated catalog unit to a force the way the app does (native entity parse, runtime creation, the Mek
 * whole-unit admission gate) and reports each one that cannot be added. Slow, so it is not part of `ng test`.
 *
 * Usage:
 *   npm run test:load-all-units [-- --ruleset core-2026|total-warfare] [--filter TEXT] [--verbose]
 *
 * Needs the generated units (`npm run gen-assets`). Exits 1 when any unit fails.
 */

import '@angular/compiler';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CBT_RULESET_LABELS, isCBTRuleset, type CBTRuleset } from '../src/app/models/cbt-ruleset.model';
import { DEFAULT_GUNNERY_SKILL, DEFAULT_PILOTING_SKILL } from '../src/app/models/crew-member.model';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';
import { parseNativeEntity } from '../src/app/models/entity/entity-repository';
import type { Quirk } from '../src/app/models/quirks.model';
import { createMekUnit } from '../src/app/models/runtime/cbt-mek-unit';
import { createNonMekUnit } from '../src/app/models/runtime/cbt-non-mek-unit';
import { evaluateCBTMekRuntimeCapability } from '../src/app/models/runtime/cbt-unit-validation';
import {
    DEFAULT_FORCE_DEPLOYMENT_ID,
    DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
    DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
    type ScenarioRules,
} from '../src/app/models/runtime/unit-state-initializer';
import type { Sourcebook } from '../src/app/models/sourcebook.model';
import { buildEquipmentRegistry } from '../src/app/services/catalogs/equipment-catalog-builder';
import {
    asSourceHash,
    makeUnitFileName,
    parseUnitFileName,
} from '../src/app/services/unit-catalog/unit-catalog.types';

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public', 'online-assets');
const UNITS = path.join(ASSETS, 'generated', 'units');
const EXAMPLES_PER_FAILURE = 5;

interface Failure {
    readonly unit: string;
    readonly stage: 'parse' | 'create' | 'admission';
    readonly reasons: readonly string[];
}

const { values: args } = parseArgs({
    options: {
        ruleset: { type: 'string', multiple: true },
        filter: { type: 'string' },
        verbose: { type: 'boolean', default: false },
    },
});

async function main(): Promise<void> {
    if (!existsSync(UNITS)) throw new Error(`No generated units at ${UNITS}; run \`npm run gen-assets\` first`);
    const rulesets = (args.ruleset ?? Object.keys(CBT_RULESET_LABELS)).map(ruleset => {
        if (!isCBTRuleset(ruleset)) throw new Error(`Unknown ruleset ${ruleset}`);
        return ruleset;
    });
    const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(path.join(ASSETS, ...parts), 'utf8')) as T;
    const registry = buildEquipmentRegistry(readJson('static', 'equipment.json'));
    const quirks = new Map(readJson<{ quirks: Quirk[] }>('static', 'quirks.json').quirks.map(quirk => [quirk.key, quirk]));
    const sourcebooks = new Map(readJson<Sourcebook[]>('generated', 'sourcebooks.json').map(book => [book.abbrev, book]));
    const filter = args.filter?.toLowerCase();

    const failures = new Map<CBTRuleset, Failure[]>(rulesets.map(ruleset => [ruleset, []]));
    let loaded = 0;
    const files = readdirSync(UNITS).filter(file => /\.(mtf|blk)$/u.test(file)).sort();
    for (const file of files) {
        const { uuid, format } = parseUnitFileName(file);
        const bytes = readFileSync(path.join(UNITS, file));
        let entity;
        try {
            entity = parseNativeEntity({
                uuid,
                format,
                file: makeUnitFileName(uuid, format),
                sourceHash: asSourceHash(createHash('sha1').update(bytes).digest('base64url')),
                bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            }, registry, {
                quirkResolver: key => quirks.get(key),
                sourcebookResolver: abbreviation => sourcebooks.get(abbreviation),
            });
        } catch (error) {
            if (filter !== undefined && !file.toLowerCase().includes(filter)) continue;
            for (const list of failures.values()) list.push({ unit: file, stage: 'parse', reasons: [errorMessage(error)] });
            continue;
        }
        const unit = `${entity.chassis()} ${entity.model()}`.trim() + ` (${file})`;
        if (filter !== undefined && !unit.toLowerCase().includes(filter)) continue;
        loaded++;
        for (const ruleset of rulesets) {
            const failure = await admit(entity, uuid, format, ruleset);
            if (failure) failures.get(ruleset)!.push({ unit, ...failure });
        }
    }

    console.log(`Loaded ${loaded} of ${files.length} unit files.`);
    let failed = 0;
    for (const [ruleset, list] of failures) {
        failed += list.length;
        console.log(`\n${ruleset}: ${list.length} unit${list.length === 1 ? '' : 's'} cannot be added`);
        for (const [reason, units] of groupByReason(list)) {
            console.log(`  ${units.length} × ${reason}`);
            for (const name of args.verbose ? units : units.slice(0, EXAMPLES_PER_FAILURE)) console.log(`      ${name}`);
            if (!args.verbose && units.length > EXAMPLES_PER_FAILURE) {
                console.log(`      … ${units.length - EXAMPLES_PER_FAILURE} more (--verbose)`);
            }
        }
    }
    process.exitCode = failed === 0 ? 0 : 1;
}

/** The app's admission (`ForceUnitAdmissionService.admitCBT` → `CBTForce.admitRetainedUnit`) without the force. */
async function admit(
    entity: ReturnType<typeof parseNativeEntity>,
    uuid: ReturnType<typeof parseUnitFileName>['uuid'],
    format: ReturnType<typeof parseUnitFileName>['format'],
    ruleset: CBTRuleset,
): Promise<Omit<Failure, 'unit'> | null> {
    const scenario: ScenarioRules = { id: 'megamek', ruleset };
    const deployment = { id: DEFAULT_FORCE_DEPLOYMENT_ID };
    const crewSkills = { gunnery: DEFAULT_GUNNERY_SKILL, piloting: DEFAULT_PILOTING_SKILL };
    const instanceId = `load-all-units:${uuid}`;
    try {
        if (entity instanceof MekEntity) {
            const unit = await createMekUnit({ uuid, instanceId, crewSkills }, entity, uuid, {
                profileId: DEFAULT_MEK_INITIAL_STATE_PROFILE_ID,
                deployment,
                scenario,
            });
            const decision = evaluateCBTMekRuntimeCapability(unit);
            return decision.readiness === 'ready' ? null : {
                stage: 'admission',
                reasons: decision.blockers.map(blocker => `${blocker.code}: ${blocker.message}`),
            };
        }
        if (format !== 'blk') throw new Error(`${entity.entityType} requires a BLK source`);
        createNonMekUnit(entity, {
            instanceId,
            uuid,
            deployment,
            scenario,
            initialStateProfileId: DEFAULT_NON_MEK_INITIAL_STATE_PROFILE_ID,
            crewSkills,
        });
        return null;
    } catch (error) {
        return { stage: 'create', reasons: [errorMessage(error)] };
    }
}

/** Failures by stage and reason, most common first; a unit with several reasons is listed under each. */
function groupByReason(failures: readonly Failure[]): [string, string[]][] {
    const groups = new Map<string, string[]>();
    for (const failure of failures) {
        for (const reason of failure.reasons) {
            const key = `${failure.stage}: ${reason}`;
            groups.set(key, [...groups.get(key) ?? [], failure.unit]);
        }
    }
    return [...groups].sort(([leftReason, left], [rightReason, right]) =>
        right.length - left.length || leftReason.localeCompare(rightReason));
}

function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return error.cause === undefined ? error.message : `${error.message} (${errorMessage(error.cause)})`;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
