# dot-x-plugins

The official registry and submission hub for Dot X plugins.

## Overview

This repository serves as the official plugin marketplace for Dot X. It holds the list of published plugins and the checks that run on submissions. It does not hold plugin code: each plugin lives in its own repository and is installed from that repository's GitHub Releases.

Using an AI coding agent? Point it at this repository and see [AGENTS.md](./AGENTS.md).

## Build a plugin

Plugins need Dot X 2.0 or newer ([download](https://github.com/DotMatrixLabs/dot-x/releases)). A plugin is a small Node or Deno program that connects to the running Dot X app and can react to slider changes, control RGB, add buttons to the action mapper, and add its own settings page.

1. **Scaffold a project.** The Node template includes packaging and a release workflow for the marketplace:
   ```bash
   mkdir my-plugin && cd my-plugin
   npx @dotmatrixlabs/create-dotx-plugin --node --name "My Plugin"
   ```
2. **Run it against Dot X.** Start Dot X first; it runs the plugin server on `localhost:3001`. Then:
   ```bash
   npm install
   npm run build
   npm start
   ```
   The plugin registers with Dot X and appears in Settings under Plugins with an "External" badge. Logs go to your terminal and to `plugin.log` in the plugin folder.
3. **Write the plugin** with the SDK, `@dotmatrixlabs/dotx-plugin-sdk`. The [SDK guide](https://github.com/DotMatrixLabs/dot-x/blob/main/plugin-sdk/README.md) covers the plugin class, device events, settings pages, the action mapper, toasts, and the manifest. The SDK's TypeScript types document every call.
4. **Package it** with `npm run package`, which builds `dist/<plugin-name>.dotxplugin`. Open that file (Dot X registers the file type) to install and test the packaged version.
5. **Release it.** Push a version tag such as `v0.1.0`. The generated `.github/workflows/release-plugin.yml` attaches `<plugin-name>.dotxplugin` to a GitHub Release.
6. **Submit it** to the marketplace with a pull request to this repository, as described below.

Working examples:

- [hello-world-plugin](https://github.com/DotMatrixLabs/hello-world-plugin): reference plugin that uses most SDK features
- [dotx-mqtt-plugin](https://github.com/DotMatrixLabs/dotx-mqtt-plugin): publishes slider values to MQTT and Home Assistant
- [dotx-streamdeck-plugin](https://github.com/DotMatrixLabs/dotx-streamdeck-plugin): Stream Deck Companion integration

## Architecture

### Core Components

1. **Source Register** (`plugins-source.json`)
   - The single source of truth for developer submissions
   - Developers submit PRs to modify this file
   - Contains plugin metadata: id, name, author, description, repo, tags

2. **Final Register** (`dist/marketplace-registry.json`)
   - The read-only registry consumed by Dot X
   - Generated automatically by GitHub Actions
   - Hosted via GitHub Pages
   - Includes integrity hashes and verified permissions

3. **GitHub Actions Workflows**
   - **PR Validation**: Validates submissions before merge
   - **Registry Generation**: Automatically builds and deploys the registry

### Security Features

#### Integrity Verification
- SHA-256 hash calculated at approval time
- Hash covers the raw `<plugin-name>.dotxplugin` bytes
- App verifies hash before installation
- Any byte change invalidates the hash and blocks installation

#### Permission Expansion Detection
- Tracks approved permissions for each plugin version
- If permissions expand during scheduled updates, creates a security review PR
- Requires human approval for permission changes

## Submitting a Plugin

### Prerequisites

1. Your plugin must be published as a GitHub Release
2. The latest release must include:
   - `<plugin-name>.dotxplugin` - A self-contained plugin package
3. The `id` field in your `manifest.json` must match the `id` you specify in `plugins-source.json`

### Marketplace Release Format: Archive Package

The Dot X marketplace installer downloads exactly one package asset per release:

- `<plugin-name>.dotxplugin`

The archive root must contain:

- `manifest.json`
- the entry file declared by `manifest.json` -> `main`

The archive may also contain additional files and directories, such as:

- `bin/windows-x64/...`
- `bin/windows-arm64/...`
- `bin/macos-x64/...`
- `bin/macos-arm64/...`
- `bin/linux-x64/...`
- `assets/...`
- `data/...`

### Submission Process

1. **Fork this repository**

2. **Add your plugin to `plugins-source.json`**:
   ```json
   {
     "$schema": "./schemas/plugins-source.schema.json",
     "plugins": [
       {
         "id": "my-awesome-plugin",
         "name": "My Awesome Plugin",
         "author": "Your Name",
         "description": "A plugin that does awesome things",
         "repo": "https://github.com/username/my-awesome-plugin",
         "tags": ["productivity", "ui"],
         "funding_url": "https://github.com/sponsors/username"
       }
     ]
   }
   ```

3. **Create a Pull Request**
   - The PR validation workflow will automatically:
     - Validate JSON schema
     - Verify the GitHub repo and latest release exist
     - Select `<plugin-name>.dotxplugin` and verify it is a valid plugin package
     - Open the package and verify root `manifest.json` and the declared entry file
     - Verify the `id` in `manifest.json` matches your submission
     - Post a comment listing detected permissions

4. **Wait for Review**
   - Maintainers will review your submission
   - Once approved and merged, the registry will be automatically updated

### Plugin Manifest Format

Your `manifest.json` must be included inside `<plugin-name>.dotxplugin` and should follow this structure:

```json
{
  "id": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Your Name",
  "dotxVersion": ">=2.0.0",
  "main": "main.js",
  "permissions": [
    "net"
  ],
  "license": "MIT"
}
```

**Required Fields:**
- `id` - Must match the `id` in `plugins-source.json`
- `name` - Display name for your plugin
- `version` - Plugin version (semver)
- `description` - Short description
- `author` - Author name
- `dotxVersion` - Dot X versions the plugin supports, as a semver range (e.g., ">=2.0.0"). Plugins exist from Dot X 2.0; a 2.0.0 beta satisfies ">=2.0.0".
- `permissions` - Array of permission strings; use `[]` if the plugin needs no extra access

**Optional Fields:**
- `platforms` - Operating systems the plugin supports: any of `"windows"`, `"macos"`, `"linux"`. Omit to support all.
- `packaging.include` - Extra files or folders to put in `<plugin-name>.dotxplugin`
- `license` - License identifier, such as `"MIT"`

**Common Permissions:**
- `env` - Read the user's full environment. Without it, a plugin sees only the variables Dot X sets for it (`DOTX_PLUGIN_*`) and a few common ones such as `PATH`, `NODE_ENV` and `TZ`.
- `net` - Network access
- `read` - File system read access
- `write` - File system write access
- `run` - Subprocess execution
- `ffi` - Foreign function interface access

**Note:** The registry automatically uses the **latest release** from your repository. Make sure the latest release includes `<plugin-name>.dotxplugin` containing root `manifest.json` and the file declared by `manifest.main`.

### Publishing Checklist for the Package Format

Before you publish a GitHub Release, make sure:

1. Your plugin is built to the entry file declared by `manifest.main`.
2. `manifest.json` references the compiled entrypoint with a relative path, such as `"main": "main.js"` or `"main": "dist/main.js"`.
3. Place `manifest.json`, the declared entry file, and any required binaries/assets into a staging directory.
4. Create `<plugin-name>.dotxplugin` from that staging directory, with `manifest.json` at the archive root.
5. The `id` in `manifest.json` matches the `id` in `plugins-source.json`.
6. The latest release is the one you want Dot X to install from.

If you currently publish from GitHub Releases, you do not need a different hosting setup. You only need to make sure the release contains `<plugin-name>.dotxplugin`, which is a zip archive.

## Registry Schema

### Source Schema (`plugins-source.json`)

```typescript
{
  plugins: Array<{
    id: string;              // Unique plugin ID (must match manifest.json)
    name: string;            // Display name
    author: string;          // Author name
    description: string;     // Plugin description
    repo: string;            // GitHub repository URL
    tags: string[];          // Array of tags
    funding_url?: string;    // Optional funding/sponsorship URL
  }>
}
```

### Generated Registry Schema (`dist/marketplace-registry.json`)

```typescript
{
  generated_at: string;
  plugins: Array<{
    id: string;                    // Plugin ID
    name: string;                  // Display name
    description: string;           // Description
    repo: string;                 // Repository URL
    version: string;               // Plugin version from packaged manifest.json
    dotxVersion: string | null;    // Minimum Dot X version from manifest
    tags: string[];                // Tags
    author: string;                // Author
    funding_url?: string;          // Optional funding URL
    package_url: string;           // URL to <plugin-name>.dotxplugin asset
    package_format: "zip";         // Package format
    package_integrity_hash: string; // SHA-256 hash of <plugin-name>.dotxplugin bytes
    package_size?: number;         // Package size in bytes
    approved_permissions: string[]; // Approved permissions
    likes: number;                 // Like count
    downloads: number;             // Download count
  }>
}
```

## GitHub Actions

### PR Validation Workflow

**Trigger:** Pull requests targeting `plugins-source.json`

**Actions:**
1. Validates JSON schema
2. Verifies GitHub repo and latest release exist
3. Selects `<plugin-name>.dotxplugin` and verifies it is a valid plugin package
4. Opens the package and verifies root `manifest.json` and the declared entry file
5. Verifies `manifest.json` id matches the submission
6. Extracts permissions from the packaged manifest
7. Posts PR comment with permission summary

### Registry Generation Workflow

**Triggers:**
- Scheduled: Every 4 hours
- Push to main branch (when `plugins-source.json` changes)
- Manual dispatch

**Actions:**
1. Loads source and existing registry
2. For each plugin:
   - Fetches the latest GitHub release
   - Selects `<plugin-name>.dotxplugin`, downloads it, hashes the raw archive, opens the package, and extracts `version`, permissions, and `dotxVersion`
   - If packaged version unchanged: updates mutable fields (name, description, tags, etc.) only
   - If packaged version changed: updates the registry entry to the new package metadata
   - Creates security review PR if permissions expanded during scheduled update
3. Fetches the latest `likes` and `downloads` from Supabase and merges them into `dist/marketplace-registry.json`
4. Deploys to GitHub Pages
5. Commits changes to repository

## Accessing the Registry

The registry is available at:
```
https://dotmatrixlabs.github.io/dot-x-plugins/marketplace-registry.json
```

## Security Considerations

The registry prevents "Trojanning" attacks through immutable hashes, hash verification, and permission tracking. Permission expansions detected during scheduled updates automatically trigger a security review PR requiring human approval.

## Development

### Local Testing

1. Install dependencies:
   ```bash
   npm install
   ```

2. Validate schema:
   ```bash
   node .github/scripts/validate-schema.js
   ```

3. Test registry generation (requires GITHUB_TOKEN):
   ```bash
   GITHUB_TOKEN=your_token node .github/scripts/generate-registry.js
   ```

4. Apply the stats schema and deploy the functions with the Supabase CLI:
   ```bash
   npx supabase db push
   npx supabase functions deploy set-plugin-like
   npx supabase functions deploy record-plugin-download
   ```

## Contributing

Contributions are welcome! Please:

1. Follow the existing code style
2. Ensure all workflows pass
3. Update documentation as needed
4. Test your changes locally when possible

## License

MIT. See [LICENSE](./LICENSE).
