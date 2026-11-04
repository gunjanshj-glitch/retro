// Lets Metro read the shared TypeScript packages that live outside this folder.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const root = path.resolve(__dirname, "..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, "packages"), path.join(root, "content")];
config.resolver.extraNodeModules = {
  "@retro/core": path.join(root, "packages/core"),
  "@retro/api-client": path.join(root, "packages/api-client"),
  "@retro/chat-flow": path.join(root, "packages/chat-flow"),
};

module.exports = config;
