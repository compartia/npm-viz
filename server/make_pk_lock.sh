mkdir -p $3
cd $3
curl http://registry.npmjs.org/$1/$2 > package.json
npm i --package-lock-only