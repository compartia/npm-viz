echo $1
./node_modules/.bin/tsc -target ES5 $1.ts
node $1.js