import type { IdentityRecord, Platform } from "../types";

/**
 * A finalized write is not enough for the UI to claim completion. The
 * expected linked account must also be visible in the authoritative contract
 * read model.
 */
export function hasLinkedAccount(identity: IdentityRecord, platform: Platform, username: string): boolean {
  const usernameLc = username.toLowerCase();
  return Boolean(
    identity.found
    && identity.linked_accounts?.some(account =>
      account.platform === platform && account.username.toLowerCase() === usernameLc
    ),
  );
}
