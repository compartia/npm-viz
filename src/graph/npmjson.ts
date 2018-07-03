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

export class NodeDefExt implements NodeDef {
    name: string;
    /** List of nodes that are inputs for this node. */
    private _input: NodeDefExt[] = [];
    private _output: NodeDefExt[] = [];
    /** The name of the device where the computation will run. */
    device: string;
    /** The name of the operation associated with this node. */
    op: string;
    /** List of attributes that describe/modify the operation. */
    // attr:{ key: string; value: any; }[]; 

    nodeAttributes: { [key: string]: any; };


    version: string;
    package: string;
    dev: boolean;

    get output(): string[] {
        return this._output.map(x => x.name)
    }
    get input(): string[] {
        return this._input.map(x => x.name)
    }

    public link(other: NodeDefExt) {
        this._input.push(other);
        other._output.push(this);
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
            this.linkNodes(parent, nn);

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
                    let linkedName = this.nodeName(requredName, req[requredName]);
                    let linkedNode = this.nodeByKey[linkedName];

                    if (!linkedNode) {
                        console.error("cannot find node for name " + linkedName);
                        console.error("available nodes  " + Object.keys(this.nodeByKey));
                    } else {
                        linkedNode.link(x);
                    }


                });
            }
        });
    }

    private linkNodes(from: NodeDefExt, to: NodeDefExt) {
        if (from && to)
            from.link(to);
    }



    private getOrCreateNode(key: string, dep: PackageLockDependency, depth: number): NodeDefExt {

        const kind = dep.dev ? "develoment" : "runtime";
        const dir = dep.dev ? "develoment/" : "";

        const nodeName = this.nodeName(key, dep.version);

        if (this.nodeByKey[nodeName]) {
            return this.nodeByKey[nodeName];
        } else {

            let n: NodeDefExt = new NodeDefExt();
            n.name = nodeName;
            n.device = kind + "-" + depth;
            n.dev = dep.dev;
            n.version = dep.version;
            n.package = key;
            n.nodeAttributes = { 'label': key + " " + dep.version };
            n.op = "OP";

            // let __n: NodeDefExt = <NodeDefExt>{
            //     /** Name of the node */
            //     name: nodeName,
            //     /** List of nodes that are inputs for this node. */
            //     input: [],
            //     output: [],
            //     /** The name of the device where the computation will run. */
            //     device: kind + "-" + depth,
            //     /** The name of the operation associated with this node. */
            //     op: "OP",//dep.version,
            //     /** List of attributes that describe/modify the operation. */
            //     nodeAttributes: { 'label': key + " " + dep.version },

            //     version: dep.version,
            //     package: key,
            //     dev: dep.dev
            // };

            (n as any).requires = dep.requires;


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


    private nodeName(libName: string, libVersion: string) {
        let n = libName;//this.escape(libName);
        let v = libVersion;//this.escape(libVersion);
        return n + "-" + v;
    }

    private escape(key: string): string {
        let k = key;
        k = k.split("@").join("_");
        k = k.split("#").join("_");
        k = k.split("^").join("_");

        return k;
    }
}