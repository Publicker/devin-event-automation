#!/usr/bin/env bash
set -e

# Creates a GitHub webhook on the target repo pointing to your server.
# Usage: ./setup.sh <repo> <webhook_url>
# Example: ./setup.sh Publicker/superset https://abc123.ngrok.io/webhook

REPO=${1:?Usage: ./setup.sh <owner/repo> <webhook_url>}
WEBHOOK_URL=${2:?Usage: ./setup.sh <owner/repo> <webhook_url>}

source .env

echo "Creating webhook on ${REPO} → ${WEBHOOK_URL}"

gh api repos/${REPO}/hooks \
  --method POST \
  -f "name=web" \
  -f "config[url]=${WEBHOOK_URL}" \
  -f "config[content_type]=json" \
  -f "config[secret]=${GITHUB_WEBHOOK_SECRET}" \
  -f "events[]=issues" \
  -f "events[]=pull_request" \
  -F "active=true"

echo "Webhook created. Issues opened on ${REPO} will now trigger Devin sessions."
