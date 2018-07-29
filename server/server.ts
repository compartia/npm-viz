import * as http from 'http';
var cors = require('cors')

const PORT = process.env.PORT || 5000


import * as express from "express";
import * as path from "path";
import * as bodyParser from "body-parser";
import { Request, Response } from "express";


import { exec } from 'child_process';
import { fs } from 'mz';

const REG_URL = 'https://registry.npmjs.org';
export class Routes {

    public routes(app:express.Application): void {

        app.use(express.static(path.join(__dirname, '../build')));


        app.route('/').get((req: Request, res: Response) => {
            res.sendFile(path.resolve(__dirname, '../build/index.html'));
        });

        app.route('/package/:pack/:ver')
            .get((req: Request, res: Response) => {

                var request = require('request');
                const url = `${REG_URL}/${req.params.pack}/${req.params.ver}`;
                console.debug(`querying ${url}`);
                request(url,
                    (error, response, body) => {
                        res.status(200).send(body);
                    });

            });

        app.route('/package-lock/:pack/:ver')
            .get((req: Request, res: Response) => {
                const tempDirName = `${__dirname}/public/packages/${req.params.pack}@${req.params.ver}`;


                const lockFile = `${tempDirName}/package-lock.json`
                if (fs.existsSync(lockFile)) {

                    let body: string = fs.readFileSync(lockFile).toString();
                    // fs.rmdirSync(`${tempDirName}`);
                    // console.log(body);
                    res.status(200).send(body);

                } else {


                    try {
                        console.log("mkdir" + tempDirName);
                        fs.mkdirSync(tempDirName);
                    } catch (e) {
                        console.error(e);
                    }

                    var ex = exec(`sh ${__dirname}/make_pk_lock.sh ${req.params.pack}  ${req.params.ver} ${tempDirName}`,
                        (error, stdout, stderr) => {
                            console.log(`${stdout}`);
                            console.log(`${stderr}`);
                            if (error !== null) {
                                console.error(`exec ERROR: ${error}`);
                            }

                            try {
                                let body: string = fs.readFileSync(lockFile).toString();
                                res.status(200).send(body);
                            } catch (e) {
                                res.status(200).send(e);
                            }

                            // fs.rmdirSync(`${tempDirName}`);
                            // console.log(body);

                        });
                }

            });
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