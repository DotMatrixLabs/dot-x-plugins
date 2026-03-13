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

function httpJsonRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : []);
        } else {
          reject(new Error(`HTTP ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
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

function calculateCombinedHash(manifestContent, indexContent) {
  const combined = manifestContent + '\n---SEPARATOR---\n' + indexContent;
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
  const title = `[ACTION REQUIRED] Security Review for ${plugin.name} ${plugin.version}`;
  const body = `## Security Review Required

The plugin **${plugin.name}** (${plugin.id}) has expanded permissions in version **${plugin.version}**.

### Current Permissions
${(plugin.approved_permissions || []).map(p => `- \`${p}\``).join('\n') || 'None'}

### New Permissions
${(plugin.permissions || []).map(p => `- \`${p}\``).join('\n') || 'None'}

### Action Required
Please review the permission changes and manually approve this update in the registry.

**Repository:** ${plugin.repo}
**Release:** ${plugin.version}
**Integrity Hash:** ${plugin.integrity_hash}
`;

  try {
    // Create a branch for the PR
    const branchName = `security-review-${plugin.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    
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
  
  try {
    const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const release = await githubApiRequest(releaseUrl, token);
    const latestTag = release.tag_name;

    if (existingPlugin && existingPlugin.version === latestTag) {
      console.log(`⏭️  Skipping ${sourcePlugin.name} (${sourcePlugin.id}) - version unchanged (${latestTag})`);
      return {
        ...existingPlugin,
        id: sourcePlugin.id,
        name: sourcePlugin.name,
        description: sourcePlugin.description,
        tags: sourcePlugin.tags,
        funding_url: sourcePlugin.funding_url,
        author: sourcePlugin.author
      };
    }

    console.log(`📦 Processing ${sourcePlugin.name} (${sourcePlugin.id}) - latest release: ${latestTag}...`);

    const manifestAsset = release.assets.find(asset => 
      asset.name === 'manifest.json' || asset.name.endsWith('/manifest.json')
    );
    const indexAsset = release.assets.find(asset => 
      asset.name === 'main.js' || asset.name.endsWith('/main.js')
    );

    if (!manifestAsset) {
      throw new Error(`manifest.json not found in latest release ${latestTag}`);
    }
    if (!indexAsset) {
      throw new Error(`main.js not found in latest release ${latestTag}`);
    }

    const manifestContent = await downloadFile(manifestAsset.browser_download_url);
    const indexContent = await downloadFile(indexAsset.browser_download_url);

    const manifest = JSON.parse(manifestContent);
    
    if (manifest.id !== sourcePlugin.id) {
      throw new Error(`Plugin ID mismatch: expected ${sourcePlugin.id}, found ${manifest.id} in manifest.json`);
    }
    
    const permissions = manifest.permissions || [];
    const dotxVersion = manifest.dotxVersion || null;

    const integrityHash = calculateCombinedHash(manifestContent, indexContent);

    const hasExpansion = existingPlugin && detectPermissionExpansion(
      existingPlugin.approved_permissions || [],
      permissions
    );

    if (hasExpansion && triggerType === 'schedule') {
      console.log(`⚠️  Permission expansion detected for ${sourcePlugin.name} (${sourcePlugin.id}). Creating security review PR...`);
      
      const pluginData = {
        ...sourcePlugin,
        version: latestTag,
        integrity_hash: integrityHash,
        permissions: permissions,
        approved_permissions: existingPlugin.approved_permissions || [],
        manifest_url: manifestAsset.browser_download_url,
        index_url: indexAsset.browser_download_url,
        likes: existingPlugin?.likes || 0,
        downloads: existingPlugin?.downloads || 0
      };

      await createSecurityReviewPR(pluginData, token, repository);
      
      return existingPlugin;
    }

    return {
      id: sourcePlugin.id,
      name: sourcePlugin.name,
      description: sourcePlugin.description,
      repo: sourcePlugin.repo,
      version: latestTag,
      dotxVersion: dotxVersion,
      tags: sourcePlugin.tags,
      funding_url: sourcePlugin.funding_url,
      author: sourcePlugin.author,
      integrity_hash: integrityHash,
      approved_permissions: permissions,
      likes: existingPlugin?.likes || 0,
      downloads: existingPlugin?.downloads || 0,
      manifest_url: manifestAsset.browser_download_url,
      index_url: indexAsset.browser_download_url
    };

  } catch (error) {
    console.error(`❌ Failed to process ${sourcePlugin.name} (${sourcePlugin.id}): ${error.message}`);
    if (existingPlugin) {
      return existingPlugin;
    }
    throw error;
  }
}

async function fetchPluginStats() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Reusing existing registry stats.');
    return null;
  }

  const normalizedUrl = supabaseUrl.replace(/\/+$/, '');
  const statsUrl = `${normalizedUrl}/rest/v1/plugin_stats_rollup?select=plugin_id,likes,downloads`;
  const rows = await httpJsonRequest(statsUrl, {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Accept': 'application/json'
  });

  return new Map((rows || []).map((row) => [
    row.plugin_id,
    {
      likes: Number(row.likes || 0),
      downloads: Number(row.downloads || 0),
    }
  ]));
}

function mergePluginStats(plugins, existingPluginsMap, statsMap) {
  return plugins.map((plugin) => {
    const existingPlugin = existingPluginsMap.get(plugin.id) || {};
    const stats = statsMap?.get(plugin.id);

    return {
      ...plugin,
      likes: stats ? stats.likes : Number(existingPlugin.likes || 0),
      downloads: stats ? stats.downloads : Number(existingPlugin.downloads || 0),
    };
  });
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

  const existingPluginsMap = new Map();
  (existingRegistry.plugins || []).forEach(p => {
    const key = p.id || p.name;
    existingPluginsMap.set(key, p);
  });

  const processedPlugins = [];

  for (const sourcePlugin of sourceData.plugins || []) {
    const existingPlugin = existingPluginsMap.get(sourcePlugin.id);
    const processed = await processPlugin(
      sourcePlugin,
      existingPlugin,
      token,
      repository,
      triggerType
    );

    processedPlugins.push(processed);
  }

  const statsMap = await fetchPluginStats();
  const finalPlugins = mergePluginStats(processedPlugins, existingPluginsMap, statsMap);
  const hasChanges = finalPlugins.some((plugin) => {
    const existingPlugin = existingPluginsMap.get(plugin.id);
    return !existingPlugin || JSON.stringify(existingPlugin) !== JSON.stringify(plugin);
  });

  // Write registry
  const newRegistry = {
    generated_at: new Date().toISOString(),
    plugins: finalPlugins
  };

  fs.writeFileSync(registryFile, JSON.stringify(newRegistry, null, 2));
  console.log(`✅ Registry generated: ${finalPlugins.length} plugin(s)`);

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
