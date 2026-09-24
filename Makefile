.DEFAULT_GOAL := help
COMPOSE := docker compose
# OpenMRS and DHIS2 take several minutes to initialise their databases on first start
WAIT_TIMEOUT := 3600
TOOLS := tools/node_modules/.installed

.PHONY: help env up start bootstrap deploy seed trigger report test e2e down reset ps logs

help: ## Show this help
	@grep -hE '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

$(TOOLS): tools/package.json tools/package-lock.json
	@cd tools && npm ci --no-audit --no-fund --silent
	@touch $@

env: ## Create .env with generated secrets (first run only)
	@node tools/env.js

up: start bootstrap ## Start every system, wait until healthy, and bootstrap them

start: env ## Start every system and wait until all are healthy
	$(COMPOSE) up -d --build --wait --wait-timeout $(WAIT_TIMEOUT)

bootstrap: $(TOOLS) ## Configure every system (idempotent)
	@node tools/bootstrap.js

deploy: $(TOOLS) ## Redeploy the workflow and reference data only
	@node tools/bootstrap.js deploy

seed: $(TOOLS) ## Add demo screenings to OpenMRS
	@node tools/seed.js

trigger: $(TOOLS) ## Run the workflow now and print its log
	@node tools/trigger.js

test: ## Unit tests for the workflow's logic (no sandbox needed)
	@node --test workflow/test/*.test.js

e2e: $(TOOLS) ## End-to-end test against the running sandbox
	@node tools/e2e.js

down: ## Stop everything (data is kept)
	$(COMPOSE) down

reset: ## Stop everything and delete all data
	$(COMPOSE) down -v --remove-orphans

ps: ## Show service status
	@$(COMPOSE) ps --format 'table {{.Service}}\t{{.Status}}'

logs: ## Follow logs, e.g. make logs s=openfn
	$(COMPOSE) logs -f --tail=100 $(s)
