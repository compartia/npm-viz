"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var http = require("http");
var cors = require('cors');
var PORT = process.env.PORT || 5000;
var express = require("express");
var path = require("path");
var bodyParser = require("body-parser");
var child_process_1 = require("child_process");
var mz_1 = require("mz");
var REG_URL = 'https://registry.npmjs.org';
var Routes = /** @class */ (function () {
    function Routes() {
    }
    Routes.prototype.routes = function (app) {
        app.use(express.static(path.join(__dirname, '../build')));
        app.route('/').get(function (req, res) {
            res.sendFile(path.resolve(__dirname, '../build/index.html'));
        });
        app.route('/package/:pack/:ver')
            .get(function (req, res) {
            var request = require('request');
            var url = REG_URL + "/" + req.params.pack + "/" + req.params.ver;
            console.debug("querying " + url);
            request(url, function (error, response, body) {
                res.status(200).send(body);
            });
        });
        app.route('/package-lock/:pack/:ver')
            .get(function (req, res) {
            var tempDirName = __dirname + "/public/packages/" + req.params.pack + "@" + req.params.ver;
            var lockFile = tempDirName + "/package-lock.json";
            if (mz_1.fs.existsSync(lockFile)) {
                var body = mz_1.fs.readFileSync(lockFile).toString();
                // fs.rmdirSync(`${tempDirName}`);
                // console.log(body);
                res.status(200).send(body);
            }
            else {
                try {
                    console.log("mkdir" + tempDirName);
                    mz_1.fs.mkdirSync(tempDirName);
                }
                catch (e) {
                    console.error(e);
                }
                var ex = child_process_1.exec("sh " + __dirname + "/make_pk_lock.sh " + req.params.pack + "  " + req.params.ver + " " + tempDirName, function (error, stdout, stderr) {
                    console.log("" + stdout);
                    console.log("" + stderr);
                    if (error !== null) {
                        console.error("exec ERROR: " + error);
                    }
                    try {
                        var body = mz_1.fs.readFileSync(lockFile).toString();
                        res.status(200).send(body);
                    }
                    catch (e) {
                        res.status(200).send(e);
                    }
                    // fs.rmdirSync(`${tempDirName}`);
                    // console.log(body);
                });
            }
        });
    };
    return Routes;
}());
exports.Routes = Routes;
var App = /** @class */ (function () {
    function App() {
        this.routePrv = new Routes();
        this.app = express();
        this.config();
        this.routePrv.routes(this.app);
    }
    App.prototype.config = function () {
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: false }));
        var _cors = cors({ credentials: false, origin: '*' });
        this.app.use(_cors);
    };
    return App;
}());
exports.App = App;
function onListening() {
    var addr = server.address();
    var bind = (typeof addr === 'string') ? "pipe " + addr : "port " + addr.port;
    console.log("Listening on " + bind);
}
var server = http.createServer(new App().app);
server.listen(PORT);
server.on('listening', onListening);
