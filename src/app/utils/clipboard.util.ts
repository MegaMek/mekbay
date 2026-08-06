// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake



export function copyTextToClipboard(text: string): Promise<void> {
    
    if (navigator.clipboard) {
        return navigator.clipboard.writeText(text);
    } else {
        return new Promise<void>((resolve, reject) => {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';  // Avoid scrolling to bottom
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    resolve();
                } else {
                    reject(new Error('Copy command was unsuccessful'));
                }
            } catch (err) {
                reject(err);
            } finally {
                document.body.removeChild(textArea);
            }
        });
    }
}

export async function shareUrlWithClipboardFallback({
    title,
    url,
}: {
    title: string;
    url: string;
}): Promise<'shared' | 'copied'> {
    if (navigator.share) {
        try {
            await navigator.share({ title, url });
            return 'shared';
        } catch {
            // Fall back to copying for cancellations or share errors.
        }
    }

    await copyTextToClipboard(url);
    return 'copied';
}