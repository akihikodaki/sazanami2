all:
	mkdir -p dist
	npx webpack

production:
	mkdir -p dist
	npx webpack --mode production
	cp src/embed.sh dist/embed.sh
	cp src/launch_httpd.sh dist/launch_httpd.sh
	cp ./THIRD-PARTY-LICENSES.md dist/THIRD-PARTY-LICENSES.md
	cp ./README.md dist/README.md

serve:
	npx webpack serve --open

init:
	npm install
	npx license-checker --production --relativeLicensePath > THIRD-PARTY-LICENSES.md
	sed -i "s|$(shell pwd)/||g" THIRD-PARTY-LICENSES.md

clean:
	rm dist -f -r

docker-run:
	./docker/run.sh

docker-build:
	cd docker; make docker-build

pack: production
	rm -f sazanami2.zip
	cd dist; zip -r ../sazanami2.zip .

