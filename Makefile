.DEFAULT_GOAL := help
COMPOSE := docker compose
# OpenMRS and DHIS2 take several minutes to initialise their databases on first start
WAIT_TIMEOUT := 3600

.PHONY: help env up down reset ps logs

help: ## Show this help
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

env: ## Create .env with generated secrets (first run only)
	@node tools/env.js

up: env ## Start every system and wait until all are healthy
	$(COMPOSE) up -d --build --wait --wait-timeout $(WAIT_TIMEOUT)
	@$(COMPOSE) ps --format 'table {{.Service}}\t{{.Status}}'

down: ## Stop everything (data is kept)
	$(COMPOSE) down

reset: ## Stop everything and delete all data
	$(COMPOSE) down -v --remove-orphans

ps: ## Show service status
	@$(COMPOSE) ps --format 'table {{.Service}}\t{{.Status}}'

logs: ## Follow logs, e.g. make logs s=openfn
	$(COMPOSE) logs -f --tail=100 $(s)
