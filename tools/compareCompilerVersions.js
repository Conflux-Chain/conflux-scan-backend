#!/usr/bin/env node

const baselineUrl = 'https://evmtestnet.confluxscan.org/v1/contract/compiler';
const targetUrl = process.argv[2];

if (!targetUrl || process.argv.length !== 3) {
    console.error('Usage: node tools/compareCompilerVersions.js <target-url>');
    process.exit(2);
}

try {
    const url = new URL(targetUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use HTTP or HTTPS');
} catch (error) {
    console.error(`Invalid target URL: ${error.message}`);
    process.exit(2);
}

async function getVersions(url) {
    const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

    const body = await response.json();
    if (body?.status !== '1' || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) {
        throw new Error(`${url}: unexpected API response (status: ${JSON.stringify(body?.status)}, message: ${JSON.stringify(body?.message)})`);
    }
    return body.result;
}

async function main() {
    const [baseline, target] = await Promise.all([
        getVersions(baselineUrl),
        getVersions(targetUrl),
    ]);
    const baselineKeys = Object.keys(baseline).sort();
    const targetKeys = Object.keys(target).sort();
    const onlyBaseline = baselineKeys.filter(version => !Object.hasOwn(target, version));
    const onlyTarget = targetKeys.filter(version => !Object.hasOwn(baseline, version));
    const changed = baselineKeys.filter(version => Object.hasOwn(target, version) && baseline[version] !== target[version]);

    console.log(`Baseline: ${baselineUrl} (${baselineKeys.length} versions)`);
    console.log(`Target:   ${targetUrl} (${targetKeys.length} versions)`);
    for (const version of onlyBaseline) console.log(`Missing from target: ${version} = ${JSON.stringify(baseline[version])}`);
    for (const version of onlyTarget) console.log(`Only in target: ${version} = ${JSON.stringify(target[version])}`);
    for (const version of changed) {
        console.log(`Different ${version}: baseline=${JSON.stringify(baseline[version])}, target=${JSON.stringify(target[version])}`);
    }

    const differences = onlyBaseline.length + onlyTarget.length + changed.length;
    console.log(differences === 0 ? 'Compiler versions match.' : `${differences} difference(s) found.`);
    if (differences) process.exitCode = 1;
}

main().catch(error => {
    console.error(`Comparison failed: ${error.message}`);
    process.exitCode = 2;
});
