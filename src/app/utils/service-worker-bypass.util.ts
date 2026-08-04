const REMOTE_URL_PATTERN = /^https?:\/\//i;

export function withServiceWorkerBypass(url: string): string {
    if (!REMOTE_URL_PATTERN.test(url)) {
        return url;
    }

    return `${url}${url.includes('?') ? '&' : '?'}ngsw-bypass=true`;
}
