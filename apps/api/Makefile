# OrbitHub API
#
#   make help        show every target
#   make dev         start with watch (the normal way to work)
#   make db-reset    wipe the local database and re-apply the migrations
#
# The API needs no external service to run: without DATABASE_URL it uses an
# embedded Postgres (PGlite) in apps/api/.data/pglite.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM ?= npm
ENV := $(NPM) run --workspace @orbit-hub/api
MIGRATIONS := ./drizzle
DEV_DATA := .data/pglite

.PHONY: help install dev start smoke test test-watch typecheck build \
        env-init env-check env-jwt db-migrate db-reset db-studio clean

help: ## Show this help
	@echo "OrbitHub API"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""

install: ## Install workspace dependencies
	$(NPM) install

dev: ## Start the API in watch mode
	$(ENV) dev

start: ## Start the API without watch
	$(ENV) start

smoke: ## Boot the API, check /health, then stop
	@$(NPM) run --silent --workspace @orbit-hub/api start > /tmp/orbit-hub-api.log 2>&1 & \
		api_pid=$$!; \
		trap "kill $$api_pid 2>/dev/null || true" EXIT; \
		for attempt in $$(seq 1 30); do \
			if curl -fsS http://127.0.0.1:$$(grep -oE 'PORT=[0-9]+' .env 2>/dev/null | cut -d= -f2 || echo 4000)/api/v1/health > /dev/null; then \
				echo "API is healthy"; exit 0; \
			fi; \
			sleep 1; \
		done; \
		echo "The API did not become healthy in 30s. Log:"; tail -30 /tmp/orbit-hub-api.log; exit 1

test: ## Run the test suite against an in-memory Postgres
	$(ENV) test

test-watch: ## Run the tests in watch mode
	$(ENV) test:watch

typecheck: ## Type check
	$(ENV) typecheck

build: ## Bundle the server for production
	$(ENV) build

env-init: ## Create .env from the example
	node ../../scripts/env.mjs init

env-check: ## Report which variables are missing (names only)
	node ../../scripts/env.mjs check

env-jwt: ## Generate a fresh JWT_SECRET
	node ../../scripts/env.mjs generate-jwt

db-migrate: ## Apply the committed migrations
	RUN_MIGRATIONS_ON_BOOT=false $(NPM) run --workspace @orbit-hub/api db:migrate

db-reset: ## Drop the local database and re-apply the migrations
	@echo "Removing $(DEV_DATA)"
	@rm -rf $(DEV_DATA)
	@$(MAKE) --no-print-directory db-migrate

db-studio: ## Open Drizzle Studio (needs a real DATABASE_URL)
	$(ENV) db:studio

clean: ## Remove build output and the local database
	@rm -rf dist .expo .data
