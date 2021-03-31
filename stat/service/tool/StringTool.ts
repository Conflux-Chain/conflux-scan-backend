export function decodeUtf8(bytes) {
    let encoded = "";
    for (let i = 0; i < bytes.length; i++) {
        encoded += '%' + bytes[i].toString(16);
    }
    return decodeURIComponent(encoded);
}