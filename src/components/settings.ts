
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './settings.html';
// import { Hierarchy } from "../graph/tf_graph_common/hierarchy";
// import * as Graph from "../graph/tf_graph_common/graph";
// import * as _ from 'lodash';
// import { NodeDef } from "../graph/tf_graph_common/proto";
import { ColorBy } from "../graph/tf_graph_common/node";


@customElement('view-settings')
export class DependencyLink extends Polymer.Element {
    @property({ type: String, notify:true})
    selectedColorBy: any =  "CARDINALITY";

    @property({ type: Array })
    colorByTypes: any = ["CARDINALITY", "DEVICE"];



    // public fire(eventName: string, value?: any): void {
    //     // console.log("firing "+eventName);
    //     window.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail: value }));
    // }
}
