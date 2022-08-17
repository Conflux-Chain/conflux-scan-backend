#!/usr/bin/env bash
# It's a template file, copy it to repository root, change APP and BACKUP_NODE before executing.
# Possible apps defined in js file :
# stat_core | scan_api_core | open_api_core | stat_evm | scan_api_evm | open_api_evm
APP='scan_api_core'
BACKUP_NODE='172.31.124.19'
LOCAL='127.0.0.1'
if [ "$2" != "" ]
then
  APP=$2
fi
if [ "$1" = 'up' ]
then
  IP=$LOCAL
elif [ "$1" = 'down' ]
then
  IP=$BACKUP_NODE
else
  echo "Usage: this [ up | down]"
  exit
fi
echo "$1 , use ip [${IP}]"
node ./stat/config/gen-nginx-conf.js $IP $APP WRITE RELOAD