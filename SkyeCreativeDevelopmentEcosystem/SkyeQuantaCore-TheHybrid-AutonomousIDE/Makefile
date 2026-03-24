ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: bootstrap start dev doctor shell-bootstrap shell-start shell-doctor bridge-start ide-install ide-start ide-build agent-backend agent-deps doctor-branding doctor-self-contained setup-system setup-poetry

bootstrap:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/bootstrap.mjs

start:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/launch.mjs

dev:
	SKYEQUANTA_DEV=1 node $(ROOT_DIR)apps/skyequanta-shell/bin/launch.mjs

doctor:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/doctor.mjs
	bash $(ROOT_DIR)scripts/check-self-contained.sh
	bash $(ROOT_DIR)scripts/check-vendor-branding.sh

shell-bootstrap:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/bootstrap.mjs

shell-start:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/launch.mjs

bridge-start:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/bridge.mjs

shell-doctor:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/doctor.mjs

ide-install:
	cd $(ROOT_DIR)platform/ide-core && npm install

ide-start:
	cd $(ROOT_DIR)platform/ide-core/examples/browser && npm run start

ide-build:
	cd $(ROOT_DIR)platform/ide-core && npm run build

agent-backend:
	node $(ROOT_DIR)apps/skyequanta-shell/bin/launch.mjs --agent-only

agent-deps:
	cd $(ROOT_DIR)platform/agent-core && make install-python-dependencies

setup-system:
	bash $(ROOT_DIR)scripts/setup-ubuntu-deps.sh

setup-poetry:
	bash $(ROOT_DIR)scripts/install-poetry.sh

smoke-start:
	bash $(ROOT_DIR)scripts/smoke-startup.sh

doctor-branding:
	bash $(ROOT_DIR)scripts/check-vendor-branding.sh

doctor-self-contained:
	bash $(ROOT_DIR)scripts/check-self-contained.sh