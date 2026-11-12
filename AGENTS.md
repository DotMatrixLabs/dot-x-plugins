# Building a Dot X plugin

You are probably here because a user asked you to build a plugin for Dot X, the desktop app for DotMatrixLabs' Decker volume mixer and other slider devices. This repository is only the marketplace list. The plugin you write goes in its own repository.

## Read first

- [README.md](./README.md), sections "Build a plugin" and "Submitting a Plugin": the whole path from scaffold to marketplace.
- [SDK guide](https://github.com/DotMatrixLabs/dot-x/blob/main/plugin-sdk/README.md): plugin class, device events, settings pages, action mapper, toasts, manifest, permissions.
- The SDK's TypeScript types in `node_modules/@dotmatrixlabs/dotx-plugin-sdk` after `npm install`. They are the authoritative API.
- [hello-world-plugin](https://github.com/DotMatrixLabs/hello-world-plugin): copy patterns from here before inventing your own.
- Agent skill with the SDK in one file: [dot-x-plugin-dev/SKILL.md](https://github.com/DotMatrixLabs/create-dotx-plugin/blob/main/dot-x-plugin-dev/SKILL.md). Users can install it with `npx skills add DotMatrixLabs/create-dotx-plugin/dot-x-plugin-dev`.

## How to work

1. Scaffold with `npx @dotmatrixlabs/create-dotx-plugin --node --name "<Plugin Name>"`. Prefer the Node template: it has packaging and the release workflow. Do not hand-write the project layout.
2. Keep `manifest.json` honest:
   - `id` is kebab-case and must later match the marketplace entry.
   - `dotxVersion` is `">=2.0.0"`; plugins do not exist before Dot X 2.0.
   - `permissions` lists only what the code uses (`net`, `env`, `run`, `read`, `write`, `ffi`, `sys`, `hrtime`). Users approve them at install, and adding one later triggers a security review.
   - Set `platforms` if the plugin only works on some operating systems.
3. Test against a running Dot X: the user starts Dot X, then `npm run build && npm start`. The plugin connects to `localhost:3001` and shows up in Dot X under Settings > Plugins. If it cannot connect, Dot X is not running. Ask the user to check the result in the app; you cannot see it.
4. Device updates arrive through `this.device.onUpdate(({ changes, sliders }) => ...)`. Values are 0-100, and every control is included in each update, so compare `oldValue` with `newValue` to find what moved.
5. Package with `npm run package` and check that `dist/<plugin-name>.dotxplugin` exists.
6. Publishing needs the user's GitHub account. Tell the user to create the repository, push a tag like `v0.1.0` so the release workflow attaches the package, and then open a pull request here that adds the plugin to `plugins-source.json`. Fill in the entry from the README; do not edit `dist/`, which is generated.

Do not commit secrets, tokens or a user's credentials to a plugin repository. If the plugin needs credentials, add a settings field so the user enters them in Dot X.
