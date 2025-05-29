const fs = require('fs');

function getLoadAvg() {
	const loadavg = fs.readFileSync('/proc/loadavg', 'utf8');
	return loadavg.split(' ').slice(0, 3).map(parseFloat);
}

function getMemInfo() {
	const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
	const lines = meminfo.split('\n');
	const result: any = {};

	lines.forEach(line => {
		const parts = line.split(':');
		if (parts.length === 2) {
			const key = parts[0].trim();
			const value = parts[1].trim().split(' ')[0];
			result[key] = parseInt(value) * 1024; // 转换为字节
		}
	});

	return {
		total: result.MemTotal,
		free: result.MemFree,
		available: result.MemAvailable,
		buffers: result.Buffers,
		cached: result.Cached
	};
}
export function getHardwareInfo() {
// 使用示例
	const load = getLoadAvg();
	const mem = getMemInfo();
	const usedMem = mem.total - mem.free - mem.buffers - mem.cached;
	const memUsage = (usedMem / mem.total) * 100;

	console.log(`负载: ${load.join(', ')}`);
	console.log(`内存使用: ${(usedMem / 1024 / 1024).toFixed(2)} MB / ${(mem.total / 1024 / 1024).toFixed(2)} MB (${memUsage.toFixed(2)}%)`);
}
