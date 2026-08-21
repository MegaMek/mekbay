module.exports = function configureKarma(config) {
    config.set({
        frameworks: ['jasmine'],
        customLaunchers: {
            ChromeHeadlessCodex: {
                base: 'ChromeHeadless',
                flags: [
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-dev-shm-usage',
                ],
            },
        },
    });
};
