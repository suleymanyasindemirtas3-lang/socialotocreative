import { createHmac, randomBytes } from 'node:crypto';

/**
 * OAuth 1.0a User Context imzalama (RFC 5849).
 *
 * X icin bilincli tercih: OAuth 2.0 yerine 1.0a kullaniyoruz cunku kendi
 * hesabina yazarken developer portalindan dogrudan access token uretilebiliyor.
 * Callback URL, tarayici yonlendirmesi ve refresh dongusu gerekmiyor; panel
 * dort statik alan alip isini bitiriyor.
 */

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986: encodeURIComponent !*'() karakterlerini birakiyor, onlari da kacir. */
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Imza tabanini kurar ve HMAC-SHA1 ile imzalar.
 * `bodyParams` yalnizca form-encoded govdeler icin verilir; JSON ve multipart
 * govdeler imzaya girmez (spec geregi).
 */
export function authHeader(
  method: string,
  url: string,
  creds: OAuth1Creds,
  bodyParams: Record<string, string> = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const target = new URL(url);
  const queryParams: Record<string, string> = {};
  for (const [k, v] of target.searchParams) queryParams[k] = v;

  // Imza tabani: tum parametreler (oauth + query + form) siralanip birlestirilir.
  const all = { ...oauth, ...queryParams, ...bodyParams };
  const normalized = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k] ?? '')}`)
    .join('&');

  // Sorgu dizesi imza tabaninda ayri tasindigi icin URL'den cikarilir.
  const bareUrl = `${target.origin}${target.pathname}`;
  const base = [method.toUpperCase(), pct(bareUrl), pct(normalized)].join('&');
  const key = `${pct(creds.consumerSecret)}&${pct(creds.accessSecret)}`;
  oauth['oauth_signature'] = createHmac('sha1', key).update(base).digest('base64');

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k] ?? '')}"`)
      .join(', ')
  );
}

export function credsFrom(c: Record<string, string>): OAuth1Creds {
  return {
    consumerKey: c['consumerKey'] ?? '',
    consumerSecret: c['consumerSecret'] ?? '',
    accessToken: c['accessToken'] ?? '',
    accessSecret: c['accessSecret'] ?? '',
  };
}
