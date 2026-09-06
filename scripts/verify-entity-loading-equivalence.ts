// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Compare two source trees against the same native corpus without modifying either tree. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawEquipmentData, EquipmentMap } from '../src/app/models/equipment.model';
import { equipmentCatalogEntriesIncludingSupplements } from '../src/app/models/equipment-catalog-supplements';
import type { BaseEntity } from '../src/app/models/entity/base-entity';

const args = process.argv.slice(2);
const argument = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
};

async function loadImplementation(sourceRoot: string) {
    const moduleAt = (path: string) => import(pathToFileURL(resolve(sourceRoot, 'src/app', path)).href);
    const equipmentModule = await moduleAt('models/equipment.model.ts') as typeof import('../src/app/models/equipment.model');
    const registryModule = await moduleAt('models/equipment-lookup.ts') as typeof import('../src/app/models/equipment-lookup');
    const parser = await moduleAt('models/entity/parse-entity.ts') as typeof import('../src/app/models/entity/parse-entity');
    const writer = await moduleAt('models/entity/write-entity.ts') as typeof import('../src/app/models/entity/write-entity');
    const summary = await moduleAt('utils/unit-summary-builder.ts') as typeof import('../src/app/utils/unit-summary-builder');
    const catalog = await moduleAt('services/unit-catalog/unit-catalog.types.ts') as typeof import('../src/app/services/unit-catalog/unit-catalog.types');
    const raw = JSON.parse(readFileSync(resolve('scripts/fixtures/equipment2.json'), 'utf8')) as RawEquipmentData;
    const equipment: EquipmentMap = {};
    for (const [id, item] of equipmentCatalogEntriesIncludingSupplements(raw.equipment)) {
        equipment[id] = equipmentModule.createEquipment(item);
    }
    const registry = new registryModule.EquipmentRegistry(equipment);
    const builder = new summary.UnitSummaryBuilder();
    return (content: string, file: string) => {
        let entity: BaseEntity;
        try {
            entity = parser.parseEntity(content, file, registry).entity;
        } catch (error) {
            return { error: `parse: ${message(error)}` };
        }
        // Unidentified source files intentionally receive fresh identities at ingress.
        if (!/^uuid:/imu.test(content) && !/<UUID>/iu.test(content)) {
            entity.uuid.set('019f583e-b5e8-7032-b925-ba6c429a0687' as ReturnType<BaseEntity['uuid']>);
        }
        let native: string;
        try { native = writer.encodeNativeEntity(entity); }
        catch (error) { return { error: `write: ${message(error)}` }; }
        let summary: unknown;
        try {
            summary = builder.build(entity, {
                entryKey: {
                    origin: 'megamek',
                    design: { provider: catalog.MM_DATA_UNIT_PROVIDER_ID, uuid: entity.uuid() },
                    sourceRevision: catalog.asSourceHash(createHash('sha1').update(content).digest('base64url')),
                },
                format: file.toLowerCase().endsWith('.mtf') ? 'mtf' : 'blk',
            });
        }
        catch (error) { summary = { error: `metadata: ${message(error)}` }; }
        return {
            native,
            metadata: summary,
            mounts: entity.equipment().map(mount => ({
                id: mount.mountId,
                linked: entity.getLinkedMount(mount)?.mountId,
                allocation: mount.allocation,
            })),
            bays: entity.equipmentBays().map(bay => ({
                kind: bay.kind, controller: bay.controller?.mountId,
                members: bay.mounts.map(mount => mount.mountId),
            })),
            diagnostics: entity.loadIssues(),
        };
    };
}

async function main() {
    const baselineRoot = argument('--baseline-source');
    if (!baselineRoot) throw new Error('--baseline-source must identify a prepared original source tree');
    const candidateRoot = argument('--candidate-source') ?? '.';
    const inputRoot = resolve(argument('--input') ?? '../mekfiles');
    const baseline = await loadImplementation(baselineRoot);
    const candidate = await loadImplementation(candidateRoot);
    const files = unitFiles(inputRoot).sort();
    if (files.length === 0) throw new Error(`No native unit files found in ${inputRoot}`);
    const sourceHash = createHash('sha256');
    const beforeHash = createHash('sha256');
    const afterHash = createHash('sha256');
    const differences: { file: string; changedFields: string[]; before: string; after: string }[] = [];
    const sharedFailures: { file: string; error: string }[] = [];
    let compared = 0;
    for (const file of files) {
        const name = relative(inputRoot, file).replace(/\\/gu, '/');
        const content = readFileSync(file, 'utf8');
        sourceHash.update(name).update('\0').update(content).update('\0');
        const before = baseline(content, name);
        const after = candidate(content, name);
        const beforeJson = JSON.stringify(before);
        const afterJson = JSON.stringify(after);
        beforeHash.update(name).update('\0').update(beforeJson).update('\0');
        afterHash.update(name).update('\0').update(afterJson).update('\0');
        if (beforeJson !== afterJson) {
            const beforeFields: Record<string, unknown> = before;
            const afterFields: Record<string, unknown> = after;
            const keys = new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]);
            differences.push({
                file: name,
                changedFields: [...keys].filter(key => JSON.stringify(beforeFields[key]) !== JSON.stringify(afterFields[key])),
                before: sha(beforeJson), after: sha(afterJson),
            });
        }
        else if (before.error) sharedFailures.push({ file: name, error: before.error });
        else if (typeof before.metadata === 'object' && before.metadata !== null && 'error' in before.metadata) {
            sharedFailures.push({ file: name, error: String(before.metadata.error) });
        }
        compared++;
        if (compared % 1000 === 0) console.log(`Compared ${compared}/${files.length} native files; ${differences.length} differences.`);
    }
    const report = {
        check: 'native-entity-source-equivalence',
        generatedAt: new Date().toISOString(),
        node: process.version,
        compared,
        sourceSha256: sourceHash.digest('hex'),
        baselineOutputSha256: beforeHash.digest('hex'),
        candidateOutputSha256: afterHash.digest('hex'),
        differences,
        sharedFailures,
        methodology: 'Native writer output, complete metadata, mount identities/allocations/links, bay membership and load diagnostics. Unidentified source UUIDs normalized. Shared original/candidate parse or calculation failures are reported separately.',
    };
    const output = argument('--output');
    if (output) writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (differences.length > 0) process.exitCode = 1;
}

function unitFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) return unitFiles(file);
        return /\.(mtf|blk)$/iu.test(entry.name) ? [file] : [];
    });
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
void main().catch(error => { console.error(error); process.exitCode = 1; });
