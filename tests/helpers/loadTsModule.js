import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { transform } from 'esbuild';

export async function loadTsModule(relativeUrl, importMetaUrl) {
  const fileUrl = new URL(relativeUrl, importMetaUrl);
  const source = await readFile(fileUrl, 'utf8');
  const result = await transform(source, {
    format: 'esm',
    loader: 'ts',
    sourcemap: 'inline',
    sourcefile: pathToFileURL(fileUrl.pathname).href,
  });

  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(result.code)}`);
}
