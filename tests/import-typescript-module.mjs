import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Bundle a source module so Node tests can resolve extensionless TS imports. */
export async function importTypescriptModule(url) {
  const result = await build({
    entryPoints: [ fileURLToPath(url) ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
    logLevel: 'silent'
  });
  const source = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
