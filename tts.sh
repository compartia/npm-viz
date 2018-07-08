echo $1
./node_modules/.bin/tsc $1.ts
node $1.js