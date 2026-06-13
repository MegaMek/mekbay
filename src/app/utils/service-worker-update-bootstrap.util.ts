export const SW_UPDATE_RELOAD_HASH_STORAGE_KEY = 'mekbay:sw-update-reload-hash';

const DEFAULT_LOGO_URL = '/images/logo.png';
const UPDATE_CHECK_TIMEOUT_MS = 5000;
const UPDATE_INSTALL_TIMEOUT_MS = 90000;
const UPDATE_ACTIVATE_TIMEOUT_MS = 10000;
const CHECKING_SCREEN_DELAY_MS = 600;
// Local debug switch: set true to simulate the startup update screen once per tab session.
const DEBUG_FAKE_BOOTSTRAP_UPDATE = false;
const DEBUG_FAKE_BOOTSTRAP_UPDATE_SESSION_KEY = 'mekbay:debug-fake-bootstrap-update-seen';
const DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS = 700;

type NgswMessage = {
    type?: string;
    nonce?: number;
    result?: unknown;
    error?: string;
    latestVersion?: { hash?: string };
};

type ServiceWorkerOperation = 'CHECK_FOR_UPDATES' | 'ACTIVATE_UPDATE';

type BootstrapUpdateOptions = {
    logoUrl?: string;
    reload?: () => void;
};

export class ServiceWorkerUpdateScreen {
    private root: HTMLElement | null = null;
    private label: HTMLElement | null = null;
    private bar: HTMLElement | null = null;

    constructor(private readonly documentRef: Document, private readonly logoUrl = DEFAULT_LOGO_URL) {}

    show(label: string, progress: number, indeterminate = false): void {
        this.ensureRoot();
        this.update(label, progress, indeterminate);
    }

    update(label: string, progress: number, indeterminate = false): void {
        if (!this.root || !this.label || !this.bar) {
            return;
        }

        this.label.textContent = label;
        this.bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        this.bar.classList.toggle('mekbay-bootstrap-update-bar-indeterminate', indeterminate);
    }

    remove(): void {
        this.root?.remove();
        this.root = null;
        this.label = null;
        this.bar = null;
    }

    private ensureRoot(): void {
        if (this.root) {
            return;
        }

        const root = this.documentRef.createElement('div');
        root.className = 'mekbay-bootstrap-update-screen';
        root.innerHTML = `
            <style>
                .mekbay-bootstrap-update-screen {
                    position: fixed;
                    inset: 0;
                    z-index: 2147483647;
                    display: grid;
                    place-items: center;
                    padding: 32px;
                    box-sizing: border-box;
                    color: #fff;
                    background: linear-gradient(225deg, #333333 0%, #101010 100%);
                    font-family: Roboto, Arial, sans-serif;
                }

                .mekbay-bootstrap-update-panel {
                    width: min(360px, 100%);
                    display: grid;
                    justify-items: center;
                    gap: 18px;
                    text-align: center;
                }

                .mekbay-bootstrap-update-logo {
                    width: 256px;
                    height: auto;
                    max-width: 80vw;
                }

                .mekbay-bootstrap-update-label {
                    min-height: 20px;
                    color: #d8d8d8;
                    font-size: 14px;
                    line-height: 20px;
                }

                .mekbay-bootstrap-update-track {
                    width: 100%;
                    height: 8px;
                    overflow: hidden;
                    border: 2px solid rgba(255, 255, 255, 0.16);
                    background: rgba(0, 0, 0, 0.35);
                }

                .mekbay-bootstrap-update-bar {
                    width: 0%;
                    height: 100%;
                    border-radius: inherit;
                    background: linear-gradient(90deg, #eaae3f, #ffcf73);
                    transition: width 180ms ease;
                }

                .mekbay-bootstrap-update-bar-indeterminate {
                    width: 45% !important;
                    animation: mekbay-bootstrap-update-indeterminate 1.1s ease-in-out infinite;
                }

                @keyframes mekbay-bootstrap-update-indeterminate {
                    0% { transform: translateX(-115%); }
                    55% { transform: translateX(60%); }
                    100% { transform: translateX(240%); }
                }
            </style>
            <div class="mekbay-bootstrap-update-panel" role="status" aria-live="polite">
                <img class="mekbay-bootstrap-update-logo" src="${this.logoUrl}" alt="MekBay" />
                <div class="mekbay-bootstrap-update-label"></div>
                <div class="mekbay-bootstrap-update-track" aria-hidden="true">
                    <div class="mekbay-bootstrap-update-bar"></div>
                </div>
            </div>
        `;

        this.documentRef.body.appendChild(root);
        this.root = root;
        this.label = root.querySelector('.mekbay-bootstrap-update-label');
        this.bar = root.querySelector('.mekbay-bootstrap-update-bar');
    }
}

export function createServiceWorkerUpdateScreen(): ServiceWorkerUpdateScreen | null {
    if (typeof document === 'undefined') {
        return null;
    }

    return new ServiceWorkerUpdateScreen(document, DEFAULT_LOGO_URL);
}

export async function runServiceWorkerUpdateBootstrap(options: BootstrapUpdateOptions = {}): Promise<void> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return;
    }

    if (DEBUG_FAKE_BOOTSTRAP_UPDATE) {
        await runFakeServiceWorkerUpdateBootstrap(options);
        return;
    }

    if (navigator.onLine === false || !('serviceWorker' in navigator)) {
        return;
    }

    const serviceWorker = navigator.serviceWorker;
    const controller = serviceWorker.controller;
    if (!controller || !isAngularServiceWorker(controller)) {
        return;
    }

    const screen = new ServiceWorkerUpdateScreen(document, options.logoUrl ?? DEFAULT_LOGO_URL);
    const showCheckingTimeoutId = window.setTimeout(() => {
        screen.show('Checking for updates...', 12, true);
    }, CHECKING_SCREEN_DELAY_MS);
    let latestHash: string | null = null;

    const messageHandler = (event: MessageEvent<NgswMessage>) => {
        const data = event.data;
        switch (data?.type) {
            case 'VERSION_DETECTED':
                window.clearTimeout(showCheckingTimeoutId);
                screen.show('Installing update...', 38, true);
                break;
            case 'VERSION_READY':
                latestHash = getLatestServiceWorkerHash(data);
                window.clearTimeout(showCheckingTimeoutId);
                screen.show('Preparing restart...', 82);
                break;
            case 'VERSION_INSTALLATION_FAILED':
                window.clearTimeout(showCheckingTimeoutId);
                screen.remove();
                break;
        }
    };

    serviceWorker.addEventListener('message', messageHandler);

    try {
        await withTimeout(serviceWorker.ready, UPDATE_CHECK_TIMEOUT_MS);
        const updateFound = await postServiceWorkerOperation(serviceWorker, controller, 'CHECK_FOR_UPDATES', UPDATE_INSTALL_TIMEOUT_MS);
        if (!updateFound) {
            return;
        }

        window.clearTimeout(showCheckingTimeoutId);
        screen.show('Activating update...', 90);
        recordUpdateReloadHash(latestHash);

        const activated = await postServiceWorkerOperation(serviceWorker, controller, 'ACTIVATE_UPDATE', UPDATE_ACTIVATE_TIMEOUT_MS);
        if (activated) {
            screen.update('Restarting...', 100);
            (options.reload ?? (() => window.location.reload()))();
            if (!options.reload) {
                await new Promise(() => undefined);
            }
        }
    } catch (error) {
        console.warn('[MekBay] Startup update check failed; continuing with cached app.', error);
    } finally {
        window.clearTimeout(showCheckingTimeoutId);
        serviceWorker.removeEventListener('message', messageHandler);
        screen.remove();
    }
}

async function runFakeServiceWorkerUpdateBootstrap(options: BootstrapUpdateOptions): Promise<void> {
    if (hasSessionFlag(DEBUG_FAKE_BOOTSTRAP_UPDATE_SESSION_KEY)) {
        return;
    }

    setSessionFlag(DEBUG_FAKE_BOOTSTRAP_UPDATE_SESSION_KEY);
    const screen = new ServiceWorkerUpdateScreen(document, options.logoUrl ?? DEFAULT_LOGO_URL);

    try {
        screen.show('Checking for updates...', 12, true);
        await delay(DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS);
        screen.show('Installing update...', 38, true);
        await delay(DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS);
        screen.show('Preparing restart...', 82);
        await delay(DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS);
        screen.show('Activating update...', 90);
        recordUpdateReloadHash('debug-fake-bootstrap-update');
        await delay(DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS);
        screen.update('Restarting...', 100);
        await delay(DEBUG_FAKE_BOOTSTRAP_UPDATE_STEP_MS);
        (options.reload ?? (() => window.location.reload()))();
        if (!options.reload) {
            await new Promise(() => undefined);
        }
    } finally {
        screen.remove();
    }
}

function hasSessionFlag(key: string): boolean {
    try {
        return sessionStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
}

function setSessionFlag(key: string): void {
    try {
        sessionStorage.setItem(key, 'true');
    } catch {
        // Best effort only; debug mode must still be able to run in locked-down browsers.
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getLatestServiceWorkerHash(event: { latestVersion?: { hash?: string } }): string | null {
    const hash = event.latestVersion?.hash?.trim();
    return hash ? hash : null;
}

export function getRecordedUpdateReloadHash(): string | null {
    try {
        const hash = localStorage.getItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY)?.trim();
        return hash ? hash : null;
    } catch {
        return null;
    }
}

export function recordUpdateReloadHash(hash: string | null): void {
    if (!hash) {
        return;
    }

    try {
        localStorage.setItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY, hash);
    } catch {
        // Best effort only; startup must continue even if storage is unavailable.
    }
}

export function clearRecordedUpdateReloadHash(): void {
    try {
        localStorage.removeItem(SW_UPDATE_RELOAD_HASH_STORAGE_KEY);
    } catch {
        // Best effort only; startup must continue even if storage is unavailable.
    }
}

function isAngularServiceWorker(worker: ServiceWorker): boolean {
    try {
        return new URL(worker.scriptURL).pathname.endsWith('/ngsw-worker.js');
    } catch {
        return false;
    }
}

function postServiceWorkerOperation(
    serviceWorker: ServiceWorkerContainer,
    worker: ServiceWorker,
    action: ServiceWorkerOperation,
    timeoutMs: number,
): Promise<boolean> {
    const nonce = Math.round(Math.random() * 10000000);
    let messageHandler: ((event: MessageEvent<NgswMessage>) => void) | null = null;
    const completed = new Promise<boolean>((resolve, reject) => {
        messageHandler = (event: MessageEvent<NgswMessage>) => {
            const data = event.data;
            if (data?.type !== 'OPERATION_COMPLETED' || data.nonce !== nonce) {
                return;
            }

            if (messageHandler) {
                serviceWorker.removeEventListener('message', messageHandler);
            }
            if (data.error) {
                reject(new Error(data.error));
                return;
            }

            resolve(data.result === true);
        };

        serviceWorker.addEventListener('message', messageHandler);
        worker.postMessage({ action, nonce });
    });

    return withTimeout(completed, timeoutMs).finally(() => {
        if (messageHandler) {
            serviceWorker.removeEventListener('message', messageHandler);
        }
    });
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        Promise.resolve(promise).then(
            (value) => {
                window.clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}