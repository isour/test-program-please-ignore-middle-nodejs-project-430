.PHONY: install build start lint contract

install:
	npm ci

build:
	rm -rf public/assets public/index.html
	mkdir -p public
	cp -R node_modules/@hexlet/js-flight-booking-frontend/dist/. public/

start:
	PORT=$${PORT:-8080} npm start

lint:
	npm run lint

contract:
	npx tsp compile contract
