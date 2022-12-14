async function main() {
    const list = await filterDockerPorts('ApiServer.js', 'API_PORT')
    console.log(JSON.stringify(list,null,4,))
}
async function filterDockerPorts(jsName, envName) {
    const {Docker} = require('node-docker-api');

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    let list = await docker.container.list()
    //list = list.map(e=>e.data);
    list = await Promise.all(list.map(e=>e.status()));
    list = list.map(e=>e.data);
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
    filterDockerPorts
}
if (module === require.main) {
    main().then()
}