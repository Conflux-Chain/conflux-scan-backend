import {ethers} from 'ethers'
import {init} from "../tool/FixDailyTokenStat";
import {scheduleSyncEnsFromSearchText, SearchText, syncSearchText} from "./EnsService";
import {
    getAddrOfName,
    getReverseNameByAddress,
    matchNamesOnChain,
    setupEnsChecker,
} from "./EnsService";
import {Conflux, format} from "js-conflux-sdk";
const {utils: {namehash, keccak256, toUtf8Bytes}} = ethers
export async function queryEnsOfName(name: string){
    name = name?.trim()
    const hash = ethers.utils.namehash(name)
    // console.log(`hash`, hash)
    const resolver = await props.regContract.resolver(hash)
    // console.log(`resolver`, resolver)
    if (resolver === '0x0000000000000000000000000000000000000000') {
        console.log(`resolver of [${name}] is 0x0`)
        return {name, resolver:'', addr:''}
    }
    const addr = await props.regContract.attach(resolver).addr(hash);
    const labelHash = keccak256(toUtf8Bytes(name.split('.')[0]))
    const tokenId = BigInt(labelHash);
    const tokenURI = await props.baseContract.tokenURI(tokenId).catch(e=>{
        console.log(`token uri fail`, e)
        return ''
    })
    console.log(`name [${name}] hash [${hash}] resolver ${resolver}, addr ${addr} tokenURI [${tokenURI}]`)
    return {name, resolver, addr, tokenURI}
}
const props = {
    initialized: false,
    regContract: null, baseContract:null, ethers: undefined
}
export async function initEvmEnsTool(){
    if (props.initialized) {
        return
    }
    props.ethers = ethers.providers.getDefaultProvider('https://evmtestnet.confluxrpc.com')
    const abi = [
        'function resolver(bytes32 node) public view returns (address)', // on reg
        'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
        'function owner(bytes32 node) public view returns (address)',
        'function setResolver(bytes32 node, address resolver)',
        'function addr(bytes32 node) public view returns (address)', // on resolver
        'function setAddr(bytes32 node, address addr)',
        'function register(bytes32 label, address owner)', // on FIFS reg
    ]
    props.regContract = new ethers.Contract('0xC7b7224F76dD98bE23b717668d55cB40E9B3DF7f', abi, props.ethers)
    props.baseContract = new ethers.Contract('0x97c7Ee0d240f36a08f22BE6a9f4f076dB49AFE6f', [
        'function tokenURI(uint256 tokenId) view returns (string memory)',
    ], props.ethers)
}

async function addRecord(p1: string, p2: string) {
    const pr = '0x898BE98CC743bf914CA52C648897527ffD14B024'
    const trader = new ethers.Wallet(p1, props.ethers)
    console.log(`trader`, trader.address)
    const fifs = props.regContract.attach('0x643d1412E65C765e1CC024C2da1F4bf50aB7A479') // FIFSRegistrar
        .connect(trader)
    const label = p2;
    const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label))
    await fifs.register(labelHash, trader.address, {gasPrice: 1000000000})
        .then(tx => tx.wait())
        .then(receipt => {
            console.log('receipt', receipt.transactionHash)
        }).catch(err => {
            console.log(`fail`, err)
        })
    const name = `${label}.fif`
    await props.regContract.owner(namehash(name)).then(res => {
        console.log(`owner of ${name} is `, res)
    })
    await props.regContract.connect(trader).setResolver(namehash(name), pr).then(tx => tx.wait()).catch(e => {
        console.log(`set resolver fail`, e, e.data)
    })
    await props.regContract.attach(pr).connect(trader).setAddr(namehash(name), trader.address).then(tx => tx.wait()).catch(e => {
        console.log(`set addr fail`, e, e.data)
    })
    await queryEnsOfName(name)
    // await queryName('fif')
}

async function main(){
    await initEvmEnsTool()
    const [,,cmd, p1, p2] = process.argv
    if (cmd === 'addRecord') {
        await addRecord(p1, p2);
    } else if (cmd === 'match') {
        await setupEnsChecker(new Conflux({url:'https://evmtestnet.confluxrpc.com/cfxbridge'}), true);
        const name = await getReverseNameByAddress(p1).then(res=>{
            console.log(`getReverseNameByAddress ${p1} [${res}]`)
            return res;
        });
        let fullName = `${name}.cfx`;
        fullName = 'reverse'
        const addrOfName = await getAddrOfName(fullName);
        const node = addrOfName[1].toString("hex");
        console.log(`addrOfName [${fullName}] => `, format.hexAddress(addrOfName[0]), node)
        const result = await matchNamesOnChain([p1], ".cfx")
        console.log(`match result`, result)
    } else if (cmd === 'query') {
        await queryEnsOfName(p1).catch(e=>{
            console.log(`error`, e)
        })
    } else if (cmd === 'labelHash') {
        console.log(`label hash ${p1} : `, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(p1)))
        // console.log(`name hash ${p1} : `, ethers.utils.namehash(p1))
    } else if (cmd === 'testSync') {
        await init()
        // await SearchText.create({text: p1})
        // await syncSearchText()
        // await SearchText.sequelize.close()
        await scheduleSyncEnsFromSearchText()
        return
    } else {
        console.log(`unknown cmd [${cmd}]`)
    }
    console.log(`done`)
    process.exit(0)
}

if (module === require.main) {
    main().then()
}