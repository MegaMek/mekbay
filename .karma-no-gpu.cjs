const path = require('node:path');

const SPRITE_ASSET_PREFIX = '/online-assets/generated/sprites/';
const SPRITE_ASSET_ROOT = path.resolve(__dirname, 'public', 'online-assets', 'generated', 'sprites');

/**
 * Angular's Karma asset middleware compares the URL-encoded pathname with an
 * unescaped filesystem key. Serve sprite filenames containing spaces before
 * that middleware gets the request.
 */
function createEscapedSpriteAssetMiddleware(serveFile) {
    return (request, response, next) => {
        const encodedPath = (request.url ?? '').split('?', 1)[0];
        let pathname;
        try {
            pathname = decodeURIComponent(encodedPath);
        } catch {
            next();
            return;
        }

        if (pathname === encodedPath || !pathname.startsWith(SPRITE_ASSET_PREFIX)) {
            next();
            return;
        }

        const assetPath = path.resolve(
            SPRITE_ASSET_ROOT,
            pathname.slice(SPRITE_ASSET_PREFIX.length),
        );
        const relativePath = path.relative(SPRITE_ASSET_ROOT, assetPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            next();
            return;
        }

        serveFile(assetPath, undefined, response, undefined, undefined, true);
    };
}
createEscapedSpriteAssetMiddleware.$inject = ['serveFile'];

function SummaryReporter(baseReporterDecorator) {
    baseReporterDecorator(this);
}
SummaryReporter.$inject = ['baseReporterDecorator'];

const mekBayKarmaPlugin = {
    'middleware:mekbay-escaped-sprite-assets': ['factory', createEscapedSpriteAssetMiddleware],
    'reporter:mekbay-summary': ['type', SummaryReporter],
};

module.exports = function configureNoGpuChrome(config) {
    config.set({
        frameworks: ['jasmine'],
        plugins: ['karma-*', mekBayKarmaPlugin],
        beforeMiddleware: ['mekbay-escaped-sprite-assets'],
        reporters: ['mekbay-summary'],
        colors: false,
        browserConsoleLogOptions: {
            terminal: false,
        },
        customLaunchers: {
            ChromeHeadlessNoGpu: {
                base: 'ChromeHeadless',
                flags: [
                    '--disable-gpu',
                    '--disable-gpu-compositing',
                    '--disable-software-rasterizer',
                    '--no-sandbox',
                ],
            },
        },
    });
};
