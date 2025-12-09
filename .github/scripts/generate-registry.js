const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const sourceFile = path.join(process.cwd(), 'plugins-source.json');
const registryFile = path.join(process.cwd(), 'dist', 'marketplace-registry.json');
const outputFile = path.join(process.cwd(), '.github', 'scripts', 'generation-output.json');

function parseGitHubUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

function githubApiRequest(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = options.body ? JSON.stringify(options.body) : null;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'dot-x-plugins-registry',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    if (postData) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function calculateCombinedHash(metadataContent, indexContent) {
  const combined = metadataContent + '\n---SEPARATOR---\n' + indexContent;
  const hash = crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
  return `sha256-${hash}`;
}

function detectPermissionExpansion(currentPerms, newPerms) {
  const currentSet = new Set(currentPerms || []);
  const newSet = new Set(newPerms || []);
  return Array.from(newSet).some(p => !currentSet.has(p));
}

async function createSecurityReviewPR(plugin, token, repository) {
  const [owner, repo] = repository.split('/');
  const title = `[ACTION REQUIRED] Security Review for ${plugin.name} ${plugin.release_tag}`;
  const body = `## Security Review Required

The plugin **${plugin.name}** has expanded permissions in version **${plugin.release_tag}**.

### Current Permissions
${(plugin.approved_permissions || []).map(p => `- \`${p}\``).join('\n') || 'None'}

### New Permissions
${(plugin.permissions || []).map(p => `- \`${p}\``).join('\n') || 'None'}

### Action Required
Please review the permission changes and manually approve this update in the registry.

**Repository:** ${plugin.repo}
**Release:** ${plugin.release_tag}
**Integrity Hash:** ${plugin.integrity_hash}
`;

  try {
    // Create a branch for the PR
    const branchName = `security-review-${plugin.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    
    // Get default branch
    const repoInfo = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}`, token);
    const defaultBranch = repoInfo.default_branch;
    
    // Get latest commit SHA
    const ref = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
    
    // Create new branch
    await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha
      }
    });

    // Create PR
    const pr = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/pulls`, token, {
      method: 'POST',
      body: {
        title,
        body,
        head: branchName,
        base: defaultBranch
      }
    });

    console.log(`Created security review PR: ${pr.html_url}`);
    return pr.html_url;
  } catch (error) {
    console.error(`Failed to create security review PR: ${error.message}`);
    return null;
  }
}


async function processPlugin(sourcePlugin, existingPlugin, token, repository, triggerType) {
  const { owner, repo } = parseGitHubUrl(sourcePlugin.repo);
  
  // SKIP CHECK: If version matches, only update downloads
  if (existingPlugin && existingPlugin.version === sourcePlugin.release_tag) {
    console.log(`⏭️  Skipping ${sourcePlugin.name} (version unchanged)`);
    return {
      ...existingPlugin,
      downloads: existingPlugin.downloads || 0, // Placeholder for now
      // Update source fields that might have changed
      name: sourcePlugin.name,
      description: sourcePlugin.description,
      min_app_version: sourcePlugin.min_app_version,
      tags: sourcePlugin.tags,
      funding_url: sourcePlugin.funding_url,
      author: sourcePlugin.author
    };
  }

  // PROCESS NEW: Download and hash
  console.log(`📦 Processing ${sourcePlugin.name} ${sourcePlugin.release_tag}...`);

  try {
    // Get release info
    const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${sourcePlugin.release_tag}`;
    const release = await githubApiRequest(releaseUrl, token);

    // Find assets
    const metadataAsset = release.assets.find(asset => 
      asset.name === 'metadata.json' || asset.name.endsWith('/metadata.json')
    );
    const indexAsset = release.assets.find(asset => 
      asset.name === 'index.js' || asset.name.endsWith('/index.js')
    );

    if (!metadataAsset) {
      throw new Error(`metadata.json not found in release ${sourcePlugin.release_tag}`);
    }
    if (!indexAsset) {
      throw new Error(`index.js not found in release ${sourcePlugin.release_tag}`);
    }

    // Download files
    const metadataContent = await downloadFile(metadataAsset.browser_download_url);
    const indexContent = await downloadFile(indexAsset.browser_download_url);

    // Parse metadata
    const metadata = JSON.parse(metadataContent);
    const permissions = metadata.permissions || [];

    // Calculate hash
    const integrityHash = calculateCombinedHash(metadataContent, indexContent);

    // Check for permission expansion
    const hasExpansion = existingPlugin && detectPermissionExpansion(
      existingPlugin.approved_permissions || [],
      permissions
    );

    // Security gate: If permissions expanded on schedule trigger, create PR
    if (hasExpansion && triggerType === 'schedule') {
      console.log(`⚠️  Permission expansion detected for ${sourcePlugin.name}. Creating security review PR...`);
      
      const pluginData = {
        ...sourcePlugin,
        version: sourcePlugin.release_tag,
        integrity_hash: integrityHash,
        permissions: permissions,
        approved_permissions: existingPlugin.approved_permissions || [],
        metadata_url: metadataAsset.browser_download_url,
        index_url: indexAsset.browser_download_url,
        downloads: existingPlugin?.downloads || 0
      };

      await createSecurityReviewPR(pluginData, token, repository);
      
      // Return existing plugin unchanged
      return existingPlugin;
    }

    // Update plugin entry
    return {
      name: sourcePlugin.name,
      description: sourcePlugin.description,
      repo: sourcePlugin.repo,
      release_tag: sourcePlugin.release_tag,
      version: sourcePlugin.release_tag,
      min_app_version: sourcePlugin.min_app_version,
      tags: sourcePlugin.tags,
      funding_url: sourcePlugin.funding_url,
      author: sourcePlugin.author,
      integrity_hash: integrityHash,
      approved_permissions: permissions,
      downloads: existingPlugin?.downloads || 0,
      metadata_url: metadataAsset.browser_download_url,
      index_url: indexAsset.browser_download_url
    };

  } catch (error) {
    console.error(`❌ Failed to process ${sourcePlugin.name}: ${error.message}`);
    // Return existing plugin if available, or skip
    if (existingPlugin) {
      return existingPlugin;
    }
    throw error;
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const triggerType = process.env.TRIGGER_TYPE || 'push';

  if (!token) {
    console.error('Error: GITHUB_TOKEN not set');
    process.exit(1);
  }

  // Load source
  if (!fs.existsSync(sourceFile)) {
    console.error('Error: plugins-source.json not found');
    process.exit(1);
  }
  const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));

  // Load existing registry
  let existingRegistry = { generated_at: new Date().toISOString(), plugins: [] };
  if (fs.existsSync(registryFile)) {
    existingRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  }

  // Create dist directory
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });

  // Process plugins
  const existingPluginsMap = new Map();
  (existingRegistry.plugins || []).forEach(p => {
    existingPluginsMap.set(p.name, p);
  });

  const processedPlugins = [];
  let hasChanges = false;

  for (const sourcePlugin of sourceData.plugins || []) {
    const existingPlugin = existingPluginsMap.get(sourcePlugin.name);
    const processed = await processPlugin(
      sourcePlugin,
      existingPlugin,
      token,
      repository,
      triggerType
    );

    if (!existingPlugin || JSON.stringify(existingPlugin) !== JSON.stringify(processed)) {
      hasChanges = true;
    }

    processedPlugins.push(processed);
  }

  // Write registry
  const newRegistry = {
    generated_at: new Date().toISOString(),
    plugins: processedPlugins
  };

  fs.writeFileSync(registryFile, JSON.stringify(newRegistry, null, 2));
  console.log(`✅ Registry generated: ${processedPlugins.length} plugin(s)`);

  // Write output for GitHub Actions
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({ has_changes: hasChanges }, null, 2));
  
  // Set output for GitHub Actions (using GITHUB_OUTPUT)
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `has_changes=${hasChanges}\n`);
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

