import { isDefined } from '@railgun-community/shared-models';
export const formatDiscoveryPeerId = (peerId) => peerId?.toString?.() ?? String(peerId ?? 'unknown-peer');
export const getKnownPeerIds = async (peerStore) => {
    if (!peerStore?.all) {
        return new Set();
    }
    const peers = await peerStore.all().catch(() => []);
    return new Set(peers.map(peer => formatDiscoveryPeerId(peer.id)));
};
export const getDnsDiscoveryUrls = (enrTrees, customDNS) => {
    const enrTreePeers = [];
    if (isDefined(customDNS)) {
        enrTreePeers.push(...customDNS.enrTreePeers);
        if (!customDNS.onlyCustom) {
            enrTreePeers.push(...[enrTrees.SANDBOX, enrTrees.TEST]);
        }
    }
    return enrTreePeers;
};
export const getConnectionManagerOptions = (maxBootstrapPeers, maxConnections) => ({
    connectionManager: {
        maxBootstrapPeers,
        maxConnections,
    },
});
export const createLoggedPeerExchangeDiscovery = ({ createPeerExchangeDiscovery, getAdmittedPeerExchangePeerIds, getKnownPeerIds: getKnownPeerIdsImpl = getKnownPeerIds, getPeerInfoId, mapNewPeerInfo = peerInfo => peerInfo, maxBootstrapPeers, maxConnections, onBeforeSelectPeerInfos, onPeerInfosSelected, peerExchangeAttemptBuffer = 0, }) => {
    return (components) => {
        const discovery = createPeerExchangeDiscovery()(components);
        const originalQuery = discovery.query?.bind(discovery);
        if (typeof originalQuery !== 'function') {
            return discovery;
        }
        discovery.query = async (peerId) => {
            const knownBefore = await getKnownPeerIdsImpl(components?.peerStore);
            const originalPeerExchangeQuery = discovery.peerExchange?.query?.bind(discovery.peerExchange);
            if (typeof originalPeerExchangeQuery === 'function') {
                discovery.peerExchange.query = async (params) => {
                    const result = await originalPeerExchangeQuery(params);
                    const peerInfos = result?.peerInfos ?? [];
                    const knownBeforeLookup = new Set(knownBefore);
                    const knownPeerInfos = [];
                    const candidateNewPeerInfos = [];
                    for (const peerInfo of peerInfos) {
                        const discoveredPeerId = getPeerInfoId(peerInfo);
                        if (knownBeforeLookup.has(discoveredPeerId)) {
                            knownPeerInfos.push(peerInfo);
                            continue;
                        }
                        const mappedPeerInfo = mapNewPeerInfo(peerInfo);
                        if (isDefined(mappedPeerInfo)) {
                            candidateNewPeerInfos.push(mappedPeerInfo);
                        }
                    }
                    onBeforeSelectPeerInfos?.();
                    const admittedPeerExchangePeerIds = getAdmittedPeerExchangePeerIds();
                    const availableSlots = Math.max(0, maxConnections - maxBootstrapPeers - admittedPeerExchangePeerIds.size);
                    const attemptWindow = Math.min(candidateNewPeerInfos.length, Math.max(availableSlots, 1) + peerExchangeAttemptBuffer);
                    const attemptNewPeerInfos = candidateNewPeerInfos.slice(0, attemptWindow);
                    const allowedNewPeerInfos = [];
                    for (const candidatePeerInfo of attemptNewPeerInfos) {
                        if (allowedNewPeerInfos.length >= availableSlots) {
                            break;
                        }
                        const discoveredPeerId = getPeerInfoId(candidatePeerInfo);
                        if (admittedPeerExchangePeerIds.has(discoveredPeerId)) {
                            continue;
                        }
                        admittedPeerExchangePeerIds.add(discoveredPeerId);
                        allowedNewPeerInfos.push(candidatePeerInfo);
                    }
                    await onPeerInfosSelected?.(attemptNewPeerInfos);
                    return {
                        ...result,
                        peerInfos: [...knownPeerInfos, ...allowedNewPeerInfos],
                    };
                };
            }
            try {
                return await originalQuery(peerId);
            }
            finally {
                if (typeof originalPeerExchangeQuery === 'function') {
                    discovery.peerExchange.query = originalPeerExchangeQuery;
                }
            }
        };
        return discovery;
    };
};
//# sourceMappingURL=waku-peer-discovery.js.map