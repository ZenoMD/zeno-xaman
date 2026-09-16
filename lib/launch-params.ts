import { isXappRuntime } from "./runtime";
import type { TransferLaunchParams } from "./types";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read a Transfer pre-fill out of the xApp's OTT data
 */
export async function readTransferLaunchParams(): Promise<TransferLaunchParams | null> {
  if (!isXappRuntime()) return null;

  const { getXumm } = await import("./xumm-client");
  const ott = (await getXumm().environment.ott) as
    Record<string, unknown> | undefined;
  if (!ott) return null;

  const tokenRaw = asString(ott.token);
  const amountRaw = asString(ott.amount);
  const recipientRaw = asString(ott.recipient);

  const hasTokenAmount =
    tokenRaw !== undefined &&
    EVM_ADDRESS_RE.test(tokenRaw) &&
    amountRaw !== undefined &&
    Number(amountRaw) > 0;
  const hasRecipient =
    recipientRaw !== undefined && recipientRaw.startsWith("0zk");

  if (!hasTokenAmount && !hasRecipient) return null;

  return {
    tokenAddress: hasTokenAmount ? tokenRaw : undefined,
    amount: hasTokenAmount ? amountRaw : undefined,
    recipientAddress: hasRecipient ? recipientRaw : undefined,
  };
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
