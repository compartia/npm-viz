import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './package-info.html';
import { Hierarchy } from "../graph/tf_graph_common/hierarchy";
import * as Graph from "../graph/tf_graph_common/graph";
import * as _ from 'lodash';


@customElement('dependency-link')
export class DependencyLink extends Polymer.Element {
    @property({ type: Object })
    item: any;


    private _nodeListener(event) {
        this.fire('node-list-item-' + event.type, {
            cardNode: this.item.name,
            nodeName: this.item.name,
        });
    }

    public fire(eventName: string, value?: any): void {
        window.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail: value }));
    }
}

@customElement('package-info')
export class PackageInfo extends Polymer.Element {

    @property({ type: Object, observer: 'onJsonLoaded' })
    jsonLoaded: any;

    @property({ type: Object, observer: 'onSelectedNode', notify: true })
    selectedNode: any;

    @property({ type: Object, notify: true })
    highlightedNode: String;

    @property({
        type: Object
    })
    graphHierarchy: Hierarchy; 

    @property({ type: Object, notify: true })
    progress: any;

    @property({ type: String })
    packageName: any;

    @property({ type: Object })
    slectedNode: Graph.Node

    @property({ type: String })
    packageVersion: any;

    @property({ type: Array })
    outputs: Graph.Node[];

    @property({ type: Array })
    inputs: Graph.Node[];

    static listeners = {
        'node-list-item-click': '_nodeListItemClicked',
        'node-list-item-mouseover': '_nodeListItemMouseover',
        'node-list-item-mouseout': '_nodeListItemMouseout'
    };

    public loadGraph() :void{
        // this.fire
        let detail = {
            name: this.jsonLoaded.name,
            version: this.jsonLoaded.version,
            url: `http://localhost:5000/package-lock/${this.jsonLoaded.name}/${this.jsonLoaded.version}`
        };
        console.error("firing");
        this.dispatchEvent(new CustomEvent("load-graph", { bubbles: true, detail: detail }));
    }

    private _nodeListItemClicked(event) {
        this.selectedNode = event.detail.nodeName;
    }

    private _nodeListItemMouseover(event) {
        this.highlightedNode = event.detail.nodeName;
    }

    private _nodeListItemMouseout() {
        this.highlightedNode = null;
    }

    private onSelectedNode(nodeName: string) {

        let node = this.graphHierarchy.node(nodeName);

        this.set("slectedNode", node);
        console.log(node);

        if (node && !node.isGroupNode) {

            this.outputs = _.map((node as any).outputs, n => this.graphHierarchy.node(n.name));
            this.inputs = _.map((node as any).inputs, n => this.graphHierarchy.node(n.name));

            this.progress.value = 0;
            this.progress.indeterminate = true;
            this.$.apiRequest.generateRequest();
        } else {
            this.set("jsonLoaded", null);
        }
    }

    private onJsonLoaded(e) {
        console.log(this.jsonLoaded);
    }

    public ready() {
        super.ready();

        _.toPairs(PackageInfo.listeners).forEach(pair => {
            let listener = (e) => {
                this[pair[1]](e);
            }
            window.addEventListener(pair[0], listener);

        });
    }


}