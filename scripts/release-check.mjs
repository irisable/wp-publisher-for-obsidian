import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

function listFiles(path, predicate) {
  const absolute = join(root, path);
  const result = [];

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(relative(root, child), predicate));
    } else if (predicate(child)) {
      result.push(child);
    }
  }

  return result;
}

function compareSets(label, expected, actual) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));

  if (missing.length > 0) {
    errors.push(`${label}: missing ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    errors.push(`${label}: unexpected ${extra.join(', ')}`);
  }
}

function compareVersions(left, right) {
  const leftParts = left.split('-', 1)[0].split('.').map(Number);
  const rightParts = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function checkVersions() {
  const manifest = readJson('manifest.json');
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const versions = readJson('versions.json');
  const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  if (!semver.test(manifest.version)) {
    errors.push(`manifest.json has an invalid version: ${manifest.version}`);
  }
  if (packageJson.version !== manifest.version) {
    errors.push('package.json and manifest.json versions do not match');
  }
  if (packageLock.version !== packageJson.version
    || packageLock.packages?.['']?.version !== packageJson.version) {
    errors.push('package-lock.json and package.json versions do not match');
  }
  if (versions[manifest.version] !== manifest.minAppVersion) {
    errors.push(
      `versions.json must map ${manifest.version} to ${manifest.minAppVersion}`
    );
  }
  const developmentApiVersion = packageJson.devDependencies?.obsidian;
  if (developmentApiVersion
    && compareVersions(manifest.minAppVersion, developmentApiVersion) < 0) {
    warnings.push(
      `minAppVersion ${manifest.minAppVersion} is below the unverified development API baseline ${developmentApiVersion}`
    );
  }

  const tag = process.env.GITHUB_REF_NAME || process.argv[2];
  if (tag && tag !== manifest.version) {
    errors.push(`release tag ${tag} must exactly match ${manifest.version}`);
  }
}

function checkManifestIdentity() {
  const manifest = readJson('manifest.json');
  const packageJson = readJson('package.json');

  if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id)) {
    errors.push(`manifest id is invalid: ${manifest.id}`);
  }
  if (manifest.id.includes('obsidian')) {
    errors.push('manifest id cannot contain "obsidian"');
  }
  if (manifest.id.endsWith('plugin')) {
    errors.push('manifest id cannot end with "plugin"');
  }
  if (!manifest.author || manifest.author === 'devbean') {
    errors.push('manifest author still uses the upstream project identity');
  }
  if (packageJson.author !== manifest.author) {
    errors.push('package.json and manifest.json authors do not match');
  }
  if (String(manifest.fundingUrl || '').includes('devbean')) {
    errors.push('manifest fundingUrl still points to the upstream maintainer');
  }
  if (!manifest.name || /obsidian/i.test(manifest.name)) {
    errors.push('manifest name must be present and cannot contain "obsidian"');
  }
  if (/\bplugin\b/i.test(manifest.name)) {
    errors.push('manifest name cannot contain the word "plugin"');
  }
  if (!/^[A-Za-z0-9 +()-]+$/.test(manifest.name)) {
    errors.push('manifest name contains unsupported characters or punctuation');
  }
  if (!manifest.description?.trim()) {
    errors.push('manifest description is required');
  }
  if (typeof manifest.isDesktopOnly !== 'boolean') {
    errors.push('manifest isDesktopOnly must be a boolean');
  }
}

function checkCommunityPolicies() {
  const manifest = readJson('manifest.json');
  const sourceFiles = listFiles('src', (path) => path.endsWith('.ts'));
  const mobileOnlyPatterns = [
    {
      pattern: /from\s+['"](?:node:|fs['"]|path['"]|electron['"]|child_process['"]|os['"])/,
      label: 'top-level Node.js or Electron import'
    },
    {
      pattern: /require\(\s*['"](?:node:|fs['"]|path['"]|electron['"]|child_process['"]|os['"])/,
      label: 'Node.js or Electron require'
    },
    { pattern: /\bFileSystemAdapter\b/, label: 'FileSystemAdapter usage' },
    { pattern: /\bprocess\.platform\b/, label: 'process.platform usage' },
    { pattern: /\bfetch\s*\(/, label: 'fetch usage instead of requestUrl' },
    { pattern: /\baxios\./, label: 'axios usage instead of requestUrl' },
    { pattern: /['"][^'"]*\.obsidian(?:\/|\\)/, label: 'hardcoded .obsidian path' }
  ];

  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8');
    const displayPath = relative(root, path);
    if (/\.style\.[A-Za-z]+\s*=|\.style\.setProperty\s*\(|attr:\s*\{[^}]*\bstyle\s*:/s.test(source)) {
      errors.push(`inline style assignment remains in ${displayPath}`);
    }
    if (/\bhotkeys?\s*:/.test(source)) {
      errors.push(`default command hotkey remains in ${displayPath}`);
    }
    if (!manifest.isDesktopOnly) {
      for (const { pattern, label } of mobileOnlyPatterns) {
        if (pattern.test(source)) {
          errors.push(`${label} conflicts with mobile support in ${displayPath}`);
        }
      }
    }
  }
}

function checkWordPressComOAuth() {
  const source = listFiles('src', (path) => path.endsWith('.ts'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const forbiddenMarkers = [
    '79085',
    'public-api.wordpress.com/oauth2/authorize',
    'public-api.wordpress.com/oauth2/token',
    'wordpress-plugin-oauth',
    'WP_OAUTH2_CLIENT_SECRET'
  ];

  for (const marker of forbiddenMarkers) {
    if (source.includes(marker)) {
      errors.push(`unsupported WordPress.com OAuth marker remains: ${marker}`);
    }
  }
}

function checkReleaseFiles() {
  for (const path of ['main.js', 'manifest.json', 'styles.css']) {
    const absolute = join(root, path);
    if (!existsSync(absolute) || lstatSync(absolute).size === 0) {
      errors.push(`required release file is missing or empty: ${path}`);
    }
  }

  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'main.js'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (tracked.status === 0) {
    warnings.push(
      'main.js is tracked; Obsidian recommends generating it only for releases'
    );
  }

  const dataTracked = spawnSync(
    'git',
    ['ls-files', '--error-unmatch', 'data.json'],
    { cwd: root, encoding: 'utf8' }
  );
  if (dataTracked.status === 0) {
    errors.push('data.json contains local credentials/state and must not be tracked');
  }
}

function checkTranslations() {
  const en = readJson('src/i18n/en.json');
  const zh = readJson('src/i18n/zh-cn.json');
  compareSets(
    'translation keys',
    new Set(Object.keys(en)),
    new Set(Object.keys(zh))
  );

  const sourceFiles = listFiles('src', (path) => path.endsWith('.ts'));
  const used = new Set();
  const literalCall = /\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g;

  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(literalCall)) {
      used.add(match[1]);
    }
    if (/console\.(?:log|info|debug)\s*\(/.test(source)) {
      errors.push(`debug console call remains in ${relative(root, path)}`);
    }
    if (/WP_OAUTH2_CLIENT_SECRET|clientSecret\s*:/.test(source)) {
      errors.push(`embedded OAuth client secret remains in ${relative(root, path)}`);
    }
  }

  const missing = [...used].filter((key) => !(key in en));
  if (missing.length > 0) {
    errors.push(`English translations missing source keys: ${missing.join(', ')}`);
  }
}

function checkCommandMap() {
  const source = read('src/main.ts');
  const featureMap = read('docs/feature-map.md');
  const sourceIds = new Set(
    [...source.matchAll(/this\.addCommand\(\{\s*id:\s*['"]([^'"]+)/gs)]
      .map((match) => match[1])
  );
  const commandSection = featureMap.match(
    /Registered commands:\s*([\s\S]*?)\nThe settings tab/
  );

  if (!commandSection) {
    errors.push('feature map registered-command section could not be parsed');
    return;
  }

  const documentedIds = new Set(
    [...commandSection[1].matchAll(/^\* `([^`]+)`:/gm)]
      .map((match) => match[1])
  );
  compareSets('feature-map command ids', sourceIds, documentedIds);
}

function checkMarkdownLinks() {
  const markdownFiles = [
    join(root, 'README.md'),
    join(root, 'README.zh-CN.md'),
    join(root, 'CHANGELOG.md'),
    ...listFiles('docs', (path) => path.endsWith('.md')),
    ...listFiles('wordpress-companion', (path) => path.endsWith('.md'))
  ];
  const personalPath = /(?:\/Users\/|\/Volumes\/|file:\/\/)/;
  const markdownLink = /!?\[[^\]]*]\(([^)]+)\)/g;

  for (const path of markdownFiles) {
    const source = readFileSync(path, 'utf8');
    const linkSource = source
      .replace(/```[\s\S]*?```/g, '')
      .replace(/~~~[\s\S]*?~~~/g, '')
      .replace(/`[^`\n]+`/g, '');
    const displayPath = relative(root, path);

    if (personalPath.test(source)) {
      errors.push(`personal absolute path remains in ${displayPath}`);
    }

    for (const match of linkSource.matchAll(markdownLink)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, '');
      const target = rawTarget.split('#', 1)[0].split('?', 1)[0];
      if (!target
        || /^(?:https?:|mailto:|obsidian:|data:)/i.test(target)
        || target.startsWith('/')) {
        continue;
      }

      let decoded;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        errors.push(`invalid encoded link in ${displayPath}: ${rawTarget}`);
        continue;
      }

      if (!existsSync(resolve(dirname(path), decoded))) {
        errors.push(`broken local link in ${displayPath}: ${rawTarget}`);
      }
    }
  }
}

function checkCompanion() {
  const manifest = readJson('manifest.json');
  const phpPath =
    'wordpress-companion/wp-publisher-companion/wp-publisher-companion.php';
  const readmePath =
    'wordpress-companion/wp-publisher-companion/readme.txt';
  const zipPath =
    'wordpress-companion/wp-publisher-companion.zip';
  const php = read(phpPath);
  const companionReadme = read(readmePath);
  const header = php.match(/^\s*\* Version:\s*([^\s]+)/m)?.[1];
  const constant = php.match(
    /WP_PUBLISHER_COMPANION_VERSION\s*=\s*'([^']+)'/
  )?.[1];
  const author = php.match(/^\s*\* Author:\s*(.+)$/m)?.[1].trim();
  const stable = companionReadme.match(/^Stable tag:\s*([^\s]+)/m)?.[1];

  if (!header || header !== constant || header !== stable) {
    errors.push('companion plugin header, constant, and stable tag do not match');
  }
  if (author !== manifest.author) {
    errors.push('companion plugin author does not match manifest.json');
  }
  if (!existsSync(join(root, zipPath))) {
    errors.push(`missing companion package: ${zipPath}`);
    return;
  }

  for (const sourcePath of [phpPath, readmePath]) {
    const archivePath = sourcePath.replace(/^wordpress-companion\//, '');
    const zipped = spawnSync(
      'unzip',
      ['-p', join(root, zipPath), archivePath],
      { encoding: 'utf8' }
    );
    if (zipped.status !== 0 || zipped.stdout !== read(sourcePath)) {
      errors.push(`companion ZIP is stale or missing ${archivePath}`);
    }
  }

  const phpLint = spawnSync('php', ['-l', join(root, phpPath)], {
    encoding: 'utf8'
  });
  if (phpLint.error?.code === 'ENOENT') {
    warnings.push('PHP CLI is unavailable; companion syntax was not linted');
  } else if (phpLint.status !== 0) {
    errors.push(`companion PHP lint failed: ${phpLint.stderr.trim()}`);
  }
}

checkVersions();
checkManifestIdentity();
checkCommunityPolicies();
checkWordPressComOAuth();
checkReleaseFiles();
checkTranslations();
checkCommandMap();
checkMarkdownLinks();
checkCompanion();

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  console.error(`\nRelease check failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.info('Release check passed.');
}
