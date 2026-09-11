# ============================================================================
#  easy-workflow 一键启动
#
#  最常用：
#     make            启动前后端（等价于 make dev），Ctrl-C 一起停止
#     make check      跑全部自检（需要前后端都在运行）
#     make stop       停掉占用端口的进程
#     make help       查看全部命令
# ============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := dev

ROOT     := $(patsubst %/,%,$(dir $(realpath $(lastword $(MAKEFILE_LIST)))))
WEB      := $(ROOT)/web
LOG_DIR  := $(ROOT)/logs

# ------------------------------ 可覆盖配置 ----------------------------------
# 用法：make dev DB_HOST=192.168.1.10 DB_USER=root DB_PASS=secret
API_PORT ?= 8180
WEB_PORT ?= 5173

DB_HOST      ?= 127.0.0.1
DB_PORT      ?= 3306
DB_NAME      ?= easy_workflow
DB_USER      ?= goeasy
DB_PASS      ?= sNd%sLDjd*12
DB_ROOT_USER ?= root
DB_ROOT_PASS ?= 123456

# 已有 MySQL 容器时优先用容器内的客户端，省得依赖本机 mysql 命令
MYSQL_CONTAINER ?= mysql8

# ------------------------- 内部小工具（勿直接调用） -------------------------
#
# 这里定义两个 shell 函数供各 recipe 使用：
#     run_sql "SQL..."   执行 SQL
#     mysql_ready        探测 MySQL 是否就绪（只看退出码）
#
# 刻意不用 $(call ...)：Make 的 call 会把参数里的逗号当成参数分隔符，
# 而 SQL 里几乎一定有逗号（SELECT id,name ...），所以改成「先定义函数、
# 再把 SQL 作为 recipe 里的普通参数传入」，这样逗号不会被 Make 吃掉。
#
# 密码走 MYSQL_PWD 环境变量而不是 -p 参数，既避免 "Using a password ... insecure" 警告，
# 也不会让密码出现在 ps 的进程列表里。
define MYSQL_FUNCS
run_sql() { \
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx '$(MYSQL_CONTAINER)'; then \
    docker exec -i -e MYSQL_PWD='$(DB_ROOT_PASS)' $(MYSQL_CONTAINER) \
      mysql --default-character-set=utf8mb4 -u$(DB_ROOT_USER) -e "$$1"; \
  else \
    MYSQL_PWD='$(DB_ROOT_PASS)' mysql --default-character-set=utf8mb4 \
      -h$(DB_HOST) -P$(DB_PORT) -u$(DB_ROOT_USER) -e "$$1"; \
  fi; \
}; \
mysql_ready() { \
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx '$(MYSQL_CONTAINER)'; then \
    docker exec -e MYSQL_PWD='$(DB_ROOT_PASS)' $(MYSQL_CONTAINER) \
      mysqladmin ping -u$(DB_ROOT_USER) --silent >/dev/null 2>&1; \
  else \
    MYSQL_PWD='$(DB_ROOT_PASS)' mysqladmin -h$(DB_HOST) -P$(DB_PORT) \
      -u$(DB_ROOT_USER) ping --silent >/dev/null 2>&1; \
  fi; \
}
endef

# ------------------------------- 启动相关 ----------------------------------

.PHONY: dev
dev: preflight ## 一键启动前后端（Ctrl-C 同时停止）【默认】
	@mkdir -p $(LOG_DIR)
	@echo ""
	@echo "  后端  http://localhost:$(API_PORT)      日志 logs/backend.log"
	@echo "  前端  http://localhost:$(WEB_PORT)      日志 logs/frontend.log"
	@echo ""
	@echo "  浏览器打开 http://localhost:$(WEB_PORT)（别用 127.0.0.1，dev server 只绑了 IPv6 回环）"
	@echo "  按 Ctrl-C 同时停止前后端"
	@echo ""
	@set -m; \
	( $(MAKE) --no-print-directory _backend  2>&1 | tee $(LOG_DIR)/backend.log  | sed -e 's/^/[后端] /' ) & BPID=$$!; \
	( $(MAKE) --no-print-directory _frontend 2>&1 | tee $(LOG_DIR)/frontend.log | sed -e 's/^/[前端] /' ) & FPID=$$!; \
	trap 'echo ""; echo "正在停止前后端..."; \
	      kill -TERM -$$BPID -$$FPID 2>/dev/null; kill -TERM $$BPID $$FPID 2>/dev/null; \
	      wait 2>/dev/null; sleep 1; \
	      kill -KILL -$$BPID -$$FPID 2>/dev/null; \
	      echo "已停止。"; exit 0' INT TERM; \
	wait

.PHONY: _backend
_backend:
	@cd $(ROOT) && \
	 EASY_WORKFLOW_DB_HOST=$(DB_HOST):$(DB_PORT) \
	 EASY_WORKFLOW_DB_USER='$(DB_USER)' \
	 EASY_WORKFLOW_DB_PASS='$(DB_PASS)' \
	 EASY_WORKFLOW_DB_NAME='$(DB_NAME)' \
	 EASY_WORKFLOW_API_ADDR=:$(API_PORT) \
	 go run example/main.go

.PHONY: _frontend
_frontend:
	@cd $(WEB) && \
	 if [ ! -d node_modules ]; then echo "首次运行，正在安装前端依赖..."; npm install; fi; \
	 VITE_PROXY_TARGET=http://127.0.0.1:$(API_PORT) npm run dev

.PHONY: backend
backend: ## 只启动 Go 后端（:8180）
	@$(MAKE) --no-print-directory _backend

.PHONY: frontend
frontend: ## 只启动前端（:5173，需后端已在跑）
	@$(MAKE) --no-print-directory _frontend

.PHONY: preflight
preflight: ## 启动前检查端口与数据库
	@fail=0; \
	for p in $(API_PORT) $(WEB_PORT); do \
	  if lsof -nP -iTCP:$$p -sTCP:LISTEN >/dev/null 2>&1; then \
	    echo "  ✗ 端口 $$p 已被占用，先执行：make stop"; \
	    fail=1; \
	  fi; \
	done; \
	if [ $$fail -ne 0 ]; then exit 1; fi; \
	$(MYSQL_FUNCS); \
	if mysql_ready; then \
	  echo "  ✓ 端口空闲，MySQL 就绪"; \
	else \
	  echo "  ! 连不上 MySQL（$(DB_HOST):$(DB_PORT)）"; \
	  echo "    先执行 make db-up 启动数据库容器，或 make db-reset 重建库"; \
	  echo "    连接信息不同请覆盖变量，例如：make dev DB_HOST=192.168.1.10 DB_USER=root DB_PASS=secret"; \
	fi

# ------------------------------- 验证相关 ----------------------------------

.PHONY: check
check: ## 跑全部自检（25+29+32 项，需要前后端都在运行）
	@cd $(WEB) && npm run check:convert
	@cd $(WEB) && npm run check:e2e
	@cd $(WEB) && npm run check:engine
	@echo ""
	@echo "  ✓ 全部自检完成"

.PHONY: check-convert
check-convert: ## 只跑纯前端转换自检（不需要后端）
	@cd $(WEB) && npm run check:convert

.PHONY: check-e2e
check-e2e: ## 只跑前后端联调自检
	@cd $(WEB) && npm run check:e2e

.PHONY: check-engine
check-engine: ## 只跑引擎流程语义自检
	@cd $(WEB) && npm run check:engine

# ------------------------------- 构建相关 ----------------------------------

.PHONY: build
build: ## 编译后端二进制 + 构建前端产物
	@cd $(ROOT) && go build -o $(ROOT)/easy-workflow ./example/
	@echo "  ✓ 后端二进制：easy-workflow"
	@cd $(WEB) && npm run build
	@echo "  ✓ 前端产物：web/dist"

.PHONY: typecheck
typecheck: ## 前端类型检查
	@cd $(WEB) && npm run typecheck
	@echo "  ✓ 类型检查通过"

.PHONY: setup
setup: ## 安装前后端依赖
	@cd $(ROOT) && go mod download
	@cd $(WEB) && npm install
	@echo "  ✓ 依赖安装完成"

# ------------------------------- 数据库相关 --------------------------------

.PHONY: db-up
db-up: ## 启动 MySQL（没有容器就创建）
	@if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx '$(MYSQL_CONTAINER)'; then \
	  echo "  ✓ 容器 $(MYSQL_CONTAINER) 已在运行"; \
	elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx '$(MYSQL_CONTAINER)'; then \
	  echo "  启动已存在的容器 $(MYSQL_CONTAINER)..."; docker start $(MYSQL_CONTAINER) >/dev/null; \
	else \
	  echo "  创建容器 $(MYSQL_CONTAINER)..."; \
	  docker run -d --name $(MYSQL_CONTAINER) \
	    -e MYSQL_ROOT_PASSWORD='$(DB_ROOT_PASS)' \
	    -e MYSQL_DATABASE='$(DB_NAME)' \
	    -e MYSQL_USER='$(DB_USER)' \
	    -e MYSQL_PASSWORD='$(DB_PASS)' \
	    -p $(DB_PORT):3306 mysql:8.0 \
	    --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci >/dev/null; \
	fi
	@$(MYSQL_FUNCS); \
	printf "  等待 MySQL 就绪"; \
	for i in $$(seq 1 60); do \
	  if mysql_ready; then echo " ✓"; exit 0; fi; \
	  printf "."; sleep 1; \
	done; \
	echo " ✗ 超时"; exit 1

.PHONY: db-reset
db-reset: ## 重建数据库（清空所有流程与实例数据）
	@$(MYSQL_FUNCS); \
	echo "  重建数据库 $(DB_NAME)..."; \
	run_sql "DROP DATABASE IF EXISTS \`$(DB_NAME)\`; \
	         CREATE DATABASE \`$(DB_NAME)\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; \
	         CREATE USER IF NOT EXISTS '$(DB_USER)'@'%' IDENTIFIED BY '$(DB_PASS)'; \
	         GRANT ALL PRIVILEGES ON \`$(DB_NAME)\`.* TO '$(DB_USER)'@'%'; \
	         FLUSH PRIVILEGES;"
	@echo "  ✓ 已重建（后端下次启动会自动建表并播种示例流程「员工请假」）"

.PHONY: db-tables
db-tables: ## 查看已自动创建的表和流程定义
	@$(MYSQL_FUNCS); \
	run_sql "SELECT COUNT(*) AS tables_in_db FROM information_schema.tables WHERE table_schema='$(DB_NAME)';"; \
	if run_sql "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema='$(DB_NAME)' AND table_name='proc_def';" | grep -q 1; then \
	  run_sql "SELECT id,name,version FROM \`$(DB_NAME)\`.proc_def ORDER BY id;"; \
	else \
	  echo "  （表还没建 —— 后端首次启动时会自动建表并播种示例流程「员工请假」）"; \
	fi

# ------------------------------- 运维相关 ----------------------------------

.PHONY: stop
stop: ## 停掉占用 8180 / 5173 的进程
	@for p in $(API_PORT) $(WEB_PORT); do \
	  pids=$$(lsof -nP -iTCP:$$p -sTCP:LISTEN -t 2>/dev/null); \
	  if [ -n "$$pids" ]; then echo "  停止端口 $$p 上的进程：$$pids"; kill $$pids 2>/dev/null; \
	  else echo "  端口 $$p 本来就空闲"; fi; \
	done
	@sleep 1; \
	for p in $(API_PORT) $(WEB_PORT); do \
	  pids=$$(lsof -nP -iTCP:$$p -sTCP:LISTEN -t 2>/dev/null); \
	  if [ -n "$$pids" ]; then kill -9 $$pids 2>/dev/null; echo "  强制结束端口 $$p：$$pids"; fi; \
	done
	@echo "  ✓ 已停止"

.PHONY: status
status: ## 查看前后端与数据库运行状态
	@printf "  后端 :$(API_PORT)   "; \
	if lsof -nP -iTCP:$(API_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
	  code=$$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$(API_PORT)/process/def/list?source=" 2>/dev/null); \
	  echo "运行中（HTTP $${code}）"; \
	else echo "未运行"; fi
	@printf "  前端 :$(WEB_PORT)   "; \
	if lsof -nP -iTCP:$(WEB_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
	  code=$$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://localhost:$(WEB_PORT)/" 2>/dev/null); \
	  echo "运行中（HTTP $${code}）  →  http://localhost:$(WEB_PORT)"; \
	else echo "未运行"; fi
	@$(MYSQL_FUNCS); \
	printf "  MySQL              "; \
	if mysql_ready; then echo "就绪（$(DB_HOST):$(DB_PORT)/$(DB_NAME)）"; else echo "不可用"; fi

.PHONY: clean
clean: ## 清理构建产物与日志
	@rm -rf $(LOG_DIR) $(WEB)/dist $(ROOT)/easy-workflow
	@echo "  ✓ 已清理 logs/、web/dist、easy-workflow 二进制"

# -------------------------------- 帮助 -------------------------------------

.PHONY: help
help: ## 显示本帮助
	@echo ""
	@echo "easy-workflow 一键启动"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "可覆盖变量：API_PORT WEB_PORT DB_HOST DB_PORT DB_NAME DB_USER DB_PASS"
	@echo ""
