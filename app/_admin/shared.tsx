import type { ReactNode } from 'react';
import type { AdminBotConfig } from '@/lib/bot-store';
import type { IdentityConfig } from '@/lib/identity-defaults';
import type { PageContextConfig } from '@/lib/page-context';
import styles from '../admin.module.css';

/** Editor state: the bot plus raw text for list fields (comma-separated in the UI). */
export type Draft = AdminBotConfig & {
  identity: IdentityConfig;
  pageContext: PageContextConfig;
  domainsText: string;
  extraParamsText: string;
  apiKeyInput: string;
  clearApiKey: boolean;
  audienceText: string;
  extraClaimsText: string;
  includeText: string;
  excludeText: string;
  hostKeysText: string;
};

export type Update = (mutator: (d: Draft) => void) => void;

export const splitList = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}
