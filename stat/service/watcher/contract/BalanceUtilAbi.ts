export const BALANCE_UTIL_ABI = [{
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "account", "type": "address"}],
    "name": "WhitelistAdminAdded",
    "type": "event"
}, {
    "anonymous": false,
    "inputs": [{"indexed": true, "internalType": "address", "name": "account", "type": "address"}],
    "name": "WhitelistAdminRemoved",
    "type": "event"
}, {
    "constant": false,
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
    "name": "addWhitelistAdmin",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "constant": true,
    "inputs": [],
    "name": "implementation",
    "outputs": [{"internalType": "address", "name": "impl", "type": "address"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}, {
    "constant": true,
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
    "name": "isWhitelistAdmin",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}, {
    "constant": false,
    "inputs": [],
    "name": "renounceWhitelistAdmin",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
}, {
    "constant": true,
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}, {
        "internalType": "address",
        "name": "token",
        "type": "address"
    }],
    "name": "balanceOf",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}, {
    "constant": true,
    "inputs": [{"internalType": "address[]", "name": "accounts", "type": "address[]"}, {
        "internalType": "address[]",
        "name": "tokens",
        "type": "address[]"
    }],
    "name": "balancesOf",
    "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}, {
    "constant": true,
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}, {
        "internalType": "address[]",
        "name": "tokens",
        "type": "address[]"
    }],
    "name": "balancesOf",
    "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}, {
    "constant": true,
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}, {
        "internalType": "address",
        "name": "token",
        "type": "address"
    }, {"internalType": "uint256", "name": "offset", "type": "uint256"}, {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
    }],
    "name": "tokensOfByIndex",
    "outputs": [{"internalType": "uint256[]", "name": "", "type": "uint256[]"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
}]
