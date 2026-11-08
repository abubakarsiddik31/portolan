#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

HOST="${WEBARENA_HOST:-127.0.0.1}"
SHOPPING_IMAGE="${SHOPPING_IMAGE:-shopping_final_0712}"
GITLAB_IMAGE="${GITLAB_IMAGE:-gitlab-populated-final-port8023}"

for image in "$SHOPPING_IMAGE" "$GITLAB_IMAGE"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "missing image: $image"
    echo "download the tar and run 'docker load --input <file>.tar' first; see README.md"
    exit 1
  fi
done

wait_for() {
  local url="$1"
  local timeout="$2"
  local name="$3"
  local deadline=$((SECONDS + timeout))

  while (( SECONDS < deadline )); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then
      echo "$name is up at $url"
      return 0
    fi
    sleep 5
  done

  echo "$name did not come up at $url within ${timeout}s"
  return 1
}

echo "stopping and removing the old containers"
docker rm -f shopping gitlab >/dev/null 2>&1 || true
docker compose down --remove-orphans >/dev/null 2>&1 || true

echo "starting shopping and gitlab"
docker compose up -d

wait_for "http://${HOST}:7770/" 300 shopping
wait_for "http://${HOST}:8023/users/sign_in" 900 gitlab

echo "pointing shopping at http://${HOST}:7770"
docker exec shopping /var/www/magento2/bin/magento setup:store-config:set \
  --base-url="http://${HOST}:7770"
docker exec shopping mysql -u magentouser -pMyPassword magentodb -e \
  "UPDATE core_config_data SET value=\"http://${HOST}:7770/\" WHERE path = \"web/secure/base_url\";"
docker exec shopping /var/www/magento2/bin/magento cache:flush

echo "pointing gitlab at http://${HOST}:8023"
docker exec gitlab update-permissions || true
docker exec gitlab sed -i \
  "s|^external_url.*|external_url 'http://${HOST}:8023'|" /etc/gitlab/gitlab.rb
docker exec gitlab gitlab-ctl reconfigure

wait_for "http://${HOST}:7770/" 120 shopping
wait_for "http://${HOST}:8023/users/sign_in" 300 gitlab

echo "WebArena shopping and GitLab are reachable and reset"
echo "  shopping: http://${HOST}:7770/"
echo "  gitlab:   http://${HOST}:8023/"
