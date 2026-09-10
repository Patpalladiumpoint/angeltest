// Minimal client for the QuickBooks Online Accounting API v3 -- a real,
// publicly documented API (https://developer.intuit.com/app/developer/qbo/docs/api/accounting),
// unlike Crelate (see ../crelate/index.ts). Hard rule 1 ("never mock an
// integration") does not block this file: the endpoints, auth flow, and
// query language below are Intuit's documented contract, not a guess. What
// IS missing in this environment is a connected app (client id/secret) and
// a sandbox realm to actually call it with -- see loadQuickBooksConfig().
//
// NOT machine-verified in this sandbox: no npm registry access means
// nothing here has been run against a real QuickBooks sandbox this
// session. Verify against a real sandbox company before treating this as
// production-ready -- see README.

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
  environment: "sandbox" | "production";
}

export function loadQuickBooksConfig(): QuickBooksConfig | null {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN;
  const realmId = process.env.QUICKBOOKS_REALM_ID;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox";

  if (!clientId || !clientSecret || !refreshToken || !realmId) return null;
  return { clientId, clientSecret, refreshToken, realmId, environment };
}

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// Minor version pinned and documented rather than left to drift with
// Intuit's default -- bump deliberately, check release notes when you do.
const MINOR_VERSION = "69";

function apiBase(config: QuickBooksConfig): string {
  return config.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class QuickBooksClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: QuickBooksConfig) {}

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QuickBooks token refresh failed: ${res.status} ${body}`);
    }

    const token = (await res.json()) as TokenResponse;
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + token.expires_in * 1000;
    return this.accessToken;
  }

  /** Runs a QuickBooks query-language SELECT against /query. */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const token = await this.ensureAccessToken();
    const url = `${apiBase(this.config)}/v3/company/${this.config.realmId}/query?query=${encodeURIComponent(
      sql,
    )}&minorversion=${MINOR_VERSION}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QuickBooks query failed: ${res.status} ${body} (query: ${sql})`);
    }

    const json = (await res.json()) as { QueryResponse?: Record<string, unknown> };
    const queryResponse = json.QueryResponse ?? {};
    // The entity key varies by query (Invoice, Payment, CompanyInfo...);
    // find the array-valued key rather than hardcode per-caller.
    const entityKey = Object.keys(queryResponse).find((k) => Array.isArray(queryResponse[k]));
    return entityKey ? (queryResponse[entityKey] as T[]) : [];
  }

  /** `select count(*) from <entity>` -- returns totalCount, not rows. */
  async count(entity: string): Promise<number> {
    const token = await this.ensureAccessToken();
    const sql = `select count(*) from ${entity}`;
    const url = `${apiBase(this.config)}/v3/company/${this.config.realmId}/query?query=${encodeURIComponent(
      sql,
    )}&minorversion=${MINOR_VERSION}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`QuickBooks count query failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { QueryResponse?: { totalCount?: number } };
    return json.QueryResponse?.totalCount ?? 0;
  }

  async companyInfo(): Promise<Record<string, unknown> | null> {
    const token = await this.ensureAccessToken();
    const url = `${apiBase(this.config)}/v3/company/${this.config.realmId}/companyinfo/${this.config.realmId}?minorversion=${MINOR_VERSION}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { CompanyInfo?: Record<string, unknown> };
    return json.CompanyInfo ?? null;
  }
}
