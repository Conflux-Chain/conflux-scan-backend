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
export function getAppEntryName() {
    const [,entry,] = process.argv;
    return parseAppEntryName(entry);
}
function parseAppEntryName(str) {
    return str.split('/').slice(-1)[0].split('.')[0]
}

function dateString(date = new Date()) {
    return date.toISOString().substring(0, 10);
}

function removeExpiredLogs(dirname: string) {
    const now = new Date();
    const cutoffDate = dateString(new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 31,
    )));
    let filenames: string[];
    try {
        filenames = fs.readdirSync(dirname);
    } catch (e) {
        process.stderr.write(`failed to read log directory ${dirname}: ${e}\n`);
        return;
    }
    for (const filename of filenames) {
        const match = /^(\d{4}-\d{2}-\d{2}).*\.log$/.exec(filename);
        if (match && match[1] < cutoffDate) {
            try {
                fs.unlinkSync(path.join(dirname, filename));
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(`failed to remove expired log ${filename}:`, e);
                }
            }
        }
    }
}

export function redirectLog({subPath='', mainPath = ''} = {}) {
    const [,entry,] = process.argv
    let entryName = parseAppEntryName(entry);
    // console.log('entry is',entry,entryName)

    const dir = process.env.SCAN_LOG_DIR || (entry.startsWith('/Users') ? './log' : `/${entry.split('/')[1]}/log`)
    const logDir = `${dir}/${mainPath || entryName}`;
    ensureDirectoryExistence(`${logDir}/placeholder`)
    let currentDate = '';
    let logFile: fs.WriteStream;
    const rotate = () => {
        const nextDate = dateString();
        if (nextDate === currentDate) return;
        logFile?.end();
        currentDate = nextDate;
        logFile = fs.createWriteStream(`${logDir}/${nextDate}${subPath}.log`, { flags: 'a' });
    };
    rotate();
    removeExpiredLogs(logDir);
    const cleanupTimer = setInterval(() => removeExpiredLogs(logDir), 6 * 60 * 60 * 1000);
    cleanupTimer.unref();
    const rotateTimer = setInterval(rotate, 60 * 1000);
    rotateTimer.unref();

    const rawLog = console.log;
    console.log = function () {
        rotate();
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
