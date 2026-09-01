module.exports = config => config.set({
    frameworks: ['jasmine'],
    browsers: ['EdgeHeadless'],
    customLaunchers: {
        EdgeHeadless: {
            base: 'ChromeHeadless',
            flags: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-sandbox',
            ],
        },
    },
    singleRun: true,
});
