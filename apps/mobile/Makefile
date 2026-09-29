# OrbitHub app (Expo, Android / iOS / Web)
#
#   make help        show every target
#   make web         start the web target
#   make ios         start the iOS simulator
#   make android     start an Android emulator
#   make device      start the dev server for a phone on the LAN (Expo Go)
#
# Native targets need the platform tooling: Xcode for iOS, Android Studio for
# Android. The web target needs nothing extra. The device target needs neither,
# but the phone and this machine must share a WiFi network.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM ?= npm
ENV := $(NPM) run --workspace @orbit-hub/mobile

# Forwarded to `expo start`, e.g. `make device DEVICE_ARGS=--tunnel`
DEVICE_ARGS ?=

.PHONY: help install ios android web start device device-tunnel device-url \
        prebuild-ios prebuild-android test typecheck export-web doctor \
        env-init env-distribute env-check clean

help: ## Show this help
	@echo "OrbitHub app"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Platform notes"
	@echo "    web      React Native Web, no extra tooling"
	@echo "    ios      needs Xcode and a simulator"
	@echo "    android  needs Android Studio and an emulator"
	@echo "    device   Expo Go on a real phone; same WiFi as this machine"
	@echo ""

install: ## Install workspace dependencies
	$(NPM) install

ios: ## Start the iOS simulator
	$(ENV) ios

android: ## Start an Android emulator
	$(ENV) android

web: ## Start the web target
	$(ENV) web

start: ## Start the dev server and pick the platform interactively
	$(ENV) start

device: ## Start the dev server for a phone on the LAN (Expo Go)
	@node ../../scripts/lan-ip.mjs exec $(ENV) device $(DEVICE_ARGS)

device-tunnel: ## Same as device, but through a public tunnel
	@$(MAKE) --no-print-directory device DEVICE_ARGS=--tunnel

device-url: ## Print the API URL a phone on the LAN should use
	@node ../../scripts/lan-ip.mjs api-url

prebuild-ios: ## Generate the native iOS project (continuous native generation)
	$(NPM) run --workspace @orbit-hub/mobile exec expo prebuild --platform ios

prebuild-android: ## Generate the native Android project
	$(NPM) run --workspace @orbit-hub/mobile exec expo prebuild --platform android

test: ## Run the app tests
	$(ENV) test

typecheck: ## Type check
	$(ENV) typecheck

export-web: ## Build the static web export
	$(ENV) export:web

doctor: ## Run expo-doctor
	$(ENV) doctor

env-init: ## Create .env from the example
	node ../../scripts/env.mjs init

env-distribute: ## Move root .env values into the files that own them
	node ../../scripts/env.mjs distribute

env-check: ## Report which variables are missing (names only)
	node ../../scripts/env.mjs check

clean: ## Remove build output and caches
	@rm -rf .expo dist node_modules/.cache
