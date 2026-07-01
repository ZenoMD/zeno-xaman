export const hexToUTF8String = (hexData) => {
    const buffer = Buffer.from(hexData, 'hex');
    return new TextDecoder().decode(buffer);
};
export const bytesToUtf8 = (bytes) => {
    return Buffer.from(bytes).toString('utf8');
};
export const bytesToHex = (bytes) => {
    return Buffer.from(bytes).toString('hex');
};
export const utf8ToBytes = (utf8) => {
    return Buffer.from(utf8, 'utf8');
};
//# sourceMappingURL=conversion.js.map