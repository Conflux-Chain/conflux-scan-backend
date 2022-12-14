const entries = [
    {        name: 'stat_core',     app_port: 8087, nginx_port: 28087,  path:'/stat/server-info'  },
    {        name: 'scan_api_core', app_port: 8895, nginx_port: 28895, path:'/v1' },
    {        name: 'open_api_core', app_port: 9527, nginx_port: 29527,  path: '/open'    },

    {        name: 'stat_evm',      app_port: 7087, nginx_port: 37087, path:'/stat/server-info'    },
    {        name: 'scan_api_evm',  app_port: 7895, nginx_port: 37895,  path:'/v1'  },
    {        name: 'open_api_evm',  app_port: 19527, nginx_port: 39527, path:'/open'   },
]
// node stat/config/gen-nginx-conf.js 127.0.0.1 stat_core '' ''
async function main()
{
    const [,,ip='',app='', write, reload] = process.argv
    console.log(`got ip [${ip}] app [${app}]`)

    const targetApps = entries.filter(e=>e.name === app);
    if (!ip.match(/^[\d]+\.[\d]+\.[\d]+\.[\d]+$/) || targetApps.length < 1) {
        console.log(`Usage: node ${__filename} <0.0.0.0> [${entries.map(a=>a.name).join(' | ')}] [writeFlag] [reloadFlag]`)
        process.exit(9)
    }
    const dockerContainers = await filterDockerPorts();
    let upstreams = dockerContainers.map(e=>{
        return `\t\t server 127.0.0.1:${parseInt(e.ports[0])}; # ${e.Name}`
    }).join('\n')
    const conf = targetApps.map(e=>{
        let proxy_pass = `http://${ip}:${e.app_port}`
        if (ip === '127.0.0.1') {
            proxy_pass = `http://${e.name}` //use upstream
        }
        return `
    upstream ${e.name} {
${upstreams}        
    }
    # ${e.name}
    server { 
            listen ${e.nginx_port};
            listen [::]:${e.nginx_port};
            access_log /var/log/nginx/access_${e.name}.log;
            error_log /var/log/nginx/error_${e.name}.log;
            location / {
                    proxy_pass ${proxy_pass};
                    proxy_set_header Connection ""; # clear client side keepalive option.
           }
    }
    `}).join('\n');
    console.log(conf)

    if (write) {
        const fs = require('fs')
        fs.writeFileSync(`/etc/nginx/conf.d/${app}.conf`, conf)
    }

    if (reload) {
        await bash('nginx -s reload')
        await new Promise(r=>setTimeout(r, 2000))
        const [app_] = targetApps
        await bash(`curl -s 127.0.0.1:${app_.nginx_port}${app_.path}`)
    }
}
const util = require('util');
const {filterDockerPorts} = require("../../tools/docker");
const exec = util.promisify(require('child_process').exec);
async function bash(cmd) {
    console.log(`now execute: ${cmd}`)
    try {
        const { stdout, stderr } = await exec(cmd);
        console.log('stdout:', stdout);
        console.log('stderr:', stderr);
    } catch (err) {
        console.error(err);
    }
}
main().then()