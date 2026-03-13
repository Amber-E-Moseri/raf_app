import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';

function toExpressPath(relativeFile) {
  const withoutRoute = relativeFile.replace(/\\/g, '/').replace(/\/route\.js$/, '');
  const withSegments = withoutRoute.replace(/\[([^\]]+)\]/g, ':$1');
  return withSegments === '' ? '/' : `/${withSegments}`;
}

async function findRouteFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findRouteFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name === 'route.js') {
      files.push(absolutePath);
    }
  }

  return files;
}

async function buildWebRequest(req) {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  if (!headers.has('x-household-id') && req.defaultHouseholdId) {
    headers.set('x-household-id', req.defaultHouseholdId);
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
    if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
      if (req.body.length > 0) {
        init.body = req.body;
      }
    } else if (Object.keys(req.body).length > 0) {
      init.body = JSON.stringify(req.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url, init);
}

async function sendWebResponse(webResponse, res) {
  res.status(webResponse.status);

  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') {
      return;
    }

    res.setHeader(key, value);
  });

  if (webResponse.status === 204) {
    res.end();
    return;
  }

  const bodyText = await webResponse.text();
  res.send(bodyText);
}

export async function createApiRouter({
  apiRootDir,
  db,
  defaultHouseholdId,
  aliases = [],
}) {
  const router = express.Router();
  const routeFiles = await findRouteFiles(apiRootDir);

  for (const routeFile of routeFiles) {
    const relative = path.relative(apiRootDir, routeFile);
    const routePath = toExpressPath(relative);
    const module = await import(pathToFileURL(routeFile).href);

    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT']) {
      const handler = module[method];
      if (typeof handler !== 'function') {
        continue;
      }

      router[method.toLowerCase()](routePath, async (req, res, next) => {
        try {
          req.defaultHouseholdId = defaultHouseholdId;
          const webRequest = await buildWebRequest(req);
          const webResponse = await handler(webRequest, {
            db,
            householdId: req.headers['x-household-id'] ?? req.headers['x-household_id'] ?? defaultHouseholdId,
            params: req.params,
          });

          await sendWebResponse(webResponse, res);
        } catch (error) {
          next(error);
        }
      });
    }
  }

  for (const alias of aliases) {
    const module = await import(pathToFileURL(alias.file).href);
    const handler = module[alias.method];
    if (typeof handler !== 'function') {
      continue;
    }

    router[alias.method.toLowerCase()](alias.path, async (req, res, next) => {
      try {
        req.defaultHouseholdId = defaultHouseholdId;
        const webRequest = await buildWebRequest(req);
        const webResponse = await handler(webRequest, {
          db,
          householdId: req.headers['x-household-id'] ?? req.headers['x-household_id'] ?? defaultHouseholdId,
          params: req.params,
        });

        await sendWebResponse(webResponse, res);
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
