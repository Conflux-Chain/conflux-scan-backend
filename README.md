# conflux-scan-backend

## How to deploy:
- ./run.sh

It will generate `scan.env` file. Edit it as needed.

- ./run.sh

Run the script again, it will:
- Start mysql in a docker container (optional)
- Install dependencies
- automatically generate configuration files
- Compile this project
- Create and start service containers

Generate nginx configuration:
```
./run.sh nginx
```

Commands to operate docker containers:
- docker compose ps -a  , show services
- docker compose stop|start <serviceName: api/block/open_api...>
- docker compose logs -n 50 -f  , check logs

### Reset database
1. docker compose stop
2. ./run.sh dropDB
3. ./run.sh , it will create database again, and then start the service.

### Configurations
There are two configuration files:
- stat/config/Prod.ts
- scan-api/config/local.js

If you did not change them, just :
1. docker compose stop
2. Edit scan.env
3. ./run.sh clean , delete the configuration files mentioned above.
4. ./run.sh  , generate new config files, compile, start the service.

If you edit stat/config.Prod.ts, you MUST compile it:
```
npm run compile
```
and restart the service.


### More than one chain(space):
1. clone this repo to another folder, with different name.
   Docker compose will use that name in container name. 
    ```
     git clone repo_url <FolderName>
    ```
2. ./run.sh
3. edit scan.env, change 3 PORTS, DB_NAME, and other things.
4. Follow the instructions above.

### Evm chain or e space:
1. Run a confura cfx bridge
2. set `IS_EVM=true` in scan.env
3. Follow the instructions above.
