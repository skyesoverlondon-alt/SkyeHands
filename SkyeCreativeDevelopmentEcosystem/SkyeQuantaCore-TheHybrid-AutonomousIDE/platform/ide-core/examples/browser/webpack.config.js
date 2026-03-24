/**
 * This file can be edited to customize webpack configuration.
 * To reset delete this file and rerun theia build again.
 */
// @ts-check
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');
const shellLightBundle = process.env.SKYEQUANTA_LIGHT_BUNDLE === '1';

for (const config of configs) {
    if (!Array.isArray(config.plugins)) {
        continue;
    }

    config.plugins = config.plugins.filter(plugin => plugin?.constructor?.name !== 'CompressionPlugin');

    if (shellLightBundle) {
        config.devtool = false;
        config.cache = false;
        config.stats = 'errors-warnings';
        if (config.module?.rules) {
            config.module.rules = config.module.rules.filter(rule => rule.loader !== 'source-map-loader');
        }
    }
}

if (configs[0]) {
    configs[0].name = 'frontend-main';
}

if (configs[1]) {
    configs[1].name = 'frontend-worker';
}

if (configs[2]) {
    configs[2].name = 'frontend-secondary';
}

nodeConfig.config.name = 'backend';

/**
 * Expose bundled modules on window.theia.moduleName namespace, e.g.
 * window['theia']['@theia/core/lib/common/uri'].
 * Such syntax can be used by external code, for instance, for testing.
 */
if (!shellLightBundle) {
    configs[0].module.rules.push({
        test: /\.js$/,
        loader: require.resolve('@theia/application-manager/lib/expose-loader')
    });
}


module.exports = [
    ...configs,
    nodeConfig.config
];
