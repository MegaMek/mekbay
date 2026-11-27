import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(__dirname, '..');
const evidenceRoot = path.resolve(projectRoot, '../tmp/script-parity-20260911');
fs.mkdirSync(evidenceRoot, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(evidenceRoot, 'cli-coverage-'));
for (const name of ['empty', 'unsupported', 'excluded', 'unknown', 'malformed']) {
    fs.mkdirSync(path.join(testRoot, name));
}
fs.writeFileSync(path.join(testRoot, 'unsupported/unit.blk'), '<UnitType>\nGunEmplacement\n</UnitType>\n');
fs.writeFileSync(path.join(testRoot, 'excluded/unit.blk'), 'intentionally excluded invalid input');
fs.writeFileSync(path.join(testRoot, 'unknown/unit.blk'), '<UnitType>\nUnexpectedUnitFamily\n</UnitType>\n');
fs.writeFileSync(path.join(testRoot, 'malformed/unit.blk'), '<UnitType>\nGunEmplacement\n');

const results: { script: string; input: string; status: number | null; log: string }[] = [];
for (const script of ['compare-entity-output.ts', 'verify-entity-roundtrip.ts']) {
    for (const input of ['missing', 'empty', 'unsupported', 'excluded', 'unknown', 'malformed']) {
        const args = [
            '--import', 'tsx', path.join(__dirname, script),
            '--input', path.join(testRoot, input),
            '--output', path.join(testRoot, `${script}-${input}-output`),
            ...(input === 'excluded' ? ['--exclude', 'unit.blk'] : []),
        ];
        const result = spawnSync(process.execPath, args, {
            cwd: projectRoot, encoding: 'utf8', timeout: 30_000,
        });
        const output = result.stdout + result.stderr;
        const log = path.join(testRoot, `${script}-${input}.log`);
        fs.writeFileSync(log, output);
        results.push({ script, input, status: result.status, log });
        assert.equal(result.error, undefined, `${script} ${input}: ${result.error}`);
        assert.equal(result.status, 1, `${script} must not pass ${input} input:\n${output}`);
        assert.doesNotMatch(output, /All (?:generated outputs are stable|tested files match)/u);
        if (input === 'missing') assert.match(output, /ENOENT/u);
        else if (input === 'empty') assert.match(output, /No files to verify/u);
        else if (input === 'unsupported' || input === 'excluded') {
            assert.match(output, /No supported, non-excluded files were tested/u);
        } else {
            assert.match(output, /Parse errors:\s+1/u, 'unexpected or malformed UnitTypes remain parse failures');
        }
    }
}
fs.writeFileSync(path.join(evidenceRoot, 'cli-coverage-tests.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`${results.length} native verification CLI failure/zero-coverage cases passed`);
