const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const AdmZip = require('adm-zip');

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
        Authorization: `token ${token}`,
        'User-Agent': 'dot-x-plugins-registry',
        Accept: 'application/vnd.github.v3+json'
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

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function calculatePackageHash(packageBuffer) {
  return `sha256-${crypto.createHash('sha256').update(packageBuffer).digest('hex')}`;
}

function detectPermissionExpansion(currentPerms, newPerms) {
  const currentSet = new Set(currentPerms || []);
  const newSet = new Set(newPerms || []);
  return Array.from(newSet).some(p => !currentSet.has(p));
}

function selectPackageAsset(release) {
  const zipAssets = (release.assets || []).filter(asset => asset.name.toLowerCase().endsWith('.zip'));
  const preferred = zipAssets.find(asset => asset.name === 'plugin.zip');
  if (preferred) {
    return preferred;
  }
  if (zipAssets.length === 1) {
    return zipAssets[0];
  }
  if (zipAssets.length === 0) {
    throw new Error(`No zip asset found in latest release ${release.tag_name}`);
  }
  throw new Error(
    `Multiple zip assets found in latest release ${release.tag_name}. Upload plugin.zip or leave exactly one zip asset in the release.`
  );
}

function inspectPackageBuffer(packageBuffer, sourcePluginId) {
  const zip = new AdmZip(packageBuffer);
  const entries = zip.getEntries().filter(entry => !entry.isDirectory);

  const manifestEntry = entries.find(entry => entry.entryName === 'manifest.json');
  const mainEntry = entries.find(entry => entry.entryName === 'main.js');

  if (!manifestEntry) {
    throw new Error('plugin package must contain manifest.json at the archive root');
  }
  if (!mainEntry) {
    throw new Error('plugin package must contain main.js at the archive root');
  }

  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest.id !== sourcePluginId) {
    throw new Error(`Plugin ID mismatch: expected ${sourcePluginId}, found ${manifest.id} in manifest.json`);
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error('manifest.json is missing a string "version" field');
  }
  if (!manifest.dotxVersion || typeof manifest.dotxVersion !== 'string') {
    throw new Error('manifest.json is missing a string "dotxVersion" field');
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new Error('manifest.json is missing a "permissions" array');
  }
  if (manifest.permissions.some(permission => typeof permission !== 'string')) {
    throw new Error('manifest.json permissions must contain only strings');
  }
  if (manifest.main && manifest.main !== 'main.js') {
    throw new Error(`manifest.json must reference "main.js" for the marketplace package format. Found: ${manifest.main}`);
  }

  return {
    manifest,
    version: manifest.version,
    permissions: manifest.permissions,
    dotxVersion: manifest.dotxVersion,
  };
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
**Package URL:** ${plugin.package_url}
**Package Integrity Hash:** ${plugin.package_integrity_hash}
`;

  try {
    const branchName = `security-review-${plugin.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    const repoInfo = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}`, token);
    const defaultBranch = repoInfo.default_branch;
    const ref = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);

    await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha
      }
    });

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
    console.log(`Processing ${sourcePlugin.name} (${sourcePlugin.id}) - latest release: ${latestTag}...`);
    const packageAsset = selectPackageAsset(release);
    const packageBuffer = await downloadBuffer(packageAsset.browser_download_url);
    const { version, permissions, dotxVersion } = inspectPackageBuffer(packageBuffer, sourcePlugin.id);
    const packageIntegrityHash = calculatePackageHash(packageBuffer);
    const hasPackageFields = Boolean(
      existingPlugin &&
      existingPlugin.package_url &&
      existingPlugin.package_integrity_hash &&
      existingPlugin.package_format
    );

    if (existingPlugin && existingPlugin.version === version && hasPackageFields) {
      console.log(`Skipping ${sourcePlugin.name} (${sourcePlugin.id}) - version unchanged (${version})`);
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

    const hasExpansion = existingPlugin && detectPermissionExpansion(
      existingPlugin.approved_permissions || [],
      permissions
    );

    if (hasExpansion && triggerType === 'schedule') {
      console.log(`Permission expansion detected for ${sourcePlugin.name} (${sourcePlugin.id}). Creating security review PR...`);

      const pluginData = {
        ...sourcePlugin,
        version,
        package_integrity_hash: packageIntegrityHash,
        package_url: packageAsset.browser_download_url,
        package_format: 'zip',
        package_size: Number(packageAsset.size || packageBuffer.length || 0),
        permissions,
        approved_permissions: existingPlugin.approved_permissions || [],
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
      version,
      dotxVersion,
      tags: sourcePlugin.tags,
      funding_url: sourcePlugin.funding_url,
      author: sourcePlugin.author,
      package_url: packageAsset.browser_download_url,
      package_format: 'zip',
      package_integrity_hash: packageIntegrityHash,
      package_size: Number(packageAsset.size || packageBuffer.length || 0),
      approved_permissions: permissions,
      likes: existingPlugin?.likes || 0,
      downloads: existingPlugin?.downloads || 0,
    };
  } catch (error) {
    console.error(`Failed to process ${sourcePlugin.name} (${sourcePlugin.id}): ${error.message}`);
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
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json'
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

  if (!fs.existsSync(sourceFile)) {
    console.error('Error: plugins-source.json not found');
    process.exit(1);
  }
  const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));

  let existingRegistry = { generated_at: new Date().toISOString(), plugins: [] };
  if (fs.existsSync(registryFile)) {
    existingRegistry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  }

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

  const newRegistry = {
    generated_at: new Date().toISOString(),
    plugins: finalPlugins
  };

  fs.writeFileSync(registryFile, JSON.stringify(newRegistry, null, 2));
  console.log(`Registry generated: ${finalPlugins.length} plugin(s)`);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({ has_changes: hasChanges }, null, 2));

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
