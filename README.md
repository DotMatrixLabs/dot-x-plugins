# dot-x-plugins

The official registry and submission hub for Dot X plugins.

## Overview

This repository serves as the official plugin marketplace for Dot X.

## Architecture

### Core Components

1. **Source Register** (`plugins-source.json`)
   - The single source of truth for developer submissions
   - Developers submit PRs to modify this file
   - Contains plugin metadata: name, description, repo, release tag, etc.

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
         "funding_url": "https://github.com/sponsors/username"
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
- `--allow-ffi` - Foreign function interface access

## Registry Schema

### Source Schema (`plugins-source.json`)

```typescript
{
  plugins: Array<{
    name: string;
    description: string;
    repo: string;
    release_tag: string;
    min_app_version: string;
    tags: string[];
    author: string;
    funding_url?: string;
  }>
}
```

### Generated Registry Schema (`dist/marketplace-registry.json`)

```typescript
{
  generated_at: string;
  plugins: Array<{
    version: string;
    integrity_hash: string;
    approved_permissions: string[];
    downloads: number;
    metadata_url: string;
    index_url: string;
  }>
}
```

## GitHub Actions

### PR Validation Workflow

**Trigger:** Pull requests targeting `plugins-source.json`

**Actions:**
1. Validates JSON schema
2. Verifies GitHub repo and release exist
3. Downloads `metadata.json` and extracts permissions
4. Posts PR comment with permission summary

### Registry Generation Workflow

**Triggers:**
- Scheduled: Every 12 hours
- Push to main branch (when `plugins-source.json` changes)
- Manual dispatch

**Actions:**
1. Loads source and existing registry
2. For each plugin:
   - Updates download count if unchanged
   - Downloads files, calculates hash, extracts permissions if new/changed
   - Creates security review PR if permissions expanded during scheduled update
3. Generates `dist/marketplace-registry.json`
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

## Contributing

Contributions are welcome! Please:

1. Follow the existing code style
2. Ensure all workflows pass
3. Update documentation as needed
4. Test your changes locally when possible

## License

[Add your license here]
