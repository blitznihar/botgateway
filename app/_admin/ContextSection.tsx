'use client';

import styles from '../admin.module.css';
import { Draft, Field, Update } from './shared';

/** "Context & Screen Awareness" editor section. */
export default function ContextSection({ draft, update }: { draft: Draft; update: Update }) {
  const pc = draft.pageContext;
  return (
    <section className={styles.section}>
      <h2>Context &amp; Screen Awareness</h2>
      <Field
        label="Read the page the bot is embedded on"
        hint="Automatic: right before each message, the widget captures the visible page (text, form fields, label/value pairs, highlighted text) so users can ask about “this policy” or “this customer”."
      >
        <select value={pc.mode} onChange={(e) => update((d) => void (d.pageContext.mode = e.target.value as Draft['pageContext']['mode']))}>
          <option value="auto">Automatic: capture the visible page before each message</option>
          <option value="off">Off: only data the host app sends with NextBot.setContext()</option>
        </select>
      </Field>

      {pc.mode === 'auto' && (
        <>
          <div className={styles.grid2}>
            <Field label="Only read these areas" hint='CSS selectors, comma-separated, e.g. main, .record-detail. Blank = whole page.'>
              <input value={draft.includeText} spellCheck={false} placeholder="(whole page)" onChange={(e) => update((d) => void (d.includeText = e.target.value))} />
            </Field>
            <Field label="Never read these areas" hint="CSS selectors. Also always skipped: password/payment fields, the chat widget, [data-nextbot-ignore].">
              <input value={draft.excludeText} spellCheck={false} onChange={(e) => update((d) => void (d.excludeText = e.target.value))} />
            </Field>
            <Field label="Max characters per message" hint="500–20000. Bigger = more context, slower and costlier.">
              <input
                type="number"
                min={500}
                max={20000}
                step={500}
                value={pc.maxChars}
                onChange={(e) => update((d) => void (d.pageContext.maxChars = Number(e.target.value)))}
              />
            </Field>
            <div className={styles.field}>
              <span className={styles.label}>Privacy</span>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={pc.redact} onChange={(e) => update((d) => void (d.pageContext.redact = e.target.checked))} />
                Mask card numbers, SSNs and IBANs before they leave the browser
              </label>
            </div>
          </div>
          <p className={styles.hint}>
            Salesforce Lightning blocks third-party scripts from reading record pages. There, add the LWC bridge from the README, which
            passes the record&apos;s fields via <code>NextBot.setContext()</code>.
          </p>
        </>
      )}

      <Field
        label="Host context keys to forward"
        hint="Keys from NextBot.setContext() the model may see, comma-separated (e.g. recordId, policyNumber). Blank = all. Always treated as unverified."
      >
        <input value={draft.hostKeysText} spellCheck={false} placeholder="(all keys)" onChange={(e) => update((d) => void (d.hostKeysText = e.target.value))} />
      </Field>
    </section>
  );
}
