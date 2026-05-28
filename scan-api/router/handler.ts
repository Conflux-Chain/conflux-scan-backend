import {Conflux} from "js-conflux-sdk";
import {ConfluxService} from "../service/ConfluxService";
import {AccountQuery} from "../../stat/service/AccountQuery";
import {CONST} from "../../stat/service/common/constant";
import {parseBundleTxByHash, getAAOpLogRange, getAAOpFlatTraces} from "../../stat/service/eip/eip4337bundleParser";
import {TransactionService} from "../service/TransactionService";
import {fmtEVMAddr} from "../../stat/service/common/utils";
import {getAATxDetail} from "../../stat/service/eip/eip4337query";
import {getDelegatedAddrAtTx} from "../../stat/model/EIP7702model";

export async function handleAATxDetail(
  cfx: Conflux,
  confluxService: ConfluxService,
  accountQuery: AccountQuery,
  userOpHash: string,
) {
  const aaTx = await getAATxDetail(cfx, userOpHash);
  if (!aaTx) {
    return { message: 'AA tx not found', userOpHash };
  }

  const bundleTxHash = aaTx.txHash;
  const [parsed, confirmedEpochNumber] = await Promise.all([
    bundleTxHash ? parseBundleTxByHash(cfx, bundleTxHash, {targetUserOpHash: userOpHash}) : Promise.resolve(null),
    confluxService.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_CONFIRMED),
  ]);

  aaTx.confirmedEpochCount = Math.max(confirmedEpochNumber - Number(aaTx.epoch), 0);

  if (aaTx.senderHex && aaTx.epoch && bundleTxHash) {
    aaTx.effectiveAuth = await getDelegatedAddrAtTx(aaTx.senderHex, Number(aaTx.epoch), bundleTxHash)
      .then(res => {
        return res ? accountQuery.patchAddressInfo([res], '', 'address').then(() => res) : null;
      })
      .catch(e => {
        aaTx.effectiveAuthError = e?.message ?? String(e);
        return null;
      });
  }

  if (bundleTxHash) {
    aaTx['blockHash'] = parsed?.receipt?.blockHash || '';
    const blockFetch = parsed?.receipt?.blockHash
      ? (cfx as any).getBlockByHash(parsed.receipt.blockHash)
      : Promise.resolve(null);
    const position = aaTx.position ?? -1;
    if (position >= 0) {
      const [logRange, traceArray, allTokenTransfers, block] = await Promise.all([
        getAAOpLogRange(cfx, bundleTxHash, position, parsed?.receipt),
        getAAOpFlatTraces(cfx, bundleTxHash, position),
        confluxService.getTransactionTokenTransferArray(bundleTxHash),
        blockFetch,
      ]);

      aaTx.blockBaseFeePerGas = (block as any)?.baseFeePerGas?.toString() ?? null;

      const cfxTransfers = TransactionService.buildCfxTransfersFromTraceObj({traceArray});
      cfxTransfers.list.forEach(item => {
        item.from = fmtEVMAddr(item.from);
        item.to = fmtEVMAddr(item.to);
      });
      aaTx.cfxTransfers = cfxTransfers;

      const filteredTokenTransfers = logRange
        ? allTokenTransfers.filter((t: {transactionLogIndex: number}) =>
            t.transactionLogIndex > logRange.startExclusive &&
            t.transactionLogIndex <= logRange.endInclusive
          )
        : [];
      filteredTokenTransfers.forEach((item: {from: string; to: string; address: string}) => {
        item.from = fmtEVMAddr(item.from);
        item.to = fmtEVMAddr(item.to);
        item.address = fmtEVMAddr(item.address);
      });
      aaTx.tokenTransfers = { total: filteredTokenTransfers.length, list: filteredTokenTransfers };
    } else {
      const block = await blockFetch;
      aaTx.blockBaseFeePerGas = (block as any)?.baseFeePerGas?.toString() ?? null;
      aaTx.cfxTransfers = { message: 'op position not found in bundle', total: 0, list: [] };
      aaTx.tokenTransfers = { message: 'op position not found in bundle', total: 0, list: [] };
    }
  } else {
    aaTx.cfxTransfers = { message: 'bundle tx not linked', total: 0, list: [] };
    aaTx.tokenTransfers = { message: 'bundle tx not linked', total: 0, list: [] };
  }

  const addresses = new Set<string>([
    aaTx.senderHex,
    aaTx.bundlerHex,
    aaTx.entryPointHex,
    aaTx.paymasterDecoded?.address,
    aaTx.effectiveAuth?.address,
    ...(aaTx.parsedMethods ?? []).map((m: {to: string}) => m.to),
    ...(aaTx.cfxTransfers?.list ?? []).flatMap((t: {from: string; to: string}) => [t.from, t.to]),
    ...(aaTx.tokenTransfers?.list ?? []).flatMap((t: {from: string; to: string; address: string}) => [t.from, t.to, t.address]),
  ].filter(Boolean));

  aaTx.nameMap = await accountQuery.list([...addresses], {
    withContractInfo: true,
    withENSInfo: true,
    withNameTagInfo: true,
  });

  return aaTx;
}
