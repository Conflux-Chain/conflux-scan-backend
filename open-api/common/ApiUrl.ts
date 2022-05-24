module.exports = {
    cfxUrls:{
        prefix: '/open',
        paths: {
            // accounts
            listAccountTransaction: '/account/transactions',
            listAccountCfxTransfer: '/account/cfx/transfers',
            listAccountTransfer20: '/account/crc20/transfers',
            listAccountTransfer721: '/account/crc721/transfers',
            listAccountTransfer1155: '/account/crc1155/transfers',
            listAccountAssets: '/account/tokens',

            // token
            getTokenInfo: '/token/tokeninfo',

            // nft assets
            listNFTBalances: '/nft/balances',
            listNFTTokens: '/nft/tokens',
            getNFTPreview: '/nft/preview',

            // statistics
            listMiningStat: '/statistics/mining',
            getSupplyStat: '/statistics/supply',
            listTpsStat: '/statistics/tps',
            listContractStat: '/statistics/contract',
            listCfxHolderStat: '/statistics/account/cfx/holder',
            listAccountGrowthStat: '/statistics/account/growth',
            listAccountActiveStat: '/statistics/account/active',
            listTransactionStat: '/statistics/transaction',
            listCfxTransferStat: '/statistics/cfx/transfer',
            listTokenTransferStat: '/statistics/token/transfer',
            listGasUsedTopStat: '/statistics/top/gas/used',
            listMinerTopStat: '/statistics/top/miner',
            listTransactionSenderTopStat: '/statistics/top/transaction/sender',
            listTransactionReceiverTopStat: '/statistics/top/transaction/receiver',
            listCfxSenderTopStat: '/statistics/top/cfx/sender',
            listCfxReceiverTopStat: '/statistics/top/cfx/receiver',
            listTokenTransferTopStat: '/statistics/top/token/transfer',
            listTokenSenderTopStat: '/statistics/top/token/sender',
            listTokenReceiverTopStat: '/statistics/top/token/receiver',
            listTokenParticipantTopStat: '/statistics/top/token/participant',
            listTokenHolderStat: '/statistics/token/holder',
            listTokenUniqueSenderStat: '/statistics/token/unique/sender',
            listTokenUniqueReceiverStat: '/statistics/token/unique/receiver',
            listTokenUniqueParticipantStat: '/statistics/token/unique/participant',
        }
    },

    ethUrls: {
        prefix: '/open',
        paths: {
            // compatible with etherscan
            gateway: '/api',

            // nft assets
            listNFTBalances: '/nft/balances',
            listNFTTokens: '/nft/tokens',
            getNFTPreview: '/nft/preview',

            // statistics
            listMiningStat: '/statistics/mining',
            getSupplyStat: '/statistics/supply',
            listTpsStat: '/statistics/tps',
            listContractStat: '/statistics/contract',
            listCfxHolderStat: '/statistics/account/cfx/holder',
            listAccountGrowthStat: '/statistics/account/growth',
            listAccountActiveStat: '/statistics/account/active',
            listTransactionStat: '/statistics/transaction',
            listCfxTransferStat: '/statistics/cfx/transfer',
            listTokenTransferStat: '/statistics/token/transfer',
            listGasUsedTopStat: '/statistics/top/gas/used',
            listMinerTopStat: '/statistics/top/miner',
            listTransactionSenderTopStat: '/statistics/top/transaction/sender',
            listTransactionReceiverTopStat: '/statistics/top/transaction/receiver',
            listCfxSenderTopStat: '/statistics/top/cfx/sender',
            listCfxReceiverTopStat: '/statistics/top/cfx/receiver',
            listTokenTransferTopStat: '/statistics/top/token/transfer',
            listTokenSenderTopStat: '/statistics/top/token/sender',
            listTokenReceiverTopStat: '/statistics/top/token/receiver',
            listTokenParticipantTopStat: '/statistics/top/token/participant',
            listTokenHolderStat: '/statistics/token/holder',
            listTokenUniqueSenderStat: '/statistics/token/unique/sender',
            listTokenUniqueReceiverStat: '/statistics/token/unique/receiver',
            listTokenUniqueParticipantStat: '/statistics/token/unique/participant',

            // account(deprecated)
            listAccountTransaction: '/account/transactions',
            listAccountCfxTransfer: '/account/cfx/transfers',
            listAccountTransfer20: '/account/crc20/transfers',
            listAccountTransfer721: '/account/crc721/transfers',
            listAccountTransfer1155: '/account/crc1155/transfers',
            listAccountAssets: '/account/tokens',
        }
    }
};