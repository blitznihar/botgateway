'use client';

import { useState } from 'react';
import { IDENTITY_PRESETS, isDevIssuer } from '@/lib/identity-defaults';
import styles from '../admin.module.css';
import { Draft, Field, splitList, Update } from './shared';

type TokenCheck = {
  ok: boolean;
  error?: string;
  code?: string;
  user?: Record<string, unknown>;
  token?: { iss?: string; aud?: string | string[]; sub?: string; exp?: string; alg?: string; claimNames?: string[]; error?: string };
};

/** "User Identity" editor section: anonymous vs verified JWT (Auth0 / Entra ID / OIDC), claim mapping, token tester. */
export default function IdentitySection({ draft, update }: { draft: Draft; update: Update }) {
  const id = draft.identity;
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<TokenCheck | null>(null);
  const preset = IDENTITY_PRESETS.find((p) => p.key === id.provider);

  function applyPreset(p: (typeof IDENTITY_PRESETS)[number]) {
    update((d) => {
      d.identity = { ...d.identity, mode: 'jwt', provider: p.key, issuer: p.issuer, claims: { ...p.claims } };
      d.audienceText = p.audience;
      d.extraClaimsText = (p.claims.extra ?? []).join(', ');
    });
    setCheck(null);
  }

  async function getDevToken() {
    const flavor = id.provider === 'dev_auth0' ? 'auth0' : 'entra';
    const res = await fetch(`/api/dev-idp/${flavor}/token?ttl=600`);
    const data = await res.json();
    setToken(data.access_token ?? '');
    setCheck(data.access_token ? null : { ok: false, error: data.error ?? 'Could not get a test token' });
  }

  async function verify() {
    setChecking(true);
    setCheck(null);
    try {
      const identity = {
        ...id,
        audience: splitList(draft.audienceText),
        claims: { ...id.claims, extra: splitList(draft.extraClaimsText) },
      };
      const res = await fetch('/api/admin/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, token }),
      });
      setCheck(await res.json());
    } catch (e) {
      setCheck({ ok: false, error: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2>User Identity</h2>
      <Field label="Who are the users?">
        <select
          value={id.mode}
          onChange={(e) => update((d) => void (d.identity.mode = e.target.value as Draft['identity']['mode']))}
        >
          <option value="anonymous">Anonymous visitors: open website, no sign-in</option>
          <option value="jwt">Signed-in users: verify the site&apos;s Auth0 / Entra ID / OIDC token</option>
        </select>
      </Field>

      {id.mode === 'anonymous' ? (
        <p className={styles.hint}>
          Each visitor gets a random per-browser ID (<code>anon:…</code>) so their conversations can be grouped in Activity. Anything
          the page says about the user via <code>setContext</code> is passed to the model as <em>unverified</em>.
        </p>
      ) : (
        <>
          <div className={styles.presets}>
            <span className={styles.hint}>Provider:</span>
            {IDENTITY_PRESETS.map((p) => (
              <button key={p.key} type="button" className={`${styles.chip} ${id.provider === p.key ? styles.chipActive : ''}`} onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset && <p className={styles.hint}>{preset.help}</p>}
          {isDevIssuer(id.issuer) && (
            <p className={styles.warnBox}>
              Uses the built-in <strong>test</strong> identity provider: anyone who can reach this gateway can mint tokens for it. Replace
              issuer and audience with your real Auth0 / Entra ID values before going live.
            </p>
          )}

          <Field label="Issuer" hint="Must equal the token's iss claim. Signing keys are discovered from {issuer}/.well-known/openid-configuration.">
            <input value={id.issuer ?? ''} spellCheck={false} onChange={(e) => update((d) => void (d.identity.issuer = e.target.value))} />
          </Field>
          <div className={styles.grid2}>
            <Field label="Audience(s)" hint="Comma-separated. Tokens for other APIs/apps are rejected.">
              <input value={draft.audienceText} spellCheck={false} onChange={(e) => update((d) => void (d.audienceText = e.target.value))} />
            </Field>
            <Field label="JWKS URL (optional)" hint="Leave blank to auto-discover.">
              <input
                value={id.jwksUrl ?? ''}
                spellCheck={false}
                placeholder="auto-discovered from issuer"
                onChange={(e) => update((d) => void (d.identity.jwksUrl = e.target.value))}
              />
            </Field>
          </div>

          <label className={styles.checkbox}>
            <input type="checkbox" checked={id.required} onChange={(e) => update((d) => void (d.identity.required = e.target.checked))} />
            Require sign-in (otherwise visitors without a valid token chat as guests)
          </label>

          <h3 className={styles.subhead}>Claim mapping</h3>
          <div className={styles.grid2}>
            <Field label="User ID claim" hint="Entra: oid · Auth0/OIDC: sub">
              <input value={id.claims.userId} spellCheck={false} onChange={(e) => update((d) => void (d.identity.claims.userId = e.target.value))} />
            </Field>
            <Field label="Email claim">
              <input value={id.claims.email ?? ''} spellCheck={false} onChange={(e) => update((d) => void (d.identity.claims.email = e.target.value))} />
            </Field>
            <Field label="Name claim">
              <input value={id.claims.name ?? ''} spellCheck={false} onChange={(e) => update((d) => void (d.identity.claims.name = e.target.value))} />
            </Field>
            <Field label="Roles / groups claim">
              <input value={id.claims.roles ?? ''} spellCheck={false} onChange={(e) => update((d) => void (d.identity.claims.roles = e.target.value))} />
            </Field>
          </div>
          <Field label="Extra claims to pass along" hint="Comma-separated claim names, e.g. tid, department, https://acme.com/customer_tier">
            <input value={draft.extraClaimsText} spellCheck={false} onChange={(e) => update((d) => void (d.extraClaimsText = e.target.value))} />
          </Field>

          <h3 className={styles.subhead}>Test a token</h3>
          <Field label="Access token (JWT)" hint="Paste a token from your site (e.g. copy it from the browser's network tab) to check these settings before saving.">
            <textarea rows={3} className={styles.mono} spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" />
          </Field>
          <div className={styles.testRow}>
            <button type="button" className={styles.secondaryBtn} disabled={!token.trim() || checking} onClick={verify}>
              {checking ? 'Verifying…' : 'Verify token'}
            </button>
            {(id.provider === 'dev_entra' || id.provider === 'dev_auth0') && (
              <button type="button" className={styles.linkBtn} onClick={getDevToken}>
                Get a test token from the dev IdP
              </button>
            )}
          </div>
          {check && (
            <div className={`${styles.testResult} ${check.ok ? styles.testOk : styles.testFail}`} role="status">
              <strong>{check.ok ? '✓ Token verified' : `✗ ${check.code ?? 'Not verified'}`}</strong>
              {check.error && <div className={styles.testError}>{check.error}</div>}
              {check.user && (
                <div>
                  <span className={styles.hint}>Resolved user:</span>
                  <pre className={styles.jsonSmall}>{JSON.stringify(check.user, null, 2)}</pre>
                </div>
              )}
              {check.token && !check.ok && !check.token.error && (
                <div className={styles.hint}>
                  Token says iss=<code>{String(check.token.iss)}</code>, aud=<code>{JSON.stringify(check.token.aud)}</code>, alg=
                  <code>{check.token.alg}</code>, expires {check.token.exp}. Claims present: {check.token.claimNames?.join(', ')}
                </div>
              )}
            </div>
          )}

          <label className={styles.checkbox}>
            <input type="checkbox" checked={id.forwardHeaders} onChange={(e) => update((d) => void (d.identity.forwardHeaders = e.target.checked))} />
            Forward identity to the agent backend as <code>X-User-Id</code>, <code>X-User-Email</code>, <code>X-User-Name</code>,{' '}
            <code>X-User-Roles</code> headers (for your own agent APIs)
          </label>
        </>
      )}
    </section>
  );
}
