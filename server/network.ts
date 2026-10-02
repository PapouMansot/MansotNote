/**
 * Origine d'une requête : réseau privé (adresse locale, VPN) ou accès public via Cloudflare.
 *
 * L'adresse de la connexion n'est pas exploitable ici : derrière Cloudflare puis Docker, l'API ne voit que la
 * passerelle Docker ou un serveur Cloudflare. L'adresse réelle du client se lit dans X-Forwarded-For, où Cloudflare
 * l'ajoute juste avant sa propre adresse. Règles :
 *  - accès privé : Host privé, chaîne X-Forwarded-For entièrement privée et aucun en-tête Cloudflare ;
 *  - accès public : l'adresse client n'est retenue que si la chaîne passe par une adresse Cloudflare (liste officielle)
 *    et si CF-Connecting-IP la confirme. Une chaîne forgée sans passage par Cloudflare est refusée.
 * Hypothèse : le serveur d'origine n'est joignable que via Cloudflare ; sinon un client direct pourrait forger toute la chaîne.
 */
import { BlockList, isIP } from 'node:net';

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16],
] as const) PRIVATE.addSubnet(network, prefix, 'ipv4');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');
PRIVATE.addAddress('::1', 'ipv6');

// Plages officielles de Cloudflare (https://www.cloudflare.com/ips-v4 et ips-v6, relevées le 2026-10-02).
const CLOUDFLARE = new BlockList();
for (const cidr of [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
]) { const [net, len] = cidr.split('/'); CLOUDFLARE.addSubnet(net!, Number(len), 'ipv4'); }
for (const cidr of [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]) { const [net, len] = cidr.split('/'); CLOUDFLARE.addSubnet(net!, Number(len), 'ipv6'); }

/** Adresse IP valide, débarrassée des crochets, de la zone et du préfixe IPv4-mappé ; null sinon. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

const inList = (list: BlockList, ip: string) => list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');

/** true seulement pour une adresse IP valide du réseau privé ; tout le reste (nom, valeur illisible) est public. */
export function isPrivateAddress(raw: string): boolean {
  const ip = normalizeIp(raw);
  return ip !== null && inList(PRIVATE, ip);
}

export function isCloudflareAddress(raw: string): boolean {
  const ip = normalizeIp(raw);
  return ip !== null && inList(CLOUDFLARE, ip);
}

// --- Plages CIDR ---------------------------------------------------------------

export interface Cidr { family: 4 | 6; base: bigint; prefix: number }
const BITS = { 4: 32, 6: 128 } as const;
/** Plus large autorisé : une plage plus grande ouvrirait le jeton à des milliers de machines. */
const MIN_PREFIX = { 4: 16, 6: 32 } as const;
export const MAX_ALLOWED_IPS = 20;

function toBigInt(ip: string, family: 4 | 6): bigint {
  if (family === 4) return ip.split('.').reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
  let text = ip;
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const v4 = toBigInt(text.slice(cut + 1), 4);
    text = text.slice(0, cut + 1) + (v4 >> 16n).toString(16) + ':' + (v4 & 0xffffn).toString(16);
  }
  const [head, tail] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - first.length - last.length;
  return [...first, ...Array<string>(Math.max(fill, 0)).fill('0'), ...last].reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

/** « 1.2.3.4 », « 1.2.3.0/24 » ou équivalent IPv6 ; null si illisible. L'adresse est alignée sur son réseau. */
export function parseCidr(entry: string): Cidr | null {
  const parts = entry.trim().split('/');
  if (parts.length > 2) return null;
  const ip = normalizeIp(parts[0] ?? '');
  if (!ip) return null;
  const family = isIP(ip) === 6 ? 6 : 4;
  const prefix = parts[1] === undefined ? BITS[family] : /^\d{1,3}$/.test(parts[1]) ? Number(parts[1]) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > BITS[family]) return null;
  const shift = BigInt(BITS[family] - prefix);
  return { family, prefix, base: (toBigInt(ip, family) >> shift) << shift };
}

export function cidrContains(parent: Cidr, child: Cidr): boolean {
  if (parent.family !== child.family || child.prefix < parent.prefix) return false;
  const shift = BigInt(BITS[parent.family] - parent.prefix);
  return child.base >> shift === parent.base >> shift;
}

export function ipInEntries(ip: string, entries: readonly string[]): boolean {
  const single = parseCidr(ip);
  if (!single) return false;
  return entries.some((entry) => { const cidr = parseCidr(entry); return cidr !== null && cidrContains(cidr, single); });
}

/** Valide et nettoie une liste d'adresses autorisées saisie par l'utilisateur. */
export function validateAllowedIps(raw: readonly string[]): { entries: string[] } | { error: string } {
  const entries = [...new Set(raw.map((entry) => entry.trim()).filter(Boolean))];
  if (entries.length > MAX_ALLOWED_IPS) return { error: 'Au plus ' + MAX_ALLOWED_IPS + ' adresses par jeton' };
  for (const entry of entries) {
    const cidr = parseCidr(entry);
    if (!cidr) return { error: 'Adresse IP ou plage invalide : ' + entry };
    if (cidr.prefix < MIN_PREFIX[cidr.family]) {
      return { error: 'Plage trop large : ' + entry + ' (minimum /' + MIN_PREFIX[4] + ' en IPv4, /' + MIN_PREFIX[6] + ' en IPv6)' };
    }
  }
  return { entries };
}

/** Chaque plage de child doit être contenue dans une plage de parent. Un parent sans plage n'en autorise aucune. */
export function entriesWithin(parent: readonly string[], child: readonly string[]): boolean {
  const parents = parent.map(parseCidr).filter((cidr): cidr is Cidr => cidr !== null);
  return child.every((entry) => { const cidr = parseCidr(entry); return cidr !== null && parents.some((p) => cidrContains(p, cidr)); });
}

function sameIp(a: string, b: string): boolean {
  const left = normalizeIp(a);
  const right = normalizeIp(b);
  if (!left || !right || isIP(left) !== isIP(right)) return false;
  const family = isIP(left) === 6 ? 6 : 4;
  return toBigInt(left, family) === toBigInt(right, family);
}

// --- Origine de la requête -----------------------------------------------------

/** Nom d'hôte sans le port (« 192.168.1.47:8793 » -> « 192.168.1.47 »). */
export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end) : null;
  }
  const colon = host.lastIndexOf(':');
  return colon > -1 && host.indexOf(':') === colon ? host.slice(0, colon) : host;
}

export interface RequestFacts {
  /** En-tête Host brut (posé par nginx ; jamais X-Forwarded-Host, que le client peut falsifier). */
  host: string | undefined;
  forwardedFor: string | undefined;
  cfConnectingIp?: string | undefined;
  /** Un en-tête posé par Cloudflare est présent (CF-Connecting-IP, CF-Ray, CDN-Loop...). */
  hasEdgeHeaders: boolean;
}

/** extraHosts : noms internes supplémentaires jugés privés (ex. « marcelcave »), en minuscules. */
export function isPrivateRequest(facts: RequestFacts, extraHosts: readonly string[] = []): boolean {
  const host = hostnameOf(facts.host);
  if (!host) return false;
  if (!(host === 'localhost' || extraHosts.includes(host) || isPrivateAddress(host))) return false;
  if (facts.hasEdgeHeaders) return false;
  const chain = (facts.forwardedFor ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return chain.every(isPrivateAddress);
}

/**
 * Adresse réelle du client d'une requête arrivée par Cloudflare, ou null si elle n'est pas démontrable.
 * On remonte la chaîne depuis la droite : adresses privées (proxy local, Docker) et Cloudflare sont sautées ; la première
 * autre adresse est le client, à condition d'avoir croisé Cloudflare avant, et que CF-Connecting-IP la confirme.
 */
export function clientIpOf(forwardedFor: string | undefined, cfConnectingIp?: string): string | null {
  const chain = (forwardedFor ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  let sawEdge = false;
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = normalizeIp(chain[i]!);
    if (!ip) return null;
    if (isPrivateAddress(ip)) continue;
    if (isCloudflareAddress(ip)) { sawEdge = true; continue; }
    if (!sawEdge || !cfConnectingIp || !sameIp(cfConnectingIp, ip)) return null;
    return ip;
  }
  return null;
}

export type NetworkAccess = { kind: 'private' } | { kind: 'ip'; ip: string } | { kind: 'denied'; ip: string | null };

/** Un jeton est accepté depuis le réseau privé, ou depuis une des adresses publiques enregistrées sur lui. */
export function evaluateAccess(facts: RequestFacts, allowedIps: readonly string[], extraHosts: readonly string[] = []): NetworkAccess {
  if (isPrivateRequest(facts, extraHosts)) return { kind: 'private' };
  const ip = clientIpOf(facts.forwardedFor, facts.cfConnectingIp);
  if (ip && ipInEntries(ip, allowedIps)) return { kind: 'ip', ip };
  return { kind: 'denied', ip };
}
