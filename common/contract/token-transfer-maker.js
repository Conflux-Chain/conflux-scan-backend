const {ethers} = require('ethers')
const {initCfxSdk} = require('../../stat/service/common/utils');

function buildAbi(methodArr = []) {
    const iface = new ethers.utils.Interface(methodArr);
    let data = iface.format(ethers.utils.FormatTypes.json);
    return data;
}
async function main() {
    const [, , cmd, arg1, arg2] = process.argv;
    console.log(`rpc ${arg2}`)
    if (cmd === 'core') {
        await core();
    } else if (cmd === 'evm') {
        await evm();
    }
}
async function evm() {
    const [, , cmd, arg1, arg2] = process.argv;
    const abi = [
        'function deposit() payable', // no transfer event emitted
        'function transfer(address dst, uint256 wad) public returns (bool)',
    ]
    const signer = new ethers.Wallet(arg1, ethers.getDefaultProvider(arg2));
    console.log(`account at evm ${signer.address}`)
    const wcfx = new ethers.Contract(
        '0x2ed3dddae5b2f321af0806181fbfa6d049be47d8',
        abi, signer)
    async function repeat() {
        const {transactionHash} = await wcfx.transfer(signer.address, 1).then(tx=>tx.wait())
        console.log(`ok ${new Date().toISOString()} ${transactionHash}`)
    }
    repeat().then(()=>{
        setInterval(repeat, 30_000)
    })
}
async function core() {
    const [, , cmd, arg1, arg2] = process.argv;
    const abi = [
        'function deposit() payable'
    ]
    const cfx = await initCfxSdk({url: arg2});
    const abiJson = buildAbi(abi);
    let wcfxAddr = ''
    wcfxAddr = 'cfxtest:achs3nehae0j6ksvy1bhrffsh1rtfrw1f6w1kzv46t'
    const account = cfx.wallet.addPrivateKey(arg1);
    console.log(`network ${cfx.networkId} account ${account}`)
    const wcfx = cfx.Contract({abi: abiJson, address: wcfxAddr});
    async function repeat() {
        await wcfx.deposit().sendTransaction({
            from: account, value: 1, nonce: await cfx.getNextNonce(account),
        }).executed();
        console.log(`ok ${new Date().toISOString()}`)
    }
    repeat().then(()=>{
        setInterval(repeat, 30_000);
    })
}
if (module === require.main) {
    main().then();
}

