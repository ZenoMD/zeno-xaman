export declare class AddressFilter {
    private static allowlist;
    private static blocklist;
    static setAllowlist(allowlist: Optional<string[]>): void;
    static setBlocklist(blocklist: Optional<string[]>): void;
    static filter(addresses: string[]): string[];
}
