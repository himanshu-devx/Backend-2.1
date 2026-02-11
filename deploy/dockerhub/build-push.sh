#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DOCKER_ENV_FILE:-}"
if [[ -n "$ENV_FILE" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  else
    echo "ERROR: DOCKER_ENV_FILE not found: ${ENV_FILE}"
    exit 1
  fi
fi

DOCKER_USERNAME="${DOCKER_USERNAME:-${DOCKERHUB_USERNAME:-}}"
DOCKER_PASSWORD="${DOCKER_PASSWORD:-${DOCKERHUB_PASSWORD:-}}"
DOCKER_TOKEN="${DOCKER_TOKEN:-${DOCKERHUB_TOKEN:-}}"

IMAGE="${DOCKER_IMAGE:-}"
TAG="${DOCKER_TAG:-latest}"
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
CONTEXT="${DOCKER_CONTEXT:-.}"

if [[ -z "$IMAGE" ]]; then
  echo "ERROR: DOCKER_IMAGE is required (e.g. ghcr.io/org/app or dockerhubuser/app)"
  exit 1
fi

if [[ -n "${DOCKER_USERNAME}" && -n "${DOCKER_PASSWORD}" ]]; then
  echo "${DOCKER_PASSWORD}" | docker login -u "${DOCKER_USERNAME}" --password-stdin
elif [[ -n "${DOCKER_USERNAME}" && -n "${DOCKER_TOKEN}" ]]; then
  echo "${DOCKER_TOKEN}" | docker login -u "${DOCKER_USERNAME}" --password-stdin
else
  echo "INFO: No Docker credentials provided. Assuming already logged in."
fi

echo "Building ${IMAGE}:${TAG}..."
docker build --platform "${PLATFORM}" -f "${DOCKERFILE}" -t "${IMAGE}:${TAG}" "${CONTEXT}"

echo "Pushing ${IMAGE}:${TAG}..."
docker push "${IMAGE}:${TAG}"
