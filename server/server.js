"use strict";
exports.__esModule = true;
var http = require("http");
var cors = require('cors');
var PORT = process.env.PORT || 5000;
var express = require("express");
var bodyParser = require("body-parser");
var Routes = /** @class */ (function () {
    function Routes() {
    }
    Routes.prototype.routes = function (app) {
        app.route('/:pack/:ver')
            .get(function (req, res) {
            var request = require('request');
            var url = 'https://registry.npmjs.org/' + req.params.pack + "/" + req.params.ver;
            console.log("querying " + url);
            request(url, function (error, response, body) {
                res.status(200).send(body);
            });
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
