export function polishAssertList(page) {
    page?.list?.forEach(row=>{
        row.amount = row.balance
        row.type = row.type?.replace('ERC', 'CRC')
        row.contract = row.base32
        fixIconUrl(row)
        delete row.tokenHex40id;
        delete row.balance
        delete row.base32
    })
    delete page?.candidate
}
export function fixIconUrl(row) {
    if (row.iconUrl) {
        if (!row.iconUrl.startsWith('http://')) { // without prefix
            if (row.base32.startsWith('cfx:')) { // mainnet
                row.iconUrl = 'https://confluxscan.io/'
            } else if (row.base32.startsWith('cfxtest:')) { // testnet
                row.iconUrl = 'https://testnet.confluxscan.io/'
            }
        }
    }
}