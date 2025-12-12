const fs = require('fs');
const path = require('path');
const https = require('https');

const sourceFile = path.join(process.cwd(), 'plugins-source.json');
const resultsFile = path.join(process.cwd(), '.github', 'scripts', 'verification-results.json');

// Get changed plugins from PR
function getChangedPlugins() {
  const sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  
  // In a PR context, we compare with base branch
  // For simplicity, validate all plugins (can be optimized later)
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
        'Authorization': `token ${token}`,
        'User-Agent': 'dot-x-plugins-validator',
        'Accept': 'application/vnd.github.v3+json'
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

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
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

async function verifyPlugin(plugin, token) {
  const { owner, repo } = parseGitHubUrl(plugin.repo);
  const results = {
    id: plugin.id,
    name: plugin.name,
    status: 'ok',
    permissions: []
  };

  try {
    const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const release = await githubApiRequest(releaseUrl, token);
    
    const manifestAsset = release.assets.find(asset => 
      asset.name === 'manifest.json' || asset.name.endsWith('/manifest.json')
    );

    if (!manifestAsset) {
      throw new Error(`manifest.json not found in latest release ${release.tag_name}`);
    }

    const manifestContent = await downloadFile(manifestAsset.browser_download_url);
    const manifest = JSON.parse(manifestContent);

    if (manifest.id !== plugin.id) {
      throw new Error(`Plugin ID mismatch: expected ${plugin.id}, found ${manifest.id} in manifest.json`);
    }

    if (manifest.permissions && Array.isArray(manifest.permissions)) {
      results.permissions = manifest.permissions;
    }

    console.log(`✅ Verified ${plugin.name} (${plugin.id}): ${results.permissions.length} permissions`);
    return results;

  } catch (error) {
    console.error(`❌ Failed to verify ${plugin.name} (${plugin.id}): ${error.message}`);
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
    // Create empty results file
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

  // Save results for PR comment
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

  console.log('✅ All plugins verified successfully');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

