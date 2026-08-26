// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ENV = ['FTP_USER', 'FTP_PASSWORD', 'FTP_HOST', 'FTP_REMOTE_DIR'];

export interface LftpDeployScriptOptions {
    readonly ftpUser: string;
    readonly ftpPassword: string;
    readonly ftpHost: string;
    readonly remoteDirectory: string;
    readonly browserDirectory?: string;
    readonly licensesFile?: string;
    readonly hasCsrIndex?: boolean;
}

function quoteLftp(value: string): string {
    return `"${String(value)
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('$', '\\$')
        .replaceAll('`', '\\`')}"`;
}

function normalizeRemoteDirectory(value: string): string {
    const normalized = String(value)
        .replaceAll('\\', '/')
        .replace(/^\.\//u, '')
        .replace(/\/+$/u, '');
    const segments = normalized.split('/').filter(Boolean);
    if (
        normalized.length === 0
        || !/^[A-Za-z0-9._/-]+$/u.test(normalized)
        || segments.some((segment) => segment === '.' || segment === '..')
    ) {
        throw new Error(`Unsafe FTP_REMOTE_DIR: ${value}`);
    }
    return normalized;
}

export function buildLftpDeployScript({
    ftpUser,
    ftpPassword,
    ftpHost,
    remoteDirectory,
    browserDirectory = './dist/browser',
    licensesFile = './dist/3rdpartylicenses.txt',
    hasCsrIndex = false,
}: LftpDeployScriptOptions): string {
    const remote = normalizeRemoteDirectory(remoteDirectory);
    const remoteGeneratedAssets = `${remote}/online-assets/generated`;
    const remoteOnlineAssets = `${remote}/online-assets`;
    const quotedBrowser = quoteLftp(browserDirectory.replaceAll('\\', '/'));
    const quotedRemote = quoteLftp(`${remote}/`);
    const quotedRemoteGeneratedAssets = quoteLftp(`${remoteGeneratedAssets}/`);
    const quotedRemoteOnlineAssets = quoteLftp(`${remoteOnlineAssets}/`);
    const entrypointFiles = [
        '--file=index.html',
        ...(hasCsrIndex ? ['--file=index.csr.html'] : []),
        '--file=ngsw.json',
    ].join(' ');

    return [
        'set cmd:fail-exit yes',
        'set ftp:list-options -a',
        'set ssl:verify-certificate yes',
        'set ftp:use-site-utime yes',
        'set ftp:use-site-utime2 yes',
        'set net:max-retries 3',
        'set net:timeout 30',
        'set xfer:use-temp-file yes',
        'set xfer:temp-file-name ".mekbay-upload-*"',
        `open ${quoteLftp(ftpHost)}`,
        `user ${quoteLftp(ftpUser)} ${quoteLftp(ftpPassword)}`,

        // Phase 1: publish every asset before either manifest can advertise it.
        [
            'mirror --parallel=20 -R --upload-older --no-perms --verbose',
            '--exclude-glob=index.html',
            '--exclude-glob=index.csr.html',
            '--exclude-glob=ngsw.json',
            '--exclude-glob=online-assets/generated/units-manifest.json',
            '--exclude-glob=online-assets/assets-manifest.json',
            quotedBrowser,
            quotedRemote,
        ].join(' '),

        // Phase 2: publish the unit file index after units.zip and unit files.
        [
            'mirror --parallel=1 -R --upload-older --no-perms --verbose',
            '--file=units-manifest.json',
            quoteLftp(`${browserDirectory.replaceAll('\\', '/')}/online-assets/generated/`),
            quotedRemoteGeneratedAssets,
        ].join(' '),

        // Phase 3: assets-manifest.json is the repository commit point.
        [
            'mirror --parallel=1 -R --upload-older --no-perms --verbose',
            '--file=assets-manifest.json',
            quoteLftp(`${browserDirectory.replaceAll('\\', '/')}/online-assets/`),
            quotedRemoteOnlineAssets,
        ].join(' '),

        // Phase 4: publish application entry points only after every asset they
        // can advertise. The default mirror comparison skips identical files.
        [
            'mirror --parallel=1 -R --upload-older --no-perms --verbose',
            entrypointFiles,
            quotedBrowser,
            quotedRemote,
        ].join(' '),

        ...(fs.existsSync(licensesFile)
            ? [`put -O ${quotedRemote} ${quoteLftp(licensesFile.replaceAll('\\', '/'))}`]
            : []),
    ].map((command) => `${command};`).join('\n');
}

export function deployBuild(environment: NodeJS.ProcessEnv = process.env): void {
    for (const name of REQUIRED_ENV) {
        if (!environment[name]) {
            throw new Error(`Missing required environment variable ${name}`);
        }
    }

    const browserDirectory = path.resolve(environment.DEPLOY_BROWSER_DIR ?? 'dist/browser');
    if (!fs.existsSync(path.join(browserDirectory, 'index.html'))) {
        throw new Error(`Angular browser build not found at ${browserDirectory}`);
    }

    const script = buildLftpDeployScript({
        ftpUser: environment.FTP_USER!,
        ftpPassword: environment.FTP_PASSWORD!,
        ftpHost: environment.FTP_HOST!,
        remoteDirectory: environment.FTP_REMOTE_DIR!,
        browserDirectory,
        licensesFile: path.resolve(environment.DEPLOY_LICENSES_FILE ?? 'dist/3rdpartylicenses.txt'),
        hasCsrIndex: fs.existsSync(path.join(browserDirectory, 'index.csr.html')),
    });

    const result = spawnSync('lftp', ['-c', script], { stdio: 'inherit' });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`lftp exited with status ${result.status}`);
    }
}

if (require.main === module) {
    try {
        deployBuild();
    } catch (error) {
        console.error('[Deploy] Error:', error);
        process.exitCode = 1;
    }
}
