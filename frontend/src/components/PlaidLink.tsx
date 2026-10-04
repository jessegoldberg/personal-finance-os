import { useEffect, useState, ReactNode } from 'react';
import { usePlaidLink, PlaidLinkOnSuccessMetadata } from 'react-plaid-link';
import { api } from '../lib/api';
import { Spinner } from './ui';

type Mode = 'banking' | 'investments';
const STORAGE_KEY = 'plaid_link_session';

interface Session { token: string; mode: Mode; itemId?: string }

function saveSession(s: Session) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
function loadSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

function Launcher({ session, oauthRedirect, onDone }: { session: Session; oauthRedirect?: string; onDone: (ok: boolean, error?: string) => void }) {
  const { open, ready } = usePlaidLink({
    token: session.token,
    receivedRedirectUri: oauthRedirect,
    onSuccess: async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        if (session.itemId) {
          await api('/api/sync', { body: { itemId: session.itemId } });
        } else {
          await api('/api/plaid/exchange', {
            body: { publicToken, mode: session.mode, institution: { id: metadata.institution?.institution_id, name: metadata.institution?.name } },
          });
        }
        onDone(true);
      } catch (e: any) {
        onDone(false, e.message);
      }
    },
    onExit: (err) => onDone(false, err?.display_message || err?.error_message || undefined),
  });

  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}

export function PlaidLinkButton({ mode = 'banking', itemId, onLinked, className = 'btn-primary', children }: {
  mode?: Mode; itemId?: string; onLinked: () => void; className?: string; children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { linkToken } = await api('/api/plaid/link-token', { body: { mode, itemId } });
      const s = { token: linkToken, mode, itemId };
      saveSession(s);
      setSession(s);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} onClick={start} disabled={busy}>
        {busy && <Spinner />}
        {children}
      </button>
      {error && <span className="text-xs text-rose-400">{error}</span>}
      {session && (
        <Launcher session={session} onDone={(ok, err) => {
          setSession(null);
          setBusy(false);
          if (err) setError(err);
          if (ok) onLinked();
        }} />
      )}
    </>
  );
}

// Banks that use OAuth (Chase, BofA, etc.) send the browser back here with ?oauth_state_id=…; Link must be resumed with the same token.
export function PlaidOAuthResume({ onLinked }: { onLinked: () => void }) {
  const [session] = useState(() => (window.location.search.includes('oauth_state_id') ? loadSession() : null));
  const [active, setActive] = useState(!!session);
  const [redirect] = useState(() => window.location.href);

  useEffect(() => {
    if (session) window.history.replaceState({}, '', window.location.pathname);
  }, [session]);

  if (!session || !active) return null;
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
        <div className="card flex items-center gap-2 px-4 py-2 text-sm"><Spinner /> Finishing bank connection…</div>
      </div>
      <Launcher session={session} oauthRedirect={redirect} onDone={(ok) => { setActive(false); if (ok) onLinked(); }} />
    </>
  );
}
