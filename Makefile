# root-level Makefile

COMPOSE_DIR := infrastructure/docker
PROD_COMPOSE := $(COMPOSE_DIR)/docker-compose.yml
DEV_COMPOSE  := $(COMPOSE_DIR)/docker-compose.dev.yml

# ------------------------------
# Production commands
# ------------------------------
build: ## Build production images
	@echo "Building production images..."
	docker compose -f $(PROD_COMPOSE) build

up: ## Start production services
	@echo "Starting production services..."
	docker compose -f $(PROD_COMPOSE) --env-file .env up -d

up-logs: ## Start production services to debug(don't actually use it in prod)
	@echo "Starting production services with logging(use for debugging prod server)..."
	docker compose -f $(PROD_COMPOSE) --env-file .env up

down: ## Stop production services
	@echo "Stopping production services..."
	docker compose -f $(PROD_COMPOSE) down

logs: ## Follow production logs
	docker compose -f $(PROD_COMPOSE) logs -f core

restart: ## Restart production services
	@echo "Restarting production services..."
	docker compose -f $(PROD_COMPOSE) restart

clean: ## Remove production containers and volumes
	@echo "Cleaning production containers..."
	docker compose -f $(PROD_COMPOSE) down -v

deploy: ## Pull latest images + restart
	@echo "Deploying latest images..."
	docker compose -f $(PROD_COMPOSE) pull
	docker compose -f $(PROD_COMPOSE) up -d --remove-orphans
	docker image prune -f

# ------------------------------
# Development commands
# ------------------------------
dev-up: ## Start development services
	@echo "Starting development services..."
	docker compose -f $(DEV_COMPOSE) --env-file .env up --watch

dev-down: ## Stop development services
	@echo "Stopping development services..."
	docker compose -f $(DEV_COMPOSE) down

dev-logs: ## Follow development logs
	docker compose -f $(DEV_COMPOSE) logs -f core

dev-restart: ## Restart development services
	@echo "Restarting development services..."
	docker compose -f $(DEV_COMPOSE) restart core

dev-clean: ## Remove development containers and volumes
	@echo "Cleaning development containers..."
	docker compose -f $(DEV_COMPOSE) down -v

dev-build: ## Build development images
	@echo "Building development images..."
	docker compose -f $(DEV_COMPOSE) build

dev-shell: ## Open shell in dev container
	docker compose -f $(DEV_COMPOSE) exec core sh

dev: dev-up dev-logs ## alias: start dev + follow logs

# ------------------------------
# Database / Redis
# ------------------------------
db-shell:
	docker compose -f $(PROD_COMPOSE) exec mongo mongosh

db-shell-dev:
	docker compose -f $(DEV_COMPOSE) exec mongo mongosh

redis-cli:
	docker compose -f $(PROD_COMPOSE) exec redis redis-cli

redis-cli-dev:
	docker compose -f $(DEV_COMPOSE) exec redis redis-cli

# ------------------------------
# Utilities
# ------------------------------
ps:
	@echo "Production containers:"
	docker compose -f $(PROD_COMPOSE) ps
	@echo "\nDevelopment containers:"
	docker compose -f $(DEV_COMPOSE) ps

prune:
	@echo "Pruning Docker resources..."
	docker system prune -f

setup: install
	@echo "Setup complete"

# ------------------------------
# Code commands
# ------------------------------
install:
	npm install

test:
	npm test

test-cov:
	npm run test:cov

lint:
	npm run lint

lint-fix:
	npm run lint:fix

fmt:
	npm run fmt

fmt-check:
	npm run fmt:check

# ------------------------------
# Aliases
# ------------------------------
prod: build up logs

