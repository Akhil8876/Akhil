module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // VisionCamera frame processors run on react-native-worklets-core, which
      // is a different worklet runtime from Reanimated's. Without this plugin
      // the 'worklet' directive in useFrameProcessor is never compiled and the
      // camera silently produces no poses.
      'react-native-worklets-core/plugin',
      // Reanimated's worklet plugin must be listed last.
      'react-native-worklets/plugin',
    ],
  };
};
