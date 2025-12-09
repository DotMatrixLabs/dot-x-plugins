# dot-x-plugins

The official registry and submission hub for Dot X plugins.

## Overview

This repository serves as the secure, decentralized plugin marketplace for the Dot X application. It implements supply chain security measures to prevent "Trojanning" attacks where malicious code could be swapped after initial approval.

## Architecture

### Core Components

1. **Source Register** (`plugins-source.json`)
   - The single source of truth for developer submissions
   - Developers submit PRs to modify this file
   - Contains plugin metadata: name, description, repo, release tag, etc.

2. **Final Register** (`dist/marketplace-registry.json`)
   - The read-only registry consumed by the Tauri app
   - Generated automatically by GitHub Actions
   - Hosted via GitHub Pages
   - Includes integrity hashes and verified permissions

3. **GitHub Actions Workflows**
   - **PR Validation**: Validates submissions before merge
   - **Registry Generation**: Automatically builds and deploys the registry

### Security Features

#### Integrity Verification
- SHA-256 hash calculated at approval time
- Hash includes both `metadata.json` and `index.js` files
- App verifies hash before installation
- Any byte change invalidates the hash and blocks installation

#### Permission Expansion Detection
- Tracks approved permissions for each plugin version
- If permissions expand during scheduled updates, creates a security review PR
- Requires human approval for permission changes

## Submitting a Plugin

### Prerequisites

1. Your plugin must be published as a GitHub Release
2. The release must include:
   - `metadata.json` - Plugin metadata including permissions
   - `index.js` - The plugin code

### Submission Process

1. **Fork this repository**

2. **Add your plugin to `plugins-source.json`**:
   ```json
   {
     "$schema": "./schemas/plugins-source.schema.json",
     "plugins": [
       {
         "name": "my-awesome-plugin",
         "description": "A plugin that does awesome things",
         "repo": "https://github.com/username/my-awesome-plugin",
         "release_tag": "v1.0.0",
         "min_app_version": "1.0.0",
         "tags": ["productivity", "ui"],
         "author": "Your Name",
         "funding_url": "https://github.com/sponsors/username" // optional
       }
     ]
   }
   ```

3. **Create a Pull Request**
   - The PR validation workflow will automatically:
     - Validate JSON schema
     - Verify the GitHub repo and release exist
     - Download and analyze `metadata.json`
     - Post a comment listing detected permissions

4. **Wait for Review**
   - Maintainers will review your submission
   - Once approved and merged, the registry will be automatically updated

### Plugin Metadata Format

Your `metadata.json` should follow this structure:

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "permissions": [
    "--allow-net",
    "--allow-read"
  ]
}
```

**Common Deno Permissions:**
- `--allow-net` - Network access
- `--allow-read` - File system read access
- `--allow-write` - File system write access
- `--allow-env` - Environment variable access
- `--allow-run` - Subprocess execution
- `--allow-ffi` - Foreign function interface

## Registry Schema

### Source Schema (`plugins-source.json`)

```typescript
{
  plugins: Array<{
    name: string;              // Unique plugin identifier
    description: string;        // Plugin description
    repo: string;              // GitHub repository URL
    release_tag: string;        // Release tag (e.g., "v1.0.0")
    min_app_version: string;   // Minimum app version (semver)
    tags: string[];            // Array of tags
    author: string;            // Author name
    funding_url?: string;     // Optional funding URL
  }>
}
```

### Generated Registry Schema (`dist/marketplace-registry.json`)

```typescript
{
  generated_at: string;        // ISO timestamp
  plugins: Array<{
    // ... all source fields ...
    version: string;           // Same as release_tag
    integrity_hash: string;     // SHA-256 hash (sha256-...)
    approved_permissions: string[]; // Extracted from metadata.json
    downloads: number;         // Download count
    metadata_url: string;      // Direct download URL
    index_url: string;         // Direct download URL
  }>
}
```

## GitHub Actions

### PR Validation Workflow

**Trigger:** Pull requests targeting `plugins-source.json`

**Actions:**
1. Validates JSON schema
2. Verifies GitHub repo and release exist
3. Downloads `metadata.json` to extract permissions
4. Posts PR comment with permission summary

### Registry Generation Workflow

**Triggers:**
- Scheduled: Every 12 hours
- Push to main branch (when `plugins-source.json` changes)
- Manual dispatch

**Actions:**
1. Loads source and existing registry
2. For each plugin:
   - **Skip if unchanged**: Updates only download count
   - **Process if new/changed**: Downloads files, calculates hash, extracts permissions
   - **Security gate**: If permissions expanded on schedule, creates security review PR
3. Generates `dist/marketplace-registry.json`
4. Deploys to GitHub Pages
5. Commits changes to repository

## Accessing the Registry

The registry is available at:
```
https://<user>.github.io/dot-x-plugins/marketplace-registry.json
```

Or via the repository's GitHub Pages URL.

## Security Considerations

### Preventing Trojanning

The registry prevents "Trojanning" attacks through:

1. **Immutable Hashes**: Once a version is approved, its hash is locked
2. **Hash Verification**: The app verifies the hash before installation
3. **Permission Tracking**: Permission changes require explicit review
4. **Automated Monitoring**: Scheduled checks detect unexpected changes

### Permission Expansion

When a plugin's permissions expand:
- During PR review: Normal review process applies
- During scheduled update: A security review PR is automatically created
- Human approval required before registry update

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

## Contributing

Contributions are welcome! Please:

1. Follow the existing code style
2. Ensure all workflows pass
3. Update documentation as needed
4. Test your changes locally when possible

## License

[Add your license here]
