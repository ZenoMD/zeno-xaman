"use client";

import { useEffect, useState } from "react";
import type { XrplToken, XrplTokens } from "./types";

export type AssetListState = {
  loading: boolean;
  tokens: XrplToken[];
  error: string | null;
};

/**
 * Load an asset list from the wallet controller, tracking loading/error state.
 * `deps` re-runs the loader — the public (XRPL) list is keyed on the active tab
 * so a bridge that has landed since the last read shows up. A re-run keeps the
 * tokens it already has, so a refresh doesn't blank the picker or the header
 * card on the way to the same numbers.
 */
export function useAssetList(
  loader: () => Promise<XrplTokens | XrplToken[]>,
  deps: React.DependencyList,
): AssetListState {
  const [state, setState] = useState<AssetListState>({
    loading: true,
    tokens: [],
    error: null,
  });
  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.resolve()
      .then(loader)
      .then((res) => {
        const tokens = Array.isArray(res) ? res : res.tokens;
        if (active) setState({ loading: false, tokens, error: null });
      })
      .catch((err: unknown) => {
        if (active)
          setState({
            loading: false,
            tokens: [],
            error: (err as Error).message || String(err),
          });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
