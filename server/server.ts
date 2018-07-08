import * as http from 'http';
var cors = require('cors')

const PORT = process.env.PORT || 5000


import * as express from "express";
import * as bodyParser from "body-parser";
import { Request, Response } from "express";


export class Routes {
    public routes(app): void {
        app.route('/:pack/:ver')
            .get((req: Request, res: Response) => {

                var request = require('request');
                const url = 'https://registry.npmjs.org/' + req.params.pack + "/" + req.params.ver;
                console.log("querying " +url);
                request(url,
                    (error, response, body) => {
                        res.status(200).send(body);
                    });


            })
    }
}

export class App {

    // ref to Express instance
    public express: express.Application;


    public app: express.Application;
    public routePrv: Routes = new Routes();

    constructor() {
        this.app = express();



        this.config();
        this.routePrv.routes(this.app);
    }

    private config(): void {
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: false }));

        let _cors = cors({ credentials: false, origin: '*' });
        this.app.use(_cors)
    }
}

function onListening(): void {
    let addr = server.address();
    let bind = (typeof addr === 'string') ? `pipe ${addr}` : `port ${addr.port}`;
    console.log(`Listening on ${bind}`);
}

const server = http.createServer(new App().app);
server.listen(PORT);

server.on('listening', onListening);