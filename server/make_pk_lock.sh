mkdir -p ___temp
cd ___temp
curl http://registry.npmjs.org/is-primitive/2.0.0 > package.json
npm i --package-lock-only