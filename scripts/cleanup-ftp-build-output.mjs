import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MANAGED_BUILD_FILE_PATTERN = /^(?:chunk|main|polyfills|runtime|scripts|styles)-[A-Za-z0-9]+\.(?:js|css)(?:\.map)?$/u;
const MANAGED_SPRITE_FILE_PATTERN = /\.webp$/iu;
const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_BUILD_DIR = 'dist/browser';
const DEFAULT_RETENTION_DAYS = 30;
const DELETE_BATCH_SIZE = 50;
const SPRITES_DIR_NAME = 'sprites';

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

function parsePositiveInteger(value, fallback) {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer, received: ${value}`);
    }

    return parsed;
}

function trimTrailingSlash(value) {
    return value.replace(/\/+$/u, '');
}

function quoteLftp(value) {
    return `"${String(value).replace(/(["\\$`])/gu, '\\$1')}"`;
}

function warn(message) {
    console.log(`::warning::${message}`);
}

function describeLftpError(error) {
    if (!error || typeof error !== 'object') {
        return 'lftp failed';
    }

    const status = 'status' in error && typeof error.status === 'number'
        ? `exit code ${error.status}`
        : 'lftp failed';
    const stderr = 'stderr' in error && Buffer.isBuffer(error.stderr)
        ? error.stderr.toString('utf8').trim().split(/\r?\n/u).slice(-3).join(' ')
        : '';

    return stderr ? `${status}: ${stderr}` : status;
}

function runLftp(commands, options = {}) {
    const commandList = Array.isArray(commands) ? commands : [commands];
    const script = [
        'set cmd:fail-exit yes',
        'set ftp:list-options -a',
        'set net:max-retries 3',
        'set net:timeout 30',
        `open -u ${quoteLftp(requiredEnv('FTP_USER'))},${quoteLftp(requiredEnv('FTP_PASSWORD'))} ${quoteLftp(requiredEnv('FTP_HOST'))}`,
        ...commandList,
    ].join(';\n') + ';';

    return execFileSync('lftp', ['-c', script], {
        encoding: 'utf8',
        stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
}

function readCurrentBuildFiles(buildDir) {
    return new Set(fs.readdirSync(buildDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name));
}

function parseEpochListingLine(line) {
    const parts = line.trim().split(/\s+/u);
    const epochIndex = parts.findIndex((part) => /^\d{9,}$/u.test(part));
    if (epochIndex === -1 || epochIndex === parts.length - 1) {
        return undefined;
    }

    const name = parts.slice(epochIndex + 1).join(' ').replace(/\/+$/u, '');
    if (!name) {
        return undefined;
    }

    return {
        modifiedAtSeconds: Number.parseInt(parts[epochIndex], 10),
        name: path.posix.basename(name),
    };
}

function getRemoteFiles(remoteDir) {
    const listing = runLftp(`cls -l --time-style=+%s ${quoteLftp(`${remoteDir}/`)}`);
    const lines = listing
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    const remoteFiles = lines
        .map(parseEpochListingLine)
        .filter(Boolean);

    if (lines.length > 0 && remoteFiles.length === 0) {
        warn('Remote listing did not include parseable timestamps; cleanup skipped.');
    }

    return remoteFiles;
}

function getCleanupCandidates(remoteFiles, currentBuildFiles, managedFilePattern, cutoffSeconds) {
    return remoteFiles
    .filter((file) => managedFilePattern.test(file.name))
        .filter((file) => !currentBuildFiles.has(file.name))
        .filter((file) => file.modifiedAtSeconds < cutoffSeconds)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function deleteRemoteFiles(remoteDir, files) {
    for (let index = 0; index < files.length; index += DELETE_BATCH_SIZE) {
        const batch = files.slice(index, index + DELETE_BATCH_SIZE);
        runLftp(batch.map((file) => `rm ${quoteLftp(`${remoteDir}/${file.name}`)}`), { stdio: 'inherit' });
    }
}

function cleanupRemoteFiles({ label, localDir, remoteDir, managedFilePattern, retentionDays, cutoffSeconds }) {
    if (!fs.existsSync(localDir)) {
        warn(`Local ${label} directory not found for cleanup: ${localDir}`);
        return;
    }

    const currentFiles = readCurrentBuildFiles(localDir);
    let remoteFiles;
    try {
        remoteFiles = getRemoteFiles(remoteDir);
    } catch (error) {
        warn(`Could not list remote ${label} files for cleanup: ${describeLftpError(error)}`);
        return;
    }

    const cleanupCandidates = getCleanupCandidates(remoteFiles, currentFiles, managedFilePattern, cutoffSeconds);
    if (cleanupCandidates.length === 0) {
        console.log(`No old ${label} files found for cleanup in ${remoteDir}.`);
        return;
    }

    console.log(`Deleting ${cleanupCandidates.length} ${label} files older than ${retentionDays} days from ${remoteDir}.`);
    for (const file of cleanupCandidates.slice(0, 25)) {
        console.log(`cleanup: ${file.name}`);
    }

    if (cleanupCandidates.length > 25) {
        console.log(`cleanup: ...and ${cleanupCandidates.length - 25} more`);
    }

    try {
        deleteRemoteFiles(remoteDir, cleanupCandidates);
    } catch (error) {
        warn(`${label} cleanup did not complete: ${describeLftpError(error)}`);
    }
}

function main() {
    const buildDir = process.env.BUILD_DIR?.trim() || DEFAULT_BUILD_DIR;
    const remoteDir = trimTrailingSlash(requiredEnv('FTP_REMOTE_DIR'));
    const retentionDays = parsePositiveInteger(process.env.FTP_CLEANUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
    const cutoffSeconds = Math.floor(Date.now() / 1000) - (retentionDays * SECONDS_PER_DAY);

    cleanupRemoteFiles({
        label: 'Angular build',
        localDir: buildDir,
        remoteDir,
        managedFilePattern: MANAGED_BUILD_FILE_PATTERN,
        retentionDays,
        cutoffSeconds,
    });

    cleanupRemoteFiles({
        label: 'sprite sheet',
        localDir: path.join(buildDir, SPRITES_DIR_NAME),
        remoteDir: `${remoteDir}/${SPRITES_DIR_NAME}`,
        managedFilePattern: MANAGED_SPRITE_FILE_PATTERN,
        retentionDays,
        cutoffSeconds,
    });
}

main();