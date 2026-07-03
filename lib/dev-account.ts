// Dev-only override for the shielded account, to skip the Xaman SignIn on every
// reload and keep a stable wallet across dev sessions.
//
// The values come from `.env.local` (gitignored — see .gitignore), so real
// mnemonics/keys never get committed. This wrapper is committed and safe: when
// the env vars are absent (production, CI, a fresh checkout) DEV_ACCOUNT is
// null and startWallet falls back to the normal Xaman sign-in.
//
// To enable: copy `.env.local.example` to `.env.local`, fill in the values, and
// restart the dev server. NEXT_PUBLIC_* vars are inlined at build time, so a
// deployed build made without `.env.local` never carries the override.
//
// WARNING: this bypasses the sign-in and hardcodes a spending key. Use a
// throwaway dev wallet only; never point it at real funds.

export type DevAccount = { mnemonic: string; encryptionKey: string };

const mnemonic = process.env.NEXT_PUBLIC_DEV_MNEMONIC;
const encryptionKey = process.env.NEXT_PUBLIC_DEV_ENCRYPTION_KEY;

export const DEV_ACCOUNT: DevAccount | null =
  mnemonic && encryptionKey ? { mnemonic, encryptionKey } : null;
