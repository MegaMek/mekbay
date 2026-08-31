module.exports = (config) => {
    config.set({
        customLaunchers: {
            EdgeHeadlessNoGpu: {
                base: 'ChromeHeadless',
                flags: [
                    '--disable-gpu',
                    '--disable-gpu-compositing',
                    '--disable-gpu-sandbox',
                    '--disable-features=Vulkan',
                    '--use-angle=swiftshader',
                    '--enable-unsafe-swiftshader',
                ],
            },
        },
    });
};
