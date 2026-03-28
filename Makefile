.PHONY: help build up down logs restart clean dev dev-up dev-down dev-logs dev-restart dev-clean test lint fmt install

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
NC := \033[0m # No Color

help:
	@echo "$(BLUE)Available commands:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

deploy: ## Pull latest images from GHCR and restart
	@echo "$(BLUE)Deploying latest images from GHCR...$(NC)"
	docker compose pull
	docker compose up -d --remove-orphans
	docker image prune -f

# Production commands
build:
	@echo "$(BLUE)Building production image...$(NC)"
	docker compose build

up:
	@echo "$(BLUE)Starting production services...$(NC)"
	docker compose up -d

down:
	@echo "$(BLUE)Stopping production services...$(NC)"
	docker compose down

logs:
	docker compose logs -f app

restart:
	@echo "$(BLUE)Restarting production services...$(NC)"
	docker compose restart

clean:
	@echo "$(YELLOW)Warning: This will remove all production data!$(NC)"
	docker compose down -v

# Development commands
dev-up:
	@echo "$(BLUE)Starting development services...$(NC)"
	docker compose -f docker-compose.dev.yml up --watch
	@echo "$(GREEN)Development services started!$(NC)"
	@echo "$(BLUE)View logs with: make dev-logs$(NC)"

dev-down:
	@echo "$(BLUE)Stopping development services...$(NC)"
	docker compose -f docker-compose.dev.yml down

dev-logs:
	docker compose -f docker-compose.dev.yml logs -f app

dev-restart:
	@echo "$(BLUE)Restarting development services...$(NC)"
	docker compose -f docker-compose.dev.yml restart app

dev-clean:
	@echo "$(YELLOW)Warning: This will remove all development data!$(NC)"
	docker compose -f docker-compose.dev.yml down -v

dev-build:
	@echo "$(BLUE)Building development image...$(NC)"
	docker compose -f docker-compose.dev.yml build

dev-shell:
	docker compose -f docker-compose.dev.yml exec app sh

# Code quality commands
test:
	npm test

test-cov:
	npm run test:cov

lint:
	@echo "$(BLUE)Running linter...$(NC)"
	npm run lint

lint-fix:
	@echo "$(BLUE)Fixing linting issues...$(NC)"
	npm run lint:fix

fmt:
	@echo "$(BLUE)Formatting code...$(NC)"
	npm run fmt

fmt-check:
	@echo "$(BLUE)Checking code formatting...$(NC)"
	npm run fmt:check

# Setup commands
install:
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install

# Database commands
db-shell:
	docker-compose exec mongo mongosh

db-shell-dev:
	docker-compose -f docker-compose.dev.yml exec mongo mongosh

redis-cli:
	docker-compose exec redis redis-cli

redis-cli-dev:
	docker-compose -f docker-compose.dev.yml exec redis redis-cli

# Utility commands
ps: ## Show running containers
	@echo "$(BLUE)Production containers:$(NC)"
	@docker-compose ps
	@echo "\n$(BLUE)Development containers:$(NC)"
	@docker-compose -f docker-compose.dev.yml ps

prune: ## Remove unused Docker resources
	@echo "$(YELLOW)Removing unused Docker resources...$(NC)"
	docker system prune -f

# Combined commands
setup: install ## Install dependencies and setup project
	@echo "$(GREEN)Setup complete!$(NC)"

dev: dev-up dev-logs ## Start development and follow logs (alias for dev-up + dev-logs)

prod: build up logs ## Build, start production and follow logs

