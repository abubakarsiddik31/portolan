# WebArena shopping and GitLab

Two realistic held-out apps from [WebArena](https://github.com/web-arena-x/webarena):
the Magento shopping site and the self-hosted GitLab. They are large, so the
images are downloaded and loaded locally, never committed.

## Download the images

```sh
# shopping (~10 GB)
curl -L -o shopping_final_0712.tar \
  http://metis.lti.cs.cmu.edu/webarena-images/shopping_final_0712.tar
docker load --input shopping_final_0712.tar

# GitLab (~5 GB)
curl -L -o gitlab-populated-final-port8023.tar \
  http://metis.lti.cs.cmu.edu/webarena-images/gitlab-populated-final-port8023.tar
docker load --input gitlab-populated-final-port8023.tar
```

The mirrors are listed in WebArena's `environment_docker/README.md`; archive.org
mirrors are available if the CMU host is unreachable.

## Start, configure, and reset

```sh
pnpm webarena:reset
```

The script:

1. removes the `shopping` and `gitlab` containers;
2. starts both from the local images (`docker-compose.yml`, ports 7770 and 8023);
3. waits for both to answer;
4. points Magento and GitLab at `http://$WEBARENA_HOST:7770` and
   `http://$WEBARENA_HOST:8023`;
5. waits again and prints the two URLs.

`WEBARENA_HOST` defaults to `127.0.0.1`. The first GitLab boot and the
reconfigure can take several minutes; the script waits up to 15 minutes.

## Check

```sh
pnpm webarena:check
```

`check.ts` fetches the shopping root and the GitLab sign-in page and exits
non-zero if either is unreachable.

## Tests

The browser smoke tests are opt-in because the images are multi-gigabyte:

```sh
WEBARENA_TESTS=1 pnpm vitest run bench/webarena/webarena.test.ts
WEBARENA_TESTS=1 WEBARENA_RESET=1 pnpm vitest run bench/webarena/webarena.test.ts
```

The second command also runs `reset.sh` and re-checks both apps, which is the
"reachable and resettable" criterion. It is slow and destructive to the two
containers; do not point it at an environment you care about.

`SHOPPING_URL` and `GITLAB_URL` override the defaults if the apps run on
another host.
