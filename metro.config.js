// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro treats unknown extensions as source files and tries to parse them.
// The pose model is a binary asset, so it has to be declared as one or the
// bundler fails on `require('...movenet-lightning.tflite')`.
config.resolver.assetExts.push('tflite');

module.exports = config;
