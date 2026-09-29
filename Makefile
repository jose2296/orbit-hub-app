# OrbitHub monorepo
#
#   make help
#   make api      run the API with watch
#   make web      run the app on the web
#   make device   run the app on a phone over the LAN, with the API
#   make test     run every test suite
#   make check    typecheck + tests + Expo config

.DEFAULT_GOAL := help

.PHONY: help install api api-test api-db-reset ios android web device \
        device-tunnel device-url check test typecheck doctor env-list env-init \
        env-check env-jwt env-import-legacy clean

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

# Starts the API in its own process group, waits for it to answer, then hands
# the terminal to Metro. The trap takes the API down again on ^C.
device: ## Run the app on a real phone over the LAN, with the API
	@set -m; \
	$(MAKE) --no-print-directory -C apps/api dev & api_pid=$$!; \
	trap 'kill -TERM -- -$$api_pid 2>/dev/null || true; sleep 1; \
	      kill -KILL -- -$$api_pid 2>/dev/null || true' EXIT INT TERM; \
	api_url="$$(node scripts/lan-ip.mjs api-url)"; \
	printf 'Waiting for %s/health ... ' "$$api_url"; \
	ready=0; \
	for attempt in $$(seq 1 30); do \
		if curl -fsS "$$api_url/health" > /dev/null 2>&1; then ready=1; break; fi; \
		sleep 1; \
	done; \
	if [ $$ready -eq 1 ]; then echo "ready."; else echo "no answer, starting anyway."; fi; \
	$(MAKE) --no-print-directory -C apps/mobile device

device-tunnel: ## Run the app on a real phone through a public tunnel
	@$(MAKE) --no-print-directory -C apps/mobile device-tunnel

device-url: ## Print the API URL a phone on the LAN should use
	@node scripts/lan-ip.mjs api-url

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

env-distribute: ## Move root .env values into the files that own them
	node scripts/env.mjs distribute

env-check: ## Report missing environment variables
	node scripts/env.mjs check

env-jwt: ## Generate a fresh JWT_SECRET
	node scripts/env.mjs generate-jwt

env-import-legacy: ## Copy the reusable keys from the legacy projects
	node scripts/env.mjs import-legacy

clean: ## Remove build output and caches
	$(MAKE) -C apps/api clean
	$(MAKE) -C apps/mobile clean
