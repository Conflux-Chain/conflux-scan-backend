export const abi = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "name",
                "type": "string"
            }
        ],
        "name": "getAddrOfName",
        "outputs": [
            {
                "internalType": "address",
                "name": "resolvedAddr",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "node",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "name",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "coinType",
                "type": "uint256"
            }
        ],
        "name": "getAddrOfName",
        "outputs": [
            {
                "internalType": "address",
                "name": "resolvedAddr",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "node",
                "type": "bytes32"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "who",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "coinType",
                "type": "uint256"
            }
        ],
        "name": "getEnsNameMatch",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "who",
                "type": "address"
            }
        ],
        "name": "getEnsNameMatch",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "who",
                "type": "address"
            }
        ],
        "name": "getReverseNameByAddress",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "address[]",
                "name": "addrArr",
                "type": "address[]"
            },
            {
                "internalType": "uint256",
                "name": "coinType",
                "type": "uint256"
            }
        ],
        "name": "matchNames",
        "outputs": [
            {
                "internalType": "string[]",
                "name": "",
                "type": "string[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "ens",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "reverse",
                "type": "address"
            },
            {
                "internalType": "address[]",
                "name": "addrArr",
                "type": "address[]"
            }
        ],
        "name": "matchNames",
        "outputs": [
            {
                "internalType": "string[]",
                "name": "",
                "type": "string[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
]