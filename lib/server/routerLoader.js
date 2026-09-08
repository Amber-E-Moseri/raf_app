import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';

import { verifyToken } from '../auth/jwt.js';
import { buildWorkspaceContext, roleHasPermission } from '../workspaces/permissions.js';

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

function authRequired() {
  return process.env.RAF_AUTH_REQUIRED === 'true' || process.env.RAF_AUTH_REQUIRED === '1';
}

function selectedWorkspaceId(req) {
  return req.headers['x-workspace-id']
    ?? req.headers['x-household-id']
    ?? req.headers['x-household_id']
    ?? null;
}

function bearerToken(req) {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function routeIsPublic(routePath, method) {
  if (routePath === '/auth/signup' && method === 'POST') return true;
  if (routePath === '/auth/login' && method === 'POST') return true;
  if (routePath === '/auth/forgot-password' && method === 'POST') return true;
  if (routePath === '/invitations/:token' && method === 'GET') return true;
  if (routePath === '/invitations/:token/decline' && method === 'POST') return true;
  return false;
}

function routeNeedsAuth(routePath, method) {
  if (!authRequired()) {
    return false;
  }
  return !routeIsPublic(routePath, method);
}

function routeNeedsWorkspace(routePath, method) {
  if (!authRequired()) {
    return false;
  }
  if (routeIsPublic(routePath, method)) return false;
  if (routePath.startsWith('/auth/')) return false;
  if (routePath === '/workspaces' && method === 'GET') return false;
  return true;
}

function requiredPermissionForRoute(routePath, method) {
  if (!routeNeedsWorkspace(routePath, method)) {
    return null;
  }

  if (routePath.startsWith('/workspaces')) {
    if (method === 'GET') return 'workspace:read';
    return 'members:manage';
  }

  if (routePath.startsWith('/reports')) return 'reports:read';
  if (routePath.startsWith('/remi')) return 'remi:invoke';
  if (routePath.startsWith('/imports') || routePath.startsWith('/import-rules') || routePath.startsWith('/merchant-rules')) {
    return method === 'GET' ? 'imports:read' : 'imports:write';
  }
  if (routePath.startsWith('/exports')) return 'financial:read';

  return method === 'GET' ? 'financial:read' : 'financial:write';
}

async function resolveTrustedContext({ req, db, defaultHouseholdId, routePath, method, params }) {
  const context = {
    db,
    householdId: authRequired() ? null : selectedWorkspaceId(req) ?? defaultHouseholdId,
    workspaceId: authRequired() ? null : selectedWorkspaceId(req) ?? defaultHouseholdId,
    params,
  };

  if (!routeNeedsAuth(routePath, method)) {
    return context;
  }

  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const claims = await verifyToken(token, { db });
  if (!claims?.userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  context.userId = claims.userId;
  context.email = claims.email ?? null;

  if (!routeNeedsWorkspace(routePath, method)) {
    return context;
  }

  const workspaceId = selectedWorkspaceId(req);
  if (!workspaceId) {
    const error = new Error('Workspace context is required');
    error.status = 400;
    throw error;
  }

  const workspaceContext = await db.transaction(async (tx) => {
    const workspace = await tx.getWorkspace({ workspaceId });
    const membership = await tx.getWorkspaceMember({ workspaceId, userId: claims.userId });
    return buildWorkspaceContext({ workspace, membership, userId: claims.userId });
  });

  if (!workspaceContext) {
    const error = new Error('Workspace access denied');
    error.status = 403;
    throw error;
  }

  const requiredPermission = requiredPermissionForRoute(routePath, method);
  if (requiredPermission && !roleHasPermission(workspaceContext.role, requiredPermission)) {
    const error = new Error('Insufficient workspace permission');
    error.status = 403;
    throw error;
  }

  return {
    ...context,
    ...workspaceContext,
    role: workspaceContext.role,
    householdId: workspaceContext.householdId,
    workspaceId: workspaceContext.workspaceId,
  };
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
          const trustedContext = await resolveTrustedContext({
            req,
            db,
            defaultHouseholdId,
            routePath,
            method,
            params: req.params,
          });
          const webResponse = await handler(webRequest, {
            ...trustedContext,
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
        const trustedContext = await resolveTrustedContext({
          req,
          db,
          defaultHouseholdId,
          routePath: alias.path,
          method: alias.method,
          params: req.params,
        });
        const webResponse = await handler(webRequest, {
          ...trustedContext,
        });

        await sendWebResponse(webResponse, res);
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
