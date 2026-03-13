# dot-x-plugins

The official registry and submission hub for Dot X plugins.

## Overview

This repository serves as the official plugin marketplace for Dot X.

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
- Hash includes both `manifest.json` and `main.js` files
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
   - `manifest.json` - Plugin manifest including id, permissions, and dotxVersion
   - `main.js` - The plugin code
3. The `id` field in your `manifest.json` must match the `id` you specify in `plugins-source.json`

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
     - Download and analyze `manifest.json` from the latest release
     - Verify the `id` in `manifest.json` matches your submission
     - Post a comment listing detected permissions

4. **Wait for Review**
   - Maintainers will review your submission
   - Once approved and merged, the registry will be automatically updated

### Plugin Manifest Format

Your `manifest.json` must be included in your GitHub release assets and should follow this structure:

```json
{
  "id": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Your Name",
  "dotxVersion": ">=1.0.0",
  "main": "main.ts",
  "permissions": [
    "env"
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
- `dotxVersion` - Minimum Dot X version requirement (e.g., ">=1.0.0")
- `permissions` - Array of permission strings

**Common Permissions:**
- `env` - Environment variable access
- `net` - Network access
- `read` - File system read access
- `write` - File system write access
- `run` - Subprocess execution
- `ffi` - Foreign function interface access

**Note:** The registry automatically uses the **latest release** from your repository. Make sure your latest release includes both `manifest.json` and `main.js`.

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
    version: string;               // Latest release tag
    dotxVersion: string | null;    // Minimum Dot X version from manifest
    tags: string[];                // Tags
    author: string;                // Author
    funding_url?: string;          // Optional funding URL
    integrity_hash: string;        // SHA-256 hash of manifest.json + main.js
    approved_permissions: string[]; // Approved permissions
    likes: number;                 // Like count
    downloads: number;             // Download count
    manifest_url: string;          // URL to manifest.json asset
    index_url: string;             // URL to main.js asset
  }>
}
```

## GitHub Actions

### PR Validation Workflow

**Trigger:** Pull requests targeting `plugins-source.json`

**Actions:**
1. Validates JSON schema
2. Verifies GitHub repo and latest release exist
3. Downloads `manifest.json` from latest release and verifies `id` matches
4. Extracts permissions from manifest
5. Posts PR comment with permission summary

### Registry Generation Workflow

**Triggers:**
- Scheduled: Every 4 hours
- Push to main branch (when `plugins-source.json` changes)
- Manual dispatch

**Actions:**
1. Loads source and existing registry
2. For each plugin:
   - Fetches the latest GitHub release
   - Compares latest release tag to stored version
   - If version unchanged: updates mutable fields (name, description, tags, etc.) only
   - If version changed: downloads `manifest.json` and `main.js`, calculates hash, extracts permissions and `dotxVersion`
   - Creates security review PR if permissions expanded during scheduled update
3. Fetches the latest `likes` and `downloads` from Supabase and merges them into `dist/marketplace-registry.json`
4. Deploys to GitHub Pages
5. Commits changes to repository

## Accessing the Registry

The registry is available at:
```
https://<user>.github.io/dot-x-plugins/marketplace-registry.json
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

[Add your license here]
