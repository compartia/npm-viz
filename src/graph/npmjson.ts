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

const RES = {
    UNRESOLVED: "range",
    UNRESOLVED_MIDDLE: "tilda",
    UNRESOLVED_MAJOR: "caret",
    RESOLVED: "res"
}

export class NodeDefExt implements NodeDef {

    static UNRESOLVED = "range";
    static UNRESOLVED_MIDDLE = "tilda";
    static UNRESOLVED_MAJOR = "caret";


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
    resolved: boolean = true;

    public isUnresolved() {
        return this.resolved;
    }

    static nodeName(libName: string, libVersion: string) {
        let n = libName;//this.escape(libName);
        let v = libVersion;//this.escape(libVersion);
        return n + "-" + v;
    }


    constructor(packageName: string, dep: PackageLockDependency) {

        let n = this;
        this.name = NodeDefExt.nodeName(packageName, dep.version);

        this.device = (dep.dev ? "develoment" : "runtime");
        this.dev = dep.dev;

        this.version = dep.version;
        this.package = packageName;
        this.nodeAttributes = { 'label': packageName + " " + dep.version };
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
        // return this._input.map(x => x.target.name);

        return this._input.map(x => x.control ? '^' + x.target.name : x.target.name);
    }

    public link(other: NodeDefExt, control: boolean) {
        // let contains =false;
        for(const l of this._input){
            if(l.target===other){
                return l;
            }
        }
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

    //index for faster access
    private nodeByKey: { [key: string]: NodeDefExt; } = {};

    constructor(json: PackageLock) {
        let root = null;//this.getOrCreateNode("ROOOOOT", <PackageLockDependency> {version:json.version})
        // root.device="ROOT";
        this.linkDependentPackages(root, json.dependencies, 1);
        this.linkRequiremens();
        this.linkUnresolved();
        this.renameNodes();
    }

    private linkUnresolved() {
        for (const n of this.node) {
            let versions = this._nodesByPackageName[n.package];

            let resolved: NodeDefExt[] = [];
            let unresolved: NodeDefExt[] = [];
            for (const version in versions) {
                let instance = versions[version];
                if (instance.isUnresolved()) {
                    unresolved.push(instance);
                } else {
                    resolved.push(instance);
                }

            }

            for (let u of unresolved) {
                for (let r of resolved) {
                    u.link(r, true);
                }
            }
        }
    }


    private linkDependentPackages(parent: NodeDefExt, deps: { [key: string]: PackageLockDependency; }, depth: number) {
        Object.keys(deps).forEach(packageName => {
            let dep = deps[packageName];
            let graphNode = this.getOrCreateNode(packageName, dep);

            if (parent) {
                graphNode.link(parent, false/* dep.dev*/);
            }


            if (dep.dependencies) {
                this.linkDependentPackages(graphNode, dep.dependencies, depth + 1);
            }
        });
    }

    /**
     * multiple versions by library name
     */
    private _nodesByPackageName: { [key: string]: {} } = {};
    private indexPackageVersion(versioned: NodeDefExt) {
        if (!this._nodesByPackageName[versioned.package]) {
            this._nodesByPackageName[versioned.package] = [];
        }
        this._nodesByPackageName[versioned.package][versioned.version] = versioned;
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

                        let state = RES.UNRESOLVED;
                        if (version[0] === '^') {
                            state = RES.UNRESOLVED_MAJOR;
                        }
                        if (version[0] === '~') {
                            state = RES.UNRESOLVED_MIDDLE;
                        }

                        linkedNode = this.getOrCreateNode(requredName, <PackageLockDependency>{ version: req[requredName] });
                        linkedNode.device = state;
                        linkedNode.resolved = false;

                        // console.error("cannot find node for name " + linkedName);
                        // console.error("available nodes  " + Object.keys(this.nodeByKey));
                    }
                    linkedNode.link(x, linkedNode.isUnresolved()/* x.dev*/);

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
            this.indexPackageVersion(n);
            this.node.push(n);
            return n;
        }
    }





    static DELIMITERS = '-_.';







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

        // let _nodec=0;
        this.node.forEach(x => {
            // _nodec++;
            // let group="Group-"+x.package[0].toUpperCase();
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

    private escapeVersion(key: string): string {
        return key.split(/\W/).join("_");
    }

    private escape(key: string): string {
        let k = key.split(/\.|-|\#|_|@|^/).join("_");
        return k;
    }
}