#!/bin/bash

########################## parse parameters ############################
ROOT_PATH_TO_DEPLOY=
HOST_PORT_SCAN_API=
SCRIPT_PATH="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
echo "step-01.path for script is set:$SCRIPT_PATH"
while getopts "p:P:" opt; do
  case $opt in
    p)
        ROOT_PATH_TO_DEPLOY=$OPTARG
        echo "step-01.deploy root path is set:$ROOT_PATH_TO_DEPLOY" ;;
    P)
        HOST_PORT_SCAN_API=$OPTARG
        echo "step-01.listen port is set:$HOST_PORT_SCAN_API" ;;
    *)
        echo "$0: invalid option -$OPTARG" >&2
		    echo "Usage: $0 [-p root_path_to_deploy] [-P listen_port]" >&2
		    exit
		    ;;
  esac
done

####################### clone code from github #########################
mkdir -p "$ROOT_PATH_TO_DEPLOY";
cd "$ROOT_PATH_TO_DEPLOY" || (echo "path $ROOT_PATH_TO_DEPLOY not found!" && exit 1);
echo "step-02.switch dir to:$ROOT_PATH_TO_DEPLOY"
rm -rf conflux-scan-backend
echo "step-03.delete dir:./conflux-scan-backend"
git clone https://github.com/Conflux-Dev/conflux-scan-backend.git
echo "step-04.git cloned from https://github.com/Conflux-Dev/conflux-scan-backend.git"
cd "$ROOT_PATH_TO_DEPLOY/conflux-scan-backend"
echo "step-05.switch dir to:$ROOT_PATH_TO_DEPLOY/conflux-scan-backend"
mkdir -p stat/dist
echo "step-06.make dir dir: stat/dist"
npm install

cd "$ROOT_PATH_TO_DEPLOY"
echo "step-07.switch dir to:$ROOT_PATH_TO_DEPLOY"
rm -rf conflux-scan-statistics
echo "step-08.delete dir:./conflux-scan-statistics"
git clone https://github.com/Conflux-Dev/conflux-scan-statistics.git
echo "step-09.git cloned from https://github.com/Conflux-Dev/conflux-scan-statistics.git"
cd "$ROOT_PATH_TO_DEPLOY/conflux-scan-statistics/stat"
echo "step-10.switch dir to:$ROOT_PATH_TO_DEPLOY/conflux-scan-statistics/stat"
ln -s "$ROOT_PATH_TO_DEPLOY/conflux-scan-backend/stat/dist"
echo "step-11.generate soft link:$ROOT_PATH_TO_DEPLOY/conflux-scan-backend/stat/dist"

cd "$ROOT_PATH_TO_DEPLOY/conflux-scan-statistics"
echo "step-12.switch dir to:$ROOT_PATH_TO_DEPLOY/conflux-scan-statistics"
npm install
echo "step-13.npm installed"
npm run compile
echo "step-14.npm run compiled"

####################### deploy scan api service ########################
cd "$ROOT_PATH_TO_DEPLOY/conflux-scan-backend"
echo "step-15.switch dir to:$ROOT_PATH_TO_DEPLOY/conflux-scan-backend"

if [ ! -f docker-compose.yaml.scan_backend ]; then
  mv docker-compose.yaml docker-compose.yaml.scan_backend
  echo "step-16.rename file docker-compose.yaml to docker-compose.yaml.scan_backend"
else
  rm docker-compose.yaml
  echo "step-17.remove file docker-compose.yaml"
fi
cp "$SCRIPT_PATH/env" ./.env
echo "step-18.copy file:$SCRIPT_PATH/env to path:./.env"
cp "$SCRIPT_PATH/docker-compose.yaml" ./docker-compose.yaml
echo "step-19.copy file:$SCRIPT_PATH/docker-compose.yaml to path:./docker-compose.yaml"

if [ "$HOST_PORT_SCAN_API" ]; then
	sed -i "1c HOST_PORT_SCAN_API=${HOST_PORT_SCAN_API}" .env
	echo "step-20.replace column for file:.env"
fi

docker-compose up -d
echo "docker-compose up finished!"