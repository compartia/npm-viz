
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './package-info.html';
import { Hierarchy } from "../graph/tf_graph_common/hierarchy";
import * as Graph from "../graph/tf_graph_common/graph";

@customElement('package-info')
export class GraphScene extends Polymer.Element {

    @property({ type: Object, observer: 'onJsonLoaded' })
    jsonLoaded: any;

    @property({ type: Object, observer: 'onSelectedNode' })
    selectedNode: any;

    @property({
        type: Object
    })
    graphHierarchy: Hierarchy;


    @property({ type: String })
    packageName: any;

    @property({ type: Object })
    slectedNode: Graph.Node

    @property({ type: String })
    packageVersion: any;

    private onSelectedNode(nodeName: string) {

        let node = this.graphHierarchy.node(nodeName);

        this.set("slectedNode", node);
        console.log(node);

        if (node && !node.isGroupNode) {
            this.$.apiRequest.generateRequest();
        } else {
            this.set("jsonLoaded", null);
        }
    }

    private onJsonLoaded(e) {
        console.log(this.jsonLoaded);
    }
}