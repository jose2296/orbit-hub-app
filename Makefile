# OrbitHub monorepo
#
#   make help
#   make api      run the API with watch
#   make web      run the app on the web
#   make test     run every test suite
#   make check    typecheck + tests + Expo config

.DEFAULT_GOAL := help

.PHONY: help install api api-test api-db-reset ios android web check test typecheck \
        doctor env-list env-init env-check env-jwt env-import-legacy clean

help: ## Show this help
	@echo "OrbitHub"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  The api and app Makefiles have their own help:"
	@echo "    make -C apps/api help"
	@echo "    make -C apps/mobile help"
	@echo ""

install: ## Install workspace dependencies
	npm install

api: ## Run the API with watch
	$(MAKE) -C apps/api dev

api-test: ## Run the API tests
	$(MAKE) -C apps/api test

api-db-reset: ## Wipe the local database and re-apply the migrations
	$(MAKE) -C apps/api db-reset

ios: ## Run the app on the iOS simulator
	$(MAKE) -C apps/mobile ios

android: ## Run the app on an Android emulator
	$(MAKE) -C apps/mobile android

web: ## Run the app on the web
	$(MAKE) -C apps/mobile web

check: ## Typecheck, tests and Expo config
	npm run check

test: ## Run every test suite
	npm run test

typecheck: ## Type check every workspace
	npm run typecheck

doctor: ## Run expo-doctor
	$(MAKE) -C apps/mobile doctor

env-list: ## Print the inventory of environment variables
	node scripts/env.mjs list

env-init: ## Create the local .env files
	node scripts/env.mjs init

env-check: ## Report missing environment variables
	node scripts/env.mjs check

env-jwt: ## Generate a fresh JWT_SECRET
	node scripts/env.mjs generate-jwt

env-import-legacy: ## Copy the reusable keys from the legacy projects
	node scripts/env.mjs import-legacy

clean: ## Remove build output and caches
	$(MAKE) -C apps/api clean
	$(MAKE) -C apps/mobile clean
