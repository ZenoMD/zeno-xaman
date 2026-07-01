import { Chain } from '@railgun-community/shared-models';
export declare const contentTopics: {
    default: () => string;
    fees: (chain: Chain) => string;
    transact: (chain: Chain) => string;
    transactResponse: (chain: Chain) => string;
    metrics: () => string;
    encrypted: (topic: string) => string;
};
