import {Conflux, CONST, Contract, format} from "js-conflux-sdk";
import {StatApp} from "../../StatApp";

const abi = require("./abi")

export async function patchApprovalList({cfx, account, list} =
                                            {
                                                cfx: Conflux, account: '', list: [{
                                                    type: '', base32: '',
                                                    currentApproval: '', approvalType: '', spender: '', error: '',
                                                    value: '',
                                                    to: ''
                                                }]
                                            }
) {
    const tasks = []

    function setError(entry, e) {
        entry.currentApproval = ''
        entry.error = `${e}`
    }

    list.forEach(entry => {
        if (!entry.type) {
            setError(entry, `token type: [${entry.type}] is empty`)
            return
        }
        //@ts-ignore
        const {allowance, getApproved, isApprovedForAll} = new Contract({abi, address: entry.base32}, cfx)
        let spender = entry.to;
        if (entry.type === 'ERC20') {
            tasks.push(allowance(account, spender).then(res => {
                entry.value = res.toString();
                if (entry.value === '0') {
                    entry['invalid'] = true;
                }
            }).catch(e => setError(entry, e)));
        } else if (entry.approvalType === "ApprovalForAll") {
            tasks.push(isApprovedForAll(account, spender).then(res => {
                entry.value = res.toString();
                if (entry.value === 'false') {
                    entry['invalid'] = true;
                }
            }).catch(e => setError(entry, e)));
        } else if (entry.type === "ERC721") {
            tasks.push(getApproved(BigInt(entry.value)).then(res => {
                const preTo = entry.to;
                entry.to = res.toString();
                if (preTo !== entry.to) {
                    console.log(`approval receiver changed from [${preTo}]`)
                }
                if (format.hexAddress(res.toString()) === CONST.ZERO_ADDRESS_HEX) {
                    entry['invalid'] = true;
                }
            }).catch(e => setError(entry, e)));
        }
    })
    await Promise.all(tasks)
    return list.filter(item=>!item['invalid']);
}

export async function fixApprovalData(page:any) {
    const addressInfo = page.addressInfo || {};
    page.list.forEach(entry=>{
        if (StatApp.isEVM) {
            entry.spender = format.hexAddress(entry.spender);
            delete entry['contractAddress'];
        }
        entry.spenderInfo = addressInfo[entry.spender] || {};
        entry.spenderName = entry.spenderInfo.contract?.name || entry.spenderInfo.token?.name || "";
        delete entry['to'];
    })
    delete page.addressInfo;
}