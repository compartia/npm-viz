
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './graph3d-scene.html';
import { P3dScene } from "./graph3d";

import * as GraphModule from '../graph/tf_graph_common/graph';


@customElement('graph3d-scene')
export class DependencyLink extends Polymer.Element {


    @property({ type: Object })
    scene: P3dScene;

    @property({ type: Boolean })
    active: boolean=false;

    @property({ type: Object, observer:"onGraphChanged" })
    outGraph: GraphModule.SlimGraph;


    private onGraphChanged(e){
        this.active=false;
        this.scene.rebuild(this.outGraph);
        this.active=true;
    }
    public step(timestamp) {
        this.scene.render();
        if(this.active)
            window.requestAnimationFrame((t) => this.step(t));
    }


    public ready() {
        super.ready();
        this.scene = new P3dScene(this.$.scene3d);
    }

    
}
