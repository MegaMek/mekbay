export interface LoadOptionalEnvFileOptions {
    logPrefix?: string;
    env?: NodeJS.ProcessEnv;
}

export interface ResolveMmDataRootOptions {
    override?: string;
    includeMegaMekData?: boolean;
    allowMissing?: boolean;
    label?: string;
}

export function loadOptionalEnvFile(
    projectRoot: string,
    options?: LoadOptionalEnvFileOptions,
): string | undefined;

export function resolveExistingPath(
    projectRoot: string,
    label: string,
    candidates: string[],
): string;

export function resolveMmDataRoot(
    projectRoot: string,
    options?: ResolveMmDataRootOptions,
): string;