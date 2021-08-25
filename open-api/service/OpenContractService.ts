import {getApiService} from "../ApiServer";

export async function polishContract(page) {
    const contract = new Set<string>()
    function add(row, key) {
        const address = row[key];
        if (address && address.substr(address.indexOf(':')).startsWith(':ac')) {
            contract.add(address)
        }
    }
    page?.list?.forEach(row=>{
        add(row, 'from')
        add(row, 'to')
        add(row, 'contract')
    })
    if (!contract.size) {
        return
    }
    const basicInfo = await getApiService().contractQuery.listBasic({addressArray:[...contract], iconUrl: true})
    page.addressInfo = basicInfo.map
}