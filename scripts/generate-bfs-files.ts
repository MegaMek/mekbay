#!/usr/bin/env node
import path from 'node:path';
import { buildBfsGenerationPlan, writeBfsGenerationPlan } from './lib/bfs-generation';

const { loadOptionalEnvFile, resolveMmDataRoot } = require('./lib/script-paths') as typeof import('./lib/script-paths');

interface CliOptions {
    write: boolean;
    mmDataRoot?: string;
    csvRoot?: string;
    unitFilesRoot?: string;
    manifestPath?: string;
    reportPath?: string;
}

function usage(): string {
    return `Usage: npm run gen-bfs -- [--check | --write] [options]

Options:
  --check                 Validate and compare output without writing (default)
  --write                 Write changed BFS files and the report after preflight
  --mm-data <path>        Override the mm-data repository root
  --csv-root <path>       Override the BFS_CSV input directory
  --unit-files <path>     Override data/mekfiles
  --manifest <path>       Override the reviewed manifest
  --report <path>         Override the Markdown report path
  --help                   Show this message
`;
}

export function parseCliArguments(args: readonly string[]): CliOptions {
    const options: CliOptions = { write: false };
    const takeValue = (index: number, flag: string): string => {
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`${flag} requires a path.`);
        }
        return value;
    };
    for (let index = 0; index < args.length; index += 1) {
        switch (args[index]) {
            case '--check':
                options.write = false;
                break;
            case '--write':
                options.write = true;
                break;
            case '--mm-data':
                options.mmDataRoot = takeValue(index, '--mm-data'); index += 1; break;
            case '--csv-root':
                options.csvRoot = takeValue(index, '--csv-root'); index += 1; break;
            case '--unit-files':
                options.unitFilesRoot = takeValue(index, '--unit-files'); index += 1; break;
            case '--manifest':
                options.manifestPath = takeValue(index, '--manifest'); index += 1; break;
            case '--report':
                options.reportPath = takeValue(index, '--report'); index += 1; break;
            case '--help':
                console.log(usage());
                process.exit(0);
            default:
                throw new Error(`Unknown argument '${args[index]}'.\n\n${usage()}`);
        }
    }
    return options;
}

export function runBfsGenerator(options: CliOptions): number {
    const appRoot = path.resolve(__dirname, '..');
    loadOptionalEnvFile(appRoot, { logPrefix: 'BFS Generator' });
    const mmDataRoot = path.resolve(options.mmDataRoot ?? resolveMmDataRoot(appRoot));
    const plan = buildBfsGenerationPlan({
        csvRoot: path.resolve(options.csvRoot ?? path.join(mmDataRoot, 'BFS_CSV')),
        unitFilesRoot: path.resolve(options.unitFilesRoot ?? path.join(mmDataRoot, 'data', 'mekfiles')),
        manifestPath: path.resolve(options.manifestPath ?? path.join(appRoot, 'scripts', 'bfs', 'bfs-conversion-manifest.yaml')),
        reportPath: path.resolve(options.reportPath ?? path.join(mmDataRoot, 'BFS_CSV', 'BFS-generation-report.md')),
    });

    console.log(`Validated ${plan.files.length} supported definitions and ${plan.aerospace.length} blocked aerospace rows.`);
    console.log(`${plan.changedPaths.length} output(s) differ; ${plan.unchangedPaths.length} are current.`);
    if (options.write) {
        writeBfsGenerationPlan(plan);
        console.log('BFS files and report written successfully.');
        return 0;
    }
    if (plan.changedPaths.length > 0) {
        console.log('Check mode made no changes. Run with --write after reviewing the plan.');
        return 1;
    }
    console.log('All generated outputs are current.');
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = runBfsGenerator(parseCliArguments(process.argv.slice(2)));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
