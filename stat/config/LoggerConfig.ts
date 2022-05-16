import * as fs from "fs";
import * as path from "path";

const util = require('util');

function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}
function parseAppEntryName(str) {
    return str.split('/').slice(-1)[0].split('.')[0]
}
export function redirectLog({subPath='', mainPath = ''} = {}) {
    const [,entry,] = process.argv
    let entryName = parseAppEntryName(entry);
    // console.log('entry is',entry,entryName)

    const dir = entry.startsWith('/Users') ? './log' : `/${entry.split('/')[1]}/log`
    const dateStr = `${new Date().toISOString().substring(0, 10)}`
    const logFilePath = `${dir}/${mainPath || entryName}/${dateStr}${subPath}.log`
    // console.log(`log to ${logFilePath}`)
    ensureDirectoryExistence(logFilePath)
    // Or 'w' to truncate the file every time the process starts.
    const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

    const rawLog = console.log;
    console.log = function () {
        logFile.write(new Date().toISOString())
        logFile.write(' ')
        logFile.write(util.format.apply(null, arguments) + '\n');
        // logStdout.write(util.format.apply(null, arguments) + '\n');
        rawLog.apply(console,arguments)
    }
    console.error = console.log;
}
function testLog() {
    console.log(`write to file.`)
    console.error(`error log`, 1)
}
if (module === require.main) {
    redirectLog();
    testLog();
}