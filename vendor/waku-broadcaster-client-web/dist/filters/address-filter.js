export class AddressFilter {
    static allowlist;
    static blocklist;
    static setAllowlist(allowlist) {
        this.allowlist = allowlist;
    }
    static setBlocklist(blocklist) {
        this.blocklist = blocklist;
    }
    static filter(addresses) {
        return addresses
            .filter(address => {
            return !this.allowlist || this.allowlist.includes(address);
        })
            .filter(address => {
            return !this.blocklist || !this.blocklist.includes(address);
        })
            .sort();
    }
}
//# sourceMappingURL=address-filter.js.map