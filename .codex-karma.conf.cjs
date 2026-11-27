module.exports = (config) => {
    config.set({
        frameworks: ['jasmine'],
        customLaunchers: {
            ChromeHeadlessCodex: {
                base: 'ChromeHeadless',
                flags: [
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-software-rasterizer',
                ],
            },
        },
    });
};
