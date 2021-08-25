export function polishAssertList(page) {
    page?.list?.forEach(row=>{
        row.amount = row.balance
        row.type = row.type?.replace('ERC', 'CRC')
        row.contract = row.base32
        delete row.tokenHex40id
        delete row.balance
        delete row.base32
    })
}