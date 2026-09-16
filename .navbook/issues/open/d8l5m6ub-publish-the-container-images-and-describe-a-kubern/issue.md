---
title: Publish the container images and describe a Kubernetes deployment
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-15T08:35:43Z
labels: [enhancement]
feature: [packaging, server, web]
parent: rop9bg3d
---

The only documented deployment is `docker compose up -d --build` on a Docker host with a Traefik watching the Docker socket, and no image is published: every deployment builds both images from a checkout. That fits one machine. It does not fit a Kubernetes cluster, where Traefik is an ingress controller, TLS comes from cert-manager, and nodes pull images from a registry rather than building them.

Brickcode's Factory is that shape (k3s, Traefik ingress class, cert-manager `ClusterIssuer`, Longhorn volumes), and it currently has no machine that can run `docker build` for Navbook.

## What it should do

1. **Publish the images on release.** `release.yml` builds `packages/server/Dockerfile` and `packages/web/Dockerfile` and pushes `ghcr.io/peyremorgan/navbook-server` and `ghcr.io/peyremorgan/navbook-web` tagged with the version and `latest`, for `linux/amd64` and `linux/arm64`. The CI `docker` job keeps building and smoke-testing them as it does now; the release job reuses that smoke test on the pushed tags.
2. **Describe a Kubernetes deployment.** A `deploy/kubernetes/` example, applied with `kubectl apply -k`, and a README section beside the compose one:
   - the API as a Deployment with `replicas: 1` and `strategy: Recreate` (one server per clone), `securityContext.fsGroup: 1000` so the `node` user can write the clone, a `ReadWriteOnce` PersistentVolumeClaim at `/srv/navbook`, liveness and readiness on `/health`, and the git token from a Secret;
   - the web client as a Deployment reading the same four `NAVBOOK_*` values, readiness on `/config.json`;
   - one Ingress on **one host**, routing `/graphql` and `/health` to the API and `/` to the web client, with the ingress class and the cert-manager issuer as the two values a cluster names. The READMEs say two hostnames; one host is simpler behind an ingress and needs the example to prove it.
3. The compose file gains `image:` references to the published tags, with `--build` kept as the way to run from a checkout.

## Edges

- `GIT_TERMINAL_PROMPT=0` and the environment-borne credential helper already suit a Secret mounted as variables; nothing is written into the volume.
- The API image healthcheck is Docker's; Kubernetes ignores it, so the probes in the example are what count.
