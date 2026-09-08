import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function walkRouteFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRouteFiles(absolutePath, out);
    } else if (entry.isFile() && entry.name === 'route.js') {
      out.push(absolutePath);
    }
  }
  return out;
}

test('route imports into app/api/v1/_shared/http.js resolve from their route depth', () => {
  const routeFiles = walkRouteFiles(path.join('app', 'api', 'v1'));
  const imports = [];

  for (const routeFile of routeFiles) {
    const source = fs.readFileSync(routeFile, 'utf8');
    const matches = source.matchAll(/from ['"]([^'"]*_shared\/http\.js)['"]/g);
    for (const match of matches) {
      const importPath = match[1];
      const resolved = path.resolve(path.dirname(routeFile), importPath);
      imports.push({ routeFile, importPath, resolved });
    }
  }

  assert.ok(imports.length > 0, 'expected route imports into _shared/http.js');
  for (const routeImport of imports) {
    assert.equal(
      fs.existsSync(routeImport.resolved),
      true,
      `${routeImport.routeFile} imports ${routeImport.importPath}, which resolves to missing file ${routeImport.resolved}`,
    );
  }
});
