const fs = require('fs');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');

const sourceFile = path.join(process.cwd(), 'plugins-source.json');
const resultsFile = path.join(process.cwd(), '.github', 'scripts', 'verification-results.json');

function getChangedPlugins() {
  const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  return sourceData.plugins || [];
}

function parseGitHubUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

function githubApiRequest(url, token) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'dot-x-plugins-validator',
        Accept: 'application/vnd.github.v3+json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    }).on('error', reject);
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

function inspectPackageBuffer(packageBuffer, pluginId) {
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
  if (manifest.id !== pluginId) {
    throw new Error(`Plugin ID mismatch: expected ${pluginId}, found ${manifest.id} in manifest.json`);
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
    permissions: manifest.permissions
  };
}

async function verifyPlugin(plugin, token) {
  const { owner, repo } = parseGitHubUrl(plugin.repo);
  const results = {
    id: plugin.id,
    name: plugin.name,
    status: 'ok',
    permissions: [],
    release_assets: []
  };

  try {
    const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const release = await githubApiRequest(releaseUrl, token);
    const packageAsset = selectPackageAsset(release);
    const packageBuffer = await downloadBuffer(packageAsset.browser_download_url);
    const inspection = inspectPackageBuffer(packageBuffer, plugin.id);

    results.permissions = inspection.permissions;
    results.release_assets = [packageAsset.name];

    console.log(`Verified ${plugin.name} (${plugin.id}): ${results.permissions.length} permissions`);
    return results;
  } catch (error) {
    console.error(`Failed to verify ${plugin.name} (${plugin.id}): ${error.message}`);
    results.status = 'error';
    results.error = error.message;
    return results;
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN not set');
    process.exit(1);
  }

  const plugins = getChangedPlugins();
  if (plugins.length === 0) {
    console.log('No plugins to verify');
    fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
    fs.writeFileSync(resultsFile, JSON.stringify([], null, 2));
    process.exit(0);
  }

  console.log(`Verifying ${plugins.length} plugin(s)...`);

  const results = [];
  for (const plugin of plugins) {
    const result = await verifyPlugin(plugin, token);
    results.push(result);

    if (result.status === 'error') {
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

  console.log('All plugins verified successfully');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
