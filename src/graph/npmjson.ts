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
    dependencies: { [key: string]: PackageLockDependency; };
}

interface  Link{
    target:NodeDefExt;
    control:boolean;
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
        n.name = NodeDefExt.nodeName(key, dep.version);

        n.device = dep.dev ? "develoment" : "runtime";;
        n.dev = dep.dev;

        n.version = dep.version;
        n.package = key;
        n.nodeAttributes = { 'label': key + " " + dep.version };
        n.op = "OP";


        (n as any).requires = dep.requires;
    }


    version: string;
    package: string;
    dev: boolean;

    get output(): string[] {
        return this._output.map(x => x.target.name)
    }
    get input(): string[] {
        return this._input.map(x => x.control? '^'+ x.target.name: x.target.name);
    }

    public link(other: NodeDefExt, control:boolean) {
        this._input.push({
            target:other,
            control:control
        });
        other._output.push({
            target:this,
            control:control
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
        this.iterateDeps(null, json.dependencies, 1);
        this.linkRequiremens();

        this.renameNodes();
    }

    private nodeByKey: { [key: string]: NodeDefExt; } = {};

    private iterateDeps(parent: NodeDefExt, deps: { [key: string]: PackageLockDependency; }, depth: number) {
        Object.keys(deps).forEach(key => {
            let dep = deps[key];
            let nn = this.getOrCreateNode(key, dep, depth);
            this.node.push(nn);
            if(parent){
                parent.link(nn,false);
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
                    let linkedName = NodeDefExt.nodeName(requredName, req[requredName]);
                    let linkedNode = this.nodeByKey[linkedName];

                    if (!linkedNode) {
                        console.error("cannot find node for name " + linkedName);
                        console.error("available nodes  " + Object.keys(this.nodeByKey));
                    } else {
                        linkedNode.link(x, x.dev);
                    }
                });
            }
        });
    }

   



    private getOrCreateNode(key: string, dep: PackageLockDependency, depth: number): NodeDefExt {



        const nodeName = NodeDefExt.nodeName(key, dep.version);

        if (this.nodeByKey[nodeName]) {
            return this.nodeByKey[nodeName];
        } else {
            let n: NodeDefExt = new NodeDefExt(key, dep);
            this.nodeByKey[nodeName] = n;
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

    private buildSemanticStats(): { [key: string]: number } {
        /**
         * making groups
         */
        let stats = {};
        this.node.forEach(x => {
            let words = chunks.allSplits(x.package, '.-_ /@$');
            chunks.countWords(words, stats);
        })

        let pairszFiltered = _.toPairs(stats).filter(x => x[1] > 1);
        stats = _.fromPairs(pairszFiltered);
        console.log(stats);
        return stats;
    }

    private findBestGroup(groups: { [key: string]: number }, childGroup: string, delim: string): string | null {
        let splits = chunks.allSplits(childGroup, delim);
        let best = null;
        let max = 0;
        for (const ch of splits) {
            if (groups[ch]) {
                let val = ch.length * groups[ch];
                if (val > max) {
                    max = val;
                    best = ch;
                }
            }
        }
        return best;
    }

    private renameNodes(): void {
        let renamingMap: { [key: string]: string; } = {};
        const groups = this.buildSemanticStats();

        this.node.forEach(x => {
            let originalGroups = x.package.split("/");
            let childGroup = originalGroups.pop();
            let additionalGroup = this.findBestGroup(groups, childGroup, ".-_");
            if (additionalGroup) {
                originalGroups.push(additionalGroup);
                // originalGroups= [additionalGroup].concat(originalGroups);
            }
            originalGroups.push(childGroup);
            let newName = this.escape(originalGroups.join("/"));
            renamingMap[x.name] = newName + "-" + x.version;
        });

        this.applyRenamingMap(renamingMap);
    }



    private escape(key: string): string {
        let k = key;
        k = k.split("@").join("_");
        k = k.split("#").join("_");
        k = k.split("^").join("_");

        return k;
    }
}