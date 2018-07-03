import { GraphDef, FunctionDefLibraryDef, VersionDef, NodeDef } from "./tf_graph_common/proto";

import * as _ from 'lodash';

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
export class PackageLockGraph implements GraphDef {
    node: NodeDef[] = [];

    // Compatibility versions of the graph.
    versions: VersionDef[];

    // Contains a library of functions that may composed through the graph.
    library: FunctionDefLibraryDef;


    constructor(json: PackageLock) {
        this.iterateDeps(null, json.dependencies, 1);
        console.log(this.node);
    }

    private iterateDeps(parent: NodeDef, deps: { [key: string]: PackageLockDependency; }, depth: number) {
        Object.keys(deps).forEach(key => {

            let dep = deps[key];

            let nn = this.toNode(key, dep, depth);

            this.node.push(nn);

        
            this.linkNodes(parent, nn);

            if (dep.dependencies) {
                this.iterateDeps(nn, dep.dependencies, depth + 1);
            }
        });
    }

    private linkNodes(from:NodeDef, to:NodeDef){
        if(from==null || to==null) return;
        from.input.push(to.name);
        to.output.push(from.name);
    }


    private toNode(key: string, dep: PackageLockDependency, depth: number): NodeDef {
        const kind = dep.dev ? "develoment" : "runtime";
        const dir = dep.dev ? "develoment/" : "";
        let n: NodeDef = <NodeDef>{
            /** Name of the node */

            name: this.nodeName(key, dep.version), 
            /** List of nodes that are inputs for this node. */
            input: [],
            output: [],
            /** The name of the device where the computation will run. */
            device: kind + "-" + depth,
            /** The name of the operation associated with this node. */
            op: "OP",//dep.version,
            /** List of attributes that describe/modify the operation. */
            nodeAttributes: { 'label': key + " " + dep.version }

            //{ key: 'string'; value: 'any'; }[]; 
        }

        if (dep.requires)
            Object.keys(dep.requires).forEach(dependency => {
                let linked=this.nodeName(dependency, dep.requires[dependency]);
                n.input.push(linked);
            });

        return n;
    }

    private splitModuleName(key: string): string {
        return key;
        //return key.length > 20 ? key.split("-").join("/") : key;
    }
     

    private nodeName(libName: string, libVersion: string) {
        let n = this.escape(libName);//.split("@").join("_");
        let v = this.escape(libVersion);
        n = n.split("-").join("/");
        n = n.split(".").join("/");

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