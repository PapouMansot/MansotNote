import type { Express, RequestHandler, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerMansotTools } from './mcp-tools.js';
import type { AuthRequest } from './index.js';

/**
 * En-têtes de la requête d'origine rejoués sur les appels internes : la règle réseau des jetons
 * (réseau privé ou IP enregistrée) lit ces en-têtes, elle doit donc voir la même origine.
 */
const FORWARDED_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'cf-ray', 'cdn-loop', 'true-client-ip', 'user-agent'];

function describeIssues(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details.map((issue: { path?: unknown[]; message?: string }) =>
    (issue.path?.length ? issue.path.join('.') + ' : ' : '') + issue.message).join(' ; ');
}

/**
 * Appelle l'API MansotNote en boucle locale avec le jeton de l'appelant. Chaque outil passe donc par
 * les mêmes contrôles que n'importe quel client : jeton, règle réseau, dossiers, tags, écriture.
 */
function loopbackApi(req: AuthRequest, port: number) {
  return async (method: string, path: string, { body, timeoutMs = 30_000 }: { body?: unknown; timeoutMs?: number } = {}) => {
    const headers: Record<string, string> = { Authorization: req.get('authorization') ?? '', Accept: 'application/json' };
    for (const name of FORWARDED_HEADERS) {
      const value = req.get(name);
      if (value) headers[name] = value;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: globalThis.Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('MansotNote est momentanément injoignable : réessayez dans un instant.');
    }
    const raw = await response.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* corps non JSON */ }
    if (response.ok) return data;
    const serverMessage = [data?.error, describeIssues(data?.details)].filter(Boolean).join(' — ');
    if (response.status === 401) throw new Error('Jeton MansotNote invalide, expiré ou révoqué (HTTP 401).');
    if (response.status === 429) throw new Error('Trop de requêtes vers MansotNote (HTTP 429) : réessayez dans un instant.');
    throw new Error((serverMessage || 'Erreur MansotNote') + ' (HTTP ' + response.status + ')');
  };
}

function jsonRpcError(res: Response, status: number, message: string) {
  return res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

/**
 * Serveur MCP distant (HTTP, sans état) : POST /mcp avec `Authorization: Bearer <jeton>`.
 * Seuls les jetons d'API sont acceptés (pas de cookie de session). Les outils de gestion des jetons ne
 * sont jamais exposés ici, et l'écriture n'est proposée qu'aux jetons qui ont ce droit.
 */
export function registerMcp(app: Express, authenticate: RequestHandler, limiter: RequestHandler, port: number) {
  app.post(['/api/mcp', '/mcp'], limiter, authenticate, async (request, response) => {
    const req = request as AuthRequest;
    if (req.authMethod !== 'api_token' || !req.apiToken) {
      response.set('WWW-Authenticate', 'Bearer realm="MansotNote"');
      return jsonRpcError(response, 401, 'Jeton API requis : en-tête Authorization: Bearer <jeton>.');
    }
    const server = new McpServer({ name: 'mansotnote', version: '1.0.0' });
    registerMansotTools(server, {
      api: loopbackApi(req, port),
      readOnly: !req.apiToken.permissions.write,
      manageTokens: false,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error('[mcp]', error instanceof Error ? error.message : error);
      if (!response.headersSent) jsonRpcError(response, 500, 'Erreur interne');
    }
  });
  app.all(['/api/mcp', '/mcp'], (_req, res) => {
    res.set('Allow', 'POST');
    jsonRpcError(res, 405, 'Méthode non autorisée : ce serveur MCP est sans état, utilisez POST.');
  });
}
