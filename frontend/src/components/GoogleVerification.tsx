import { useEffect, useState } from "react";
import { Link2, LogOut } from "lucide-react";
import { captureGoogleCallback, clearStoredGoogleCallback, googleStartUrl, type GoogleCallback } from "../lib/google";
import { getRequest, linkGoogleAttestation, revokeGoogleAttestation } from "../lib/trustpass";

export function GoogleVerification({ wallet, requestId, linked, onChanged, callback: callbackProp }: { wallet: string; requestId?: string; linked?: boolean; onChanged?: () => Promise<void> | void; callback?: GoogleCallback }) {
  const [callback, setCallback] = useState<GoogleCallback>(() => callbackProp ?? captureGoogleCallback());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setCallback(callbackProp ?? captureGoogleCallback()); }, [callbackProp]);

  async function connect() {
    if (!requestId) { setError("Create a TrustPass request before connecting Google."); return; }
    setError("");
    try {
      const v4Address = String(import.meta.env.VITE_V4_TRUSTPASS_CONTRACT_ADDRESS || "");
      if (!v4Address) throw new Error("V4 Google linking is unavailable until the deployed V4 address is configured.");
      window.location.assign(googleStartUrl(wallet, requestId, v4Address));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function attach() {
    if (callback.status !== "ready" || !callback.attestationUrl || !requestId) return;
    if (callback.pendingId !== requestId) {
      setError("This Google evidence belongs to a different TrustPass request. Resume that exact request before linking.");
      return;
    }
    setBusy(true); setError("");
    try {
      await linkGoogleAttestation(requestId, callback.attestationUrl);
      const linkedRequest = await getRequest(requestId);
      if (linkedRequest.subject.toLowerCase() !== wallet.toLowerCase()) throw new Error("The connected wallet does not own this TrustPass request.");
      if (!linkedRequest.google_commitment) throw new Error("Google linking finalized without a Google commitment in request state.");
      clearStoredGoogleCallback();
      setCallback({ status: "none" });
      await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function revoke() {
    if (!requestId) return;
    setBusy(true); setError("");
    try { await revokeGoogleAttestation(requestId); await onChanged?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  const callbackMatchesRequest = callback.status === "ready" && callback.pendingId === requestId;
  return <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">Google account evidence</h3><p className="text-xs text-gray-400 mt-1">OIDC authorization-code flow, PKCE, nonce, issuer, audience, signature and verified-email checks happen in the Worker. The contract stores only a keyed commitment of Google’s stable <code>sub</code>.</p></div><span className={`text-xs ${linked ? "text-emerald-300" : "text-gray-500"}`}>{linked ? "Linked" : callback.status === "ready" ? "Authenticated" : "Not linked"}</span></div>
    <div className="flex flex-wrap gap-2">{callback.status === "ready" ? <button className="btn-primary" onClick={attach} disabled={busy || !callbackMatchesRequest}>Complete Google linking</button> : <button className="btn-primary" onClick={connect} disabled={busy}><Link2 className="w-4 h-4" />{linked ? "Reconnect Google" : "Connect Google"}</button>}{linked && <button className="btn-secondary" onClick={revoke} disabled={busy}><LogOut className="w-4 h-4" />Revoke</button>}</div>
    {callback.status === "ready" && <p className="text-xs text-emerald-300">Google authenticated — complete on-chain linking.{!callbackMatchesRequest && " Reconnect or resume the matching TrustPass request before linking."}</p>}
    {callback.error && <p className="text-sm text-red-300">{callback.error}</p>}{error && <p className="text-sm text-red-300">{error}</p>}
  </section>;
}
