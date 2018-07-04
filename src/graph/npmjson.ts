import { GraphDef, FunctionDefLibraryDef, VersionDef, NodeDef } from "./tf_graph_common/proto";

import * as _ from 'lodash';
import * as chunks from './chunks';

export interface PackageLockDependency {
    version: string;
    resolved: string;
    integrity: string;
    dev: boolean,


    dependencies: { [key: string]: PackageLockDependency; };
    requires: { [key: string]: string; };
}

export interface PackageLock {
    name: string;
    version: string;
    dependencies: { [key: string]: PackageLockDependency; };
}

interface Link {
    target: NodeDefExt;
    control: boolean;
}

export class NodeDefExt implements NodeDef {
    name: string;
    /** List of nodes that are inputs for this node. */
    private _input: Link[] = [];
    private _output: Link[] = [];
    /** The name of the device where the computation will run. */
    device: string;
    /** The name of the operation associated with this node. */
    op: string;
    /** List of attributes that describe/modify the operation. */
    // attr:{ key: string; value: any; }[]; 

    nodeAttributes: { [key: string]: any; };


    static nodeName(libName: string, libVersion: string) {
        let n = libName;//this.escape(libName);
        let v = libVersion;//this.escape(libVersion);
        return n + "-" + v;
    }


    constructor(key: string, dep: PackageLockDependency) {

        let n = this;
        this.name = NodeDefExt.nodeName(key, dep.version);

        this.device = (dep.dev ? "develoment" : "runtime");
        this.dev = dep.dev;

        this.version = dep.version;
        this.package = key;
        this.nodeAttributes = { 'label': key + " " + dep.version };
        this.op = "OP";


        (n as any).requires = dep.requires;
    }


    version: string;
    package: string;
    dev: boolean;

    get output(): string[] {
        return this._output.map(x => x.target.name)
    }

    get input(): string[] {
        console.log("request for inputs");
        return this._input.map(x => x.target.name);

        // return this._input.map(x => x.control? '^'+ x.target.name: x.target.name);
    }

    public link(other: NodeDefExt, control: boolean) {
        this._input.push({
            target: other,
            control: control
        });
        other._output.push({
            target: this,
            control: control
        });
    }
}

///////////////////////
export class PackageLockGraph implements GraphDef {
    node: NodeDefExt[] = [];

    // Compatibility versions of the graph.
    versions: VersionDef[];

    // Contains a library of functions that may composed through the graph.
    library: FunctionDefLibraryDef;


    constructor(json: PackageLock) {
        let root = null//this.getOrCreateNode("ROOOOOT", <PackageLockDependency> {version:json.version})
        // root.device="ROOT";
        this.iterateDeps(root, json.dependencies, 1);
        this.linkRequiremens();

        this.renameNodes();
    }

    private nodeByKey: { [key: string]: NodeDefExt; } = {};

    private iterateDeps(parent: NodeDefExt, deps: { [key: string]: PackageLockDependency; }, depth: number) {
        Object.keys(deps).forEach(key => {
            let dep = deps[key];
            let nn = this.getOrCreateNode(key, dep);

            if (parent) {
                nn.link(parent, dep.dev);
            }




            if (dep.dependencies) {
                this.iterateDeps(nn, dep.dependencies, depth + 1);
            }
        });
    }

    private linkRequiremens() {
        this.node.forEach((x) => {

            let req = (x as any).requires;
            if (req) {
                Object.keys(req).forEach(requredName => {
                    let version: string = req[requredName];



                    let linkedName = NodeDefExt.nodeName(requredName, version);
                    let linkedNode = this.nodeByKey[linkedName];

                    if (!linkedNode) {

                        let state = "missing";
                        if (version[0] === '^') {
                            state = "up";
                        }
                        if (version[0] === '~') {
                            state = "tilda";
                        }

                        linkedNode = this.getOrCreateNode(requredName, <PackageLockDependency>{ version: req[requredName] });
                        linkedNode.device = state;

                        // console.error("cannot find node for name " + linkedName);
                        // console.error("available nodes  " + Object.keys(this.nodeByKey));
                    }
                    linkedNode.link(x, x.dev);

                });
            }
        });
    }





    private getOrCreateNode(key: string, dep: PackageLockDependency): NodeDefExt {

        const nodeName = NodeDefExt.nodeName(key, dep.version);

        if (this.nodeByKey[nodeName]) {
            return this.nodeByKey[nodeName];
        } else {
            let n: NodeDefExt = new NodeDefExt(key, dep);
            this.nodeByKey[nodeName] = n;
            this.node.push(n);
            return n;
        }
    }





    static DELIMITERS = '-_.';





    private applyRenamingMap(renamingMap: { [key: string]: string; }) {
        let newName;
        this.nodeByKey = {};
        this.node.forEach(x => {
            newName = renamingMap[x.name];
            if (newName) {
                x.name = renamingMap[x.name];
            }
            this.nodeByKey[x.name] = x;
        });


    }

    // private buildSemanticStats(): { [key: string]: number } {
    //     /**
    //      * making groups
    //      */
    //     let stats = {};
    //     this.node.forEach(x => {
    //         let words = chunks.allSplits(x.package, '.-_ /@$');
    //         chunks.countWords(words, stats);
    //     })

    //     let pairszFiltered = _.toPairs(stats).filter(x => x[1] > 2 && x[0].length > 1);
    //     stats = _.fromPairs(pairszFiltered);
    //     console.log(stats);
    //     return stats;
    // }

    // private findBestGroup(groups: { [key: string]: number }, childGroup: string, delim: string): string | null {
    //     let splits = chunks.allSplits(childGroup, delim);
    //     splits.push(childGroup);
    //     let best = null;
    //     let max = 0;
    //     for (const ch of splits) {
    //         if (groups[ch]) {
    //             let val = ch.length * groups[ch];
    //             if (val > max) {
    //                 max = val;
    //                 best = ch;
    //             }
    //         }
    //     }
    //     return best;
    // }

    private renameNodes(): void {
        const renamingMap: { [key: string]: string; } = {};
        // const groups = this.buildSemanticStats();
        //        const paths = {};
        const root = {};

        const SPLIT = /\.|-|#|_/;
        this.node.forEach(x => {
            const path = x.package.split(SPLIT);//.join("/");

            let leaf: any = root;
            for (const chunk of path) {
                if (leaf[chunk]) {
                    leaf[chunk].count++;
                } else {
                    leaf[chunk] = {};
                    leaf[chunk].count = 1;
                }
                leaf = leaf[chunk];
            }

        });

        console.log(root);

        const findLeaf = (path: string[]) => {
            let joined: string[] = [];
            let leaf: any = root;
            for (const chunk of path) {

                if (leaf[chunk] && leaf[chunk].count > 1) {
                    joined.push(chunk);

                    leaf = leaf[chunk];
                } else {
                    return joined;
                }
            }
            return joined;
        }

        this.node.forEach(x => {
            // let originalGroups = x.package.split("/");
            // let childGroup = originalGroups.pop();
            // let additionalGroup =  this.findBestGroup(groups, childGroup, ".-_");
            // if (additionalGroup) {
            //     originalGroups.push(additionalGroup);
            //     // originalGroups= [additionalGroup].concat(originalGroups);
            // }
            // originalGroups.push(childGroup);
            // let newName = originalGroups.join("/");
            // renamingMap[x.name] = this.escape(newName + "-" + x.version);
            let newName = x.package;
            const path: string[] = newName.split(SPLIT);//.join("/");
            let bestDir = findLeaf(path);
            if (bestDir && bestDir.length > 0) {
                newName = bestDir.join("/") + "/" + x.package;
            }
            renamingMap[x.name] = this.escape(newName) + "_" + this.escapeVersion(x.version);

        });
        console.log(renamingMap);
        this.applyRenamingMap(renamingMap);
    }


    private escapeVersion(key: string): string {
        return key.split(/\W/).join("_");
    }
    private escape(key: string): string {
        let k = key.split(/\.|-|\#|_|@|^/).join("_");
        // k = k.split("@").join("_");
        // k = k.split("#").join("_");
        // k = k.split("^").join("_");
        // k = k.split(".").join("_");
        // k = k.split("-").join("_");

        return k;
    }
}