set -e
_GIT_REPO="git@github.com:Conflux-Chain/conflux-scan-backend.git"
if [ "$1" == "clean" ]; then
	rm stat/config/Prod.*
	docker compose stop
	exit
fi

echo "Deploy blockchain browser(scan)"
_DB_NAME="core"
_IS_EVM=""
_NO_CORE_SPACE=""
CORE_RPC=""
CORE_DB=core
V1_PORT=8895
STAT_PORT=8087
OPEN_PORT=9527
#_DB_PWD=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 13; )
_DB_PWD=uqgcItNHKTIuE

SPACE="core"
PUB_IP=$(curl cip.cc -s | head -1 | awk '{print $3}')

if [ -s "./scan.env" ]; then
	_HAS_ENV="1"
	echo "load scan.env"
	source ./scan.env
	if [ "true" == "$_IS_EVM" ]; then
		SPACE="evm"
	fi

	if [ "$1" == "dropDB" ]; then
		echo "drop db now, wait a moment. $_DB_NAME"
		_DB_V=$(mysql -h $_DB_HOST -P$_DB_PORT -u $_DB_USER -p$_DB_PWD -e "drop database $_DB_NAME" && echo "OK" || echo "failed to access db")
		echo "db result: $_DB_V"
		exit
	fi
	if [ "$1" == "nginx" ]; then
		echo """
	# add these lines to /etc/nginx/sites-available/default, near the default 'location /' .
        location /$SPACE/rpc {
                proxy_pass $_RPC/;
        }
        location /$SPACE/v1/ {
                proxy_pass http://127.0.0.1:$V1_PORT/v1/;
        }
        location /$SPACE/stat/ {
                proxy_pass http://127.0.0.1:$STAT_PORT/stat/;
        }
        location /$SPACE/open/ {
                proxy_pass http://127.0.0.1:$OPEN_PORT/open/;
        }
		"""
		echo "you may need these urls to setup frontend:"
		echo "scan backend api: http://$PUB_IP/$SPACE"
		echo "scan open api   : http://$PUB_IP/$SPACE/open"
		echo "confura rpc     : http://$PUB_IP/$SPACE/rpc"
		if [ "true" == "$_IS_EVM" ]; then
			echo
			echo "core space url for evm frontend:"
			echo "scan backend api: http://$PUB_IP/core"
			echo "scan open api   : http://$PUB_IP/core/open"
			echo
		fi
		exit
	fi
else
	echo """
# wheter have a mysql server.
# n : will create one in docker.
# y : using an existing database, edit props below.
_HAS_MYSQL_SERVER="n"
_DB_HOST="127.0.0.1"
_DB_PORT="3306"
_DB_USER="root"
# auto generated password, edit it if you have a stand alone mysql instance.
_DB_PWD="$_DB_PWD"
_DB_NAME="core"
# http only, do not support https.
# you can run a dev node in docker, see https://github.com/Conflux-Chain/conflux-docker
# for evm compatiable chain, please run a cfx-bridge, see https://github.com/Conflux-Chain/confura.git
_RPC="http://127.0.0.1:12537"
# cfx bride uses port 32537
#_RPC="http://127.0.0.1:32537"
# conflux e space depends on core space rpc
#CORE_RPC="http://127.0.0.1:12537"
# each chain(space) needs 3 ports, make sure changing them if you have two or more chains(spaces).
V1_PORT=8895
STAT_PORT=8087
OPEN_PORT=9527
# un-comment if it's a evm compatiable chain
#_IS_EVM=true
# for conflux e space
#CORE_DB=core
# un-comment if it's a independent evm chain(not a conflux e-space)
#_NO_CORE_SPACE=true
#traceNotAvailable=true
	""" > ./scan.env
	echo "We have created a config file, scan.env."
	echo "Edit it and run this script again"
	exit
fi

echo "OS requirements: Ubuntu Noble 24.04 (LTS)"
_OS=$(cat /etc/issue || echo 'unknown')
echo "Current OS     : $_OS"

_GIT=$(which git || echo "not found")
echo "Software requirements: git: $_GIT"
if [ "not found" == "${_GIT}" ]; then
	echo "Please install git first, eg.: sudo apt install git"
	exit
fi

echo "Checking repository accessibility..."
echo $_GIT_REPO
_GIT_FAILURE="failed to access git repo!"
_LS_REMOTE="skip"
#_LS_REMOTE=$(git ls-remote $_GIT_REPO || echo $_GIT_FAILURE)
if [ "$_GIT_FAILURE" == "$_LS_REMOTE" ]; then
	echo "$_LS_REMOTE"
	#exit
fi


_DOCKER=$(which docker || echo "not found")
echo "Software requirements: docker: $_DOCKER"
if [ "not found" == "${_DOCKER}" ]; then
	_DOCKER_DOC="https://docs.docker.com/engine/install/ubuntu/"
	echo "Please install docker first, see $_DOCKER_DOC"
	#exit
else
	sudo docker version | head -2
fi

# docker compose
_DOCKER_C=$(docker compose version 2>/dev/null || echo "not found")
echo "Software requirements: docker compose: $_DOCKER_C"
if [ "not found" == "${_DOCKER_C}" ]; then
	_DOCKER_DOC="https://docs.docker.com/compose/install/"
	echo "Please install docker compose first, see $_DOCKER_DOC"
	exit
fi

# nodejs
fn_loadNVM() {
	export NVM_DIR="$HOME/.nvm"
	[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
	[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
	return 0
}
fn_loadNVM
_NODE=$(which node || echo "not found")
echo "Software requirements: nodejs : $_NODE"
if [ "not found" == "${_NODE}" ]; then
	_DOC="https://nodejs.org/en/download/package-manager"
	echo "We need to install nodejs, see $_DOC"
	read -p "Install it now? type y/n: " -n 1 -r
	echo    # (optional) move to a new line
	if [[ $REPLY =~ ^[Yy]$ ]]
	then
		# installs nvm (Node Version Manager)
		curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
		# load nvm env
		fn_loadNVM
		# download and install Node.js (you may need to restart the terminal)
		nvm install 20
		# verifies the right Node.js version is in the environment
		node -v # should print `v20.17.0`
		# verifies the right npm version is in the environment
		npm -v # should print `10.8.2`
	else
		exit
	fi
else
	echo "node version is:"
	node -v
fi

which jq || sudo apt install jq

if [[ $_RPC == "" ]]; then
	echo "must set the rpc url."
	exit
else
	echo "detect chain at $_RPC ..."
	_JSON=$(curl -XPOST -H"content-type: application/json" -s -d '
	{"jsonrpc":"2.0","id":"0", "method": "cfx_getStatus"}
	' "$_RPC")
	_CFX_NE=$(echo $_JSON|grep "does not exist/is not available"|wc -l)
	_CFX_NF=$(echo $_JSON|grep "Method not found"|wc -l)
	if [[ "1" == "$_CFX_NE" || "1" == "$_CFX_NF" ]]; then
		_JSON=$(curl -XPOST -H"content-type: application/json" -s -d '
	{"jsonrpc":"2.0","id":"0", "method": "eth_chainId"}
	' "$_RPC")
		_EVM_NE=$(echo $_JSON|grep "does not exist/is not available"|wc -l)
		if [ "1" == "$_EVM_NE" ]; then
			echo $_JSON | jq
			echo "unsupported chain, neither cfx nor evm"
			exit
		else
			echo "evm chain is supported, but you must run a cfx-bridge. read the comments in scan.env, _RPC section."
			exit
		fi
	elif [ "0" == $(echo $_JSON | grep "chainId" | wc -l) ]; then
		echo $_JSON | jq
		echo "failed to dectect chain id"
		exit
	else
		echo "supported chain"
	fi
	# check getEpochReceipts
	_JSON=$(curl -XPOST -H"content-type: application/json" -s -d '
	{"jsonrpc":"2.0","id":"0", "method": "cfx_getEpochReceipts", "params": ["0x01"]}
	' "$_RPC")
	_CFX_NE=$(echo $_JSON|grep "access forbidden by allowlists"|wc -l)
	if [ "1" == "$_CFX_NE" ]; then
		echo "the rpc endpoint must support/enable/allow this method:cfx_getEpochReceipts"
		echo $_JSON
		exit
	fi
fi
# mysql
if [[ $_HAS_MYSQL_SERVER =~ ^[Yy]$ ]]; then
	#nothing
	echo
elif [[ "$_DB_IN_DOCKER_CREATED" == "1" ]]; then
	echo "db in docker already created. skip"
	_HAS_MYSQL_SERVER="y"
fi
if [[ $_HAS_MYSQL_SERVER =~ ^[Yy]$ ]]; then
	echo "use db config in env file"
else
	read -p "Start a mysql server in docker? type y/n: " -n 1 -r
	echo    # (optional) move to a new line
	if [[ $REPLY =~ ^[Yy]$ ]]; then
		_DB_HOST="127.0.0.1"
		_DB_PORT=3306
		_DB_USER="root"
		echo "generated password: $_DB_PWD" | tee -a ./gen_pwd.txt
		sudo docker run --name mysql8.0 -e MYSQL_ROOT_PASSWORD=$_DB_PWD -p 3306:3306 -d mysql:8.0
		echo "# mysql container has been created." >> ./scan.env
		echo "_DB_IN_DOCKER_CREATED=1" >> ./scan.env
	else
		echo "user quit"
		exit
	fi
fi
echo "$_DB_HOST $_DB_PORT $_DB_USER $_DB_PWD $_DB_NAME"

# mysql client
_MYSQL_C=$(which mysql|| echo "not found")
echo "Software requirements: mysql client: $_MYSQL_C"
if [ "not found" == "${_MYSQL_C}" ]; then
	echo "install mysql client..."
	sudo apt install mysql-client-core-8.0
else
	mysql --version
fi

echo "test db config"
while true
do
_DB_V=$(mysql -h $_DB_HOST -P$_DB_PORT -u $_DB_USER -p$_DB_PWD $_DB_NAME -e "select version() as DB_VERSION;" 2>&1 || echo "failed to access db")
# ERROR 1049 (42000): Unknown database
if [ "1" == "$(echo $_DB_V | grep 'ERROR 1049 (42000)' | wc -l)" ]; then
	echo "$_DB_V"
	echo "create database now..."
	mysql -h $_DB_HOST -P$_DB_PORT -u $_DB_USER -p$_DB_PWD -e "create database $_DB_NAME CHARACTER SET utf8mb4"
	if [ "$?" != "0" ]; then
		exit
	else
		echo "created"
		break
	fi
elif [ "1" == "$(echo $_DB_V | grep 'Lost connection to MySQL server ' | wc -l)" ]; then
	echo " db is not ready, $_DB_V"
	echo "try again..."
	sleep 5
	continue
elif [ "1" == "$(echo $_DB_V | grep 'DB_VERSION' | wc -l)" ]; then
	echo "DB is OK"
	echo "$_DB_V"
	mysql -h $_DB_HOST -P$_DB_PORT -u $_DB_USER -p$_DB_PWD -e "show create database $_DB_NAME \G"
	break
else
	echo "error: $_DB_V"
	exit
fi
done

echo "check local repo"
if [ -s ".git" ]; then
	echo "local repo exists, skip cloning."
else
	git init .
	git branch main
	git remote add origin $_GIT_REPO
	git pull origin main
fi

echo "install project dependencies..."
which rustc || sudo apt  install rustc
which cargo || sudo apt  install cargo
which make || sudo apt install make
which g++|| sudo apt install g++

if [ -s "./node_modules" ]; then
	echo "node_modules exists"
else
	npm i
fi

if [ -s "./stat/config/Prod.ts" ]; then
	echo "config file exists"
else
	echo "generate config file ..."
	if [ "" != "$_IS_EVM" ]; then
		_IS_EVM="isEvm: $_IS_EVM, coreDB: '$CORE_DB',"
	fi
	if [ "" != "$_NO_CORE_SPACE" ]; then
		_NO_CORE_SPACE="noCoreSpace: $_NO_CORE_SPACE,"
	fi
	if [ "" != "$traceNotAvailable" ]; then
  		traceNotAvailable="traceNotAvailable: $traceNotAvailable,"
  	fi
	if [ "" != "$CORE_RPC" ]; then
		CORE_RPC="conflux2: '$CORE_RPC',"
	fi
	echo """
// eslint-disable-next-line no-unused-vars
export default {
    port: $STAT_PORT,
    apiPort: $OPEN_PORT,
    v1port: $V1_PORT,
    serverTag: 'test-sync',
    conflux:          { url: '$_RPC' ,keepAlive: true, },
    tokenTransferRpc: { url: '$_RPC',keepAlive: true, },
    cfxTransferRpc: { url: '$_RPC',keepAlive: true,},
    blockSyncRpc: { url: '$_RPC',keepAlive: true,},
    preload: 4,
    $_IS_EVM $_NO_CORE_SPACE $traceNotAvailable $CORE_RPC
    influxDB: {disable: true},
    database: { USE_MYSQL: true, syncSchema: true, },
  databaseRW: {
    USE_MYSQL: true,
    instanceName: '$_DB_NAME',
    dialect: 'mysql',
    port: $_DB_PORT,
    replication: {
      read: [
        { host: '$_DB_HOST', username: '$_DB_USER', password: '$_DB_PWD' },
      ],
      write: { host: '$_DB_HOST', username: '$_DB_USER', password: '$_DB_PWD' },
    },
    logging: false,
  },
  wrappedCFX: '0x2ed3dddae5b2f321af0806181fbfa6d049be47d8', // placeholder
}
	""" > ./stat/config/Prod.ts
	echo """
const frontend = require('./frontend');
module.exports = {
frontend,
port: $V1_PORT,
conflux: {
    url: '$_RPC',
    keepAlive:true,
  },
        "CONFURA_URL": 'http://$PUB_IP/$SPACE/rpc',
        "OPEN_API_URL": 'http://$PUB_IP/$SPACE/open',
        "CORE_API_URL": 'http://$PUB_IP/core',
        "CORE_OPEN_API_URL": 'http://$PUB_IP/core/open',
}
	""" > ./scan-api/config/local.js
fi

npm run compile || exit

dc="sudo docker compose"
fn_up() {
	if [ "0" == "$(sudo docker compose ps -a | grep $1 | wc -l)" ]; then
		echo "create container: $1..."
		$dc up -d $1
	else
		$dc start $1
	fi
}
fn_up block
echo "waiting for database ..."
sleep 20
fn_up epoch
fn_up cfx_transfer
fn_up token_transfer
fn_up token_x
fn_up compiler
sleep 5
fn_up api
fn_up open_api
#$dc logs -n 10 -f block
#$dc logs -n 10 -f epoch
#$dc logs -n 10 -f cfx_transfer
#$dc logs -n 10 -f token_transfer
#$dc logs -n 10 -f token_x

echo "finished. have fun. 🚗"
