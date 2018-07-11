
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './package-info.html';
import { Hierarchy } from "../graph/tf_graph_common/hierarchy";
import * as Graph from "../graph/tf_graph_common/graph";
import * as _ from 'lodash';
import { NodeDef } from "../graph/tf_graph_common/proto";


@customElement('dependency-link')
export class DependencyLink extends Polymer.Element {
    @property({ type: Object })
    item: any;


    private _nodeListener(event) {
        // fire node.click/mouseover/mouseout
        this.fire('node-list-item-' + event.type, {
            cardNode: this.item.name,
            nodeName: this.item.name,
            // type: this.itemType
        });
    }

    public fire(eventName: string, value?: any): void {
        // console.log("firing "+eventName);
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

        // Object.keys(PackageInfo.listeners).forEach(key=>{
        //     let listener = (e) => {
        //         console.error(e);
        //         this[key](e);
        //       }
        // });

        _.toPairs(PackageInfo.listeners).forEach(pair => {
            let listener = (e) => {
                this[pair[1]](e);
            }
            console.error(pair[0]);
            window.addEventListener(pair[0], listener);

        });
    }


    // private getNodes(names:string):NodeDef[]{
    //     for(let n of names){
    //         this.graphHierarchy.node(n)
    //     }
    // }
}