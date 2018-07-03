import { GraphDef, FunctionDefLibraryDef, VersionDef, NodeDef } from "./tf_graph_common/proto";

import * as _ from 'lodash';
import { treemapResquarify } from "d3";

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


///////////////////////
export class PackageLockGraph implements GraphDef {
    node: NodeDef[] = [];

    // Compatibility versions of the graph.
    versions: VersionDef[];

    // Contains a library of functions that may composed through the graph.
    library: FunctionDefLibraryDef;


    constructor(json: PackageLock) {
        this.iterateDeps(null, json.dependencies, 1);
        this.iterateRequiremens();
        this.renameNodes();
    }

    private nodeByKey: { [key: string]: NodeDef; } = {};

    private iterateDeps(parent: NodeDef, deps: { [key: string]: PackageLockDependency; }, depth: number) {
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

    private iterateRequiremens() {
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
                        linkedNode.input.push(x.name);
                    }


                });
            }
        });
    }

    private linkNodes(from: NodeDef, to: NodeDef) {
        if (from == null || to == null) return;
        from.input.push(to.name);
        to.output.push(from.name);
    }



    private getOrCreateNode(key: string, dep: PackageLockDependency, depth: number): NodeDef {

        const kind = dep.dev ? "develoment" : "runtime";
        const dir = dep.dev ? "develoment/" : "";

        const nodeName = this.nodeName(key, dep.version);

        if (this.nodeByKey[nodeName]) {
            return this.nodeByKey[nodeName];
        } else {

            let n: NodeDef = <NodeDef>{
                /** Name of the node */
                name: nodeName,
                /** List of nodes that are inputs for this node. */
                input: [],
                output: [],
                /** The name of the device where the computation will run. */
                device: kind + "-" + depth,
                /** The name of the operation associated with this node. */
                op: "OP",//dep.version,
                /** List of attributes that describe/modify the operation. */
                nodeAttributes: { 'label': key + " " + dep.version }
            };

            (n as any).requires = dep.requires;


            this.nodeByKey[nodeName] = n;
            return n;
        }
    }

    private splitModuleName(key: string): string {
        return key;
        //return key.length > 20 ? key.split("-").join("/") : key;
    }

    private getPrefixIfSplittable(n: string): string {
        let idx = n.indexOf('-');
        if (idx > 0) {
            return n.substring(0, idx);
        }

        idx = n.indexOf('_');
        if (idx > 0) {
            return n.substring(0, idx);
        }

        idx = n.indexOf('.');
        if (idx > 0) {
            return n.substring(0, idx);
        }

        return null;
    }

    private findNodesByPrefix(prefix: string): NodeDef[] {
        return this.node.filter(x => x.name.startsWith(prefix));
    }

    private schedueForRenaming(prefix: string, prefixed: NodeDef[], renamingMap: { [key: string]: string; }) {
        let names = prefixed.map(x => x.name);

        names.forEach(name => {
            let newName = prefix + "/" + name;
            renamingMap[name] = newName
        });
    }

    private applyRenamingMap(renamingMap: { [key: string]: string; }) {
        let newName;
        this.node.forEach(x => {
            newName = renamingMap[x.name];
            if (newName) {
                console.log(x.name + "=>" + renamingMap[x.name])
                x.name = renamingMap[x.name];
            }

            x.input = this.renameLinks(x.input, renamingMap);
            x.output = this.renameLinks(x.output, renamingMap);
        });
    }

    private renameLinks(links: string[], renamingMap: { [key: string]: string; }): string[] {
        return links.map(
            x => {
                let newName = renamingMap[x];
                return newName ? newName : x;
            }
        );
    }

    private renameNodes(): void {
        let renamingMap: { [key: string]: string; } = {};

        this.node.forEach(x => {
            let prefix = this.getPrefixIfSplittable(x.name);

            if (prefix) {
                console.error(prefix);
                let prefixed: NodeDef[] = this.findNodesByPrefix(prefix);
                if (prefixed.length > 1) {
                    this.schedueForRenaming(prefix, prefixed, renamingMap);
                }
            }

        });

        this.applyRenamingMap(renamingMap);
    }


    private nodeName(libName: string, libVersion: string) {
        let n = this.escape(libName);//.split("@").join("_");
        let v = this.escape(libVersion);

        // n = n.split("-").join("/");
        // n = n.split(".").join("/");

        return n + "-" + v;
    }

    private escape(key: string): string {
        let k = key;//.split("@").join("_");
        k = k.split("@").join("_");
        k = k.split("#").join("_");
        k = k.split("^").join("_");

        return k;
    }
}