import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nextVersion = process.argv[2];

if (!nextVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error('Usage: npm run version:set -- <major.minor.patch>');
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(
    resolve(root, path),
    JSON.stringify(value, null, '\t') + '\n',
    'utf8'
  );
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const manifest = readJson('manifest.json');
const versions = readJson('versions.json');

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;
manifest.version = nextVersion;
versions[nextVersion] = manifest.minAppVersion;

writeJson('package.json', packageJson);
writeJson('package-lock.json', packageLock);
writeJson('manifest.json', manifest);
writeJson('versions.json', versions);

console.info(`Updated release version to ${nextVersion}.`);
