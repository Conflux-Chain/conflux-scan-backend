async function main() {
    const dockerContainers = await listContainers();
    const list = filterDockerPorts(dockerContainers,'ApiServer.js', 'API_PORT')
    console.log(JSON.stringify(list,null,4,))
}

async function listContainers() {
    const {Docker} = require('node-docker-api');

    const docker = new Docker({socketPath: '/var/run/docker.sock'});
    let list = await docker.container.list()
    //list = list.map(e=>e.data);
    list = await Promise.all(list.map(e => e.status()));
    list = list.map(e => e.data);
    return list;
}

function filterDockerPorts(containers, jsName, envName) {
    let list = containers;
    list = list.filter(e=>e.Args.filter(arg=>arg.includes(jsName)).length > 0)
    list = list.map(e=>{
        let {Name, Config:{Env}} = e;
        let parts = Env.map(e=>e.split('='))
        parts = parts.filter(p=>p[0]===envName).map(p=>p[1])
        return {Name, Env, ports: parts};
    });
    return list;
    //console.log(list)
}

module.exports = {
    filterDockerPorts, listContainers,
}
if (module === require.main) {
    main().then()
}