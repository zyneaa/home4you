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

MEDIA_WORKER_IMAGE ?= home4you-media-worker:local
build-media-worker: ## Build only Rust media-worker (heavy, run on 4GB+ VM)
	docker build -t $(MEDIA_WORKER_IMAGE) services/media-worker

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

COLIMA_CPU_BUILD ?= 4
COLIMA_MEMORY_BUILD ?= 4
COLIMA_CPU_RUN ?= 2
COLIMA_MEMORY_RUN ?= 2
COLIMA_DISK ?= 60

colima-build-run: ## Stop Colima, start 4GB, build all, stop, restart 2GB, start dev
	@echo "Stopping Colima..."
	colima stop || true
	@echo "Starting Colima with $(COLIMA_MEMORY_BUILD)GB for build..."
	colima start --cpu $(COLIMA_CPU_BUILD) --memory $(COLIMA_MEMORY_BUILD) --disk $(COLIMA_DISK)
	@echo "Building development images..."
	docker compose -f $(DEV_COMPOSE) build
	@echo "Stopping Colima..."
	colima stop
	@echo "Restarting Colima with $(COLIMA_MEMORY_RUN)GB to run..."
	colima start --cpu $(COLIMA_CPU_RUN) --memory $(COLIMA_MEMORY_RUN) --disk $(COLIMA_DISK)
	@echo "Starting development services..."
	docker compose -f $(DEV_COMPOSE) --env-file .env up -d
	@echo "Done. Follow logs with: make dev-logs"

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

CORE_SERVICE_DIR := ./services/core
core-lint:
	cd $(CORE_SERVICE_DIR) && npm run lint:fix

core-fmt:
	cd $(CORE_SERVICE_DIR) && npm run fmt

core-check:
	cd $(CORE_SERVICE_DIR) && npm run lint && npm run fmt:check

# ------------------------------
# Fake image generators (args: min_mb max_mb, e.g. make gen-good-images MIN=0.1 MAX=30)
# ------------------------------
MIN_MB ?= 0.1
MAX_MB ?= 5

gen-good-images: ## Generate fake images with valid magic bytes
	python3 scripts/generate_good_images.py $(MIN_MB) $(MAX_MB)

gen-bad-images: ## Generate corrupted/bad images
	python3 scripts/generate_bad_images.py $(MIN_MB) $(MAX_MB)

# ------------------------------
# Aliases
# ------------------------------
prod: build up logs

