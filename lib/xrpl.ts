import { getXumm } from "./xumm-client";
import { AXELAR_GATEWAY } from "./axelar";
import { compareForPicker } from "./tokens";
import type { XrplToken, XrplTokens } from "./types";

// Read the connected XRPL wallet's holdings straight off the ledger. The xumm
// SDK gives us the connected account and the node endpoint Xaman is using; we
// then ask that node for the account's XRP balance (account_info) and its
// issued-currency trustlines (account_lines) over a one-shot WebSocket.

// XRPL currency codes are either a 3-char ASCII code or a 160-bit hex blob
// (used for non-standard codes). Decode the hex form back to readable text.
const decodeCurrency = (code: string): string => {
  if (!code || code.length <= 3) return code;
  const hex = code.replace(/0+$/, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c) out += String.fromCharCode(c);
  }
  return out || code;
};

// xumm reports the endpoint as a ws(s):// URL already; fall back to the public
// mainnet cluster and coerce an http(s) endpoint to its websocket form.
const toWebSocketUrl = (endpoint?: string | null): string => {
  if (!endpoint) return "wss://xrplcluster.com";
  if (endpoint.startsWith("ws")) return endpoint;
  return endpoint.replace(/^http/, "ws");
};

type XrplCommand = Record<string, unknown>;
type XrplReply = { id: number; result?: Record<string, any> };

// Fire a batch of XRPL commands over a single WebSocket and resolve once every
// reply (matched by id) is in. Closes the socket either way.
const xrplBatch = (
  wsUrl: string,
  commands: XrplCommand[],
  timeoutMs = 15000,
): Promise<Record<number, XrplReply>> =>
  new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return reject(
        new Error(`Cannot reach XRPL node: ${(e as Error).message || e}`),
      );
    }
    const results: Record<number, XrplReply> = {};
    let remaining = commands.length;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("XRPL request timed out"));
    }, timeoutMs);

    ws.onopen = () =>
      commands.forEach((cmd, id) => ws.send(JSON.stringify({ ...cmd, id })));
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data) as XrplReply;
      results[msg.id] = msg;
      if (--remaining === 0) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve(results);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("XRPL connection failed"));
    };
  });

/**
 * List the spendable assets in the connected XRPL wallet: native XRP plus any
 * issued currencies with a positive trustline balance.
 */
export async function fetchXrplTokens(): Promise<XrplTokens> {
  const xumm = getXumm();
  const [account, endpoint] = await Promise.all([
    xumm.user.account,
    xumm.user.networkEndpoint,
  ]);
  if (!account) throw new Error("No XRPL account connected");

  const wsUrl = toWebSocketUrl(endpoint);
  const res = await xrplBatch(wsUrl, [
    { command: "account_info", account, ledger_index: "validated" },
    { command: "account_lines", account, ledger_index: "validated" },
  ]);

  const tokens: XrplToken[] = [];

  // XRP — Balance is in drops (1 XRP = 1e6 drops). Skip if the account is
  // unfunded (account_info returns actNotFound, so account_data is absent).
  const info = res[0]?.result?.account_data;
  if (info?.Balance) {
    const xrp = Number(info.Balance) / 1e6;
    tokens.push({
      id: "XRP",
      currency: "XRP",
      issuer: null,
      balance: String(xrp),
      label: "XRP",
    });
  }

  // Issued currencies (trustlines) with a positive balance.
  for (const line of res[1]?.result?.lines || []) {
    if (Number(line.balance) <= 0) continue;
    const currency = decodeCurrency(line.currency);
    tokens.push({
      id: `${line.currency}.${line.account}`,
      currency,
      rawCurrency: line.currency, // on-ledger code (for building Payments)
      issuer: line.account,
      balance: line.balance,
      label: `${currency} · ${line.account.slice(0, 6)}…`,
    });
  }

  await markAxelarSupport(wsUrl, tokens);

  // Same picker order as the shielded list (getShieldedBalances): XRP first,
  // then by balance. XRP is pushed first above, but trustlines arrive in ledger
  // order, so sort rather than rely on it.
  tokens.sort((a, b) =>
    compareForPicker(
      { symbol: a.currency, balance: a.balance },
      { symbol: b.currency, balance: b.balance },
    ),
  );

  return { account, tokens };
}

/**
 * Flag which tokens the Axelar bridge can actually accept for shielding. XRP is
 * native (always bridgeable). An issued currency is bridgeable only if the
 * Axelar gateway can receive it on-ledger — otherwise the shield Payment fails
 * ("trustline does not exist"). Two ways the gateway can receive an IOU, both
 * read from a single `gateway_balances` call:
 *
 *  - obligations: tokens the gateway itself ISSUES (e.g. USDC.axl, WETH, WBTC).
 *    Here the issuer IS the gateway, so returning them to the issuer always
 *    succeeds — no counterparty trustline needed.
 *  - assets: third-party IOUs the gateway HOLDS a trustline to (e.g. Circle's
 *    native USDC). The gateway can receive these as a normal trustline holder.
 *
 * A token matching neither (e.g. RLUSD) is unshieldable. On any failure this
 * leaves issued tokens unmarked (still selectable) so a transient node error
 * never blocks shielding; XRP stays supported.
 */
async function markAxelarSupport(
  wsUrl: string,
  tokens: XrplToken[],
): Promise<void> {
  // XRP (no issuer) is always bridgeable.
  for (const t of tokens) if (!t.issuer) t.supported = true;

  const issued = tokens.filter((t) => t.issuer);
  if (!issued.length) return;

  try {
    const res = await xrplBatch(wsUrl, [
      {
        command: "gateway_balances",
        account: AXELAR_GATEWAY,
        ledger_index: "validated",
      },
    ]);
    const result = res[0]?.result ?? {};

    // The `${on-ledger currency}|${issuer}` pairs the gateway can receive.
    const receivable = new Set<string>();
    // Obligations are keyed by currency; the issuer is the gateway itself.
    for (const currency of Object.keys(result.obligations ?? {}))
      receivable.add(`${currency}|${AXELAR_GATEWAY}`);
    // Assets are keyed by third-party issuer → list of held currencies.
    for (const [issuer, held] of Object.entries(result.assets ?? {}))
      for (const line of (held as { currency: string }[]) ?? [])
        receivable.add(`${line.currency}|${issuer}`);

    for (const t of issued)
      t.supported = receivable.has(`${t.rawCurrency}|${t.issuer}`);
  } catch {
    // Support unknown — leave issued tokens unmarked (selectable). XRP stays
    // supported; a failed shield would surface the trustline error as before.
  }
}
