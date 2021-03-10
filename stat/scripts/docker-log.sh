# By default docker uses the json-file driver to record your containers logs
# and the raw json output of the logs can be found in:
#
#/var/lib/docker/containers/[container-id]/[container-id]-json.log
docker-compose logs -f -t --tail=20