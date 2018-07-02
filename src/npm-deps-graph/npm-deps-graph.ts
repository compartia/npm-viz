import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './npm-deps-graph.html'
import '../graph/components/tf-graph'
import '../graph/components/tf-graph-loader'

import { SlimGraph } from "../graph/tf_graph_common/graph";
import { getTracker, getSubtaskTracker } from "../graph/tf_graph_common/util";

import * as hierarchy from '../graph/tf_graph_common/hierarchy';
/**
 * MyApp main class.
 */
@customElement('npm-deps-graph')
export class NpmDepsGraph extends Polymer.Element {


  /**
   * A property call myProperty
   * @type {string}
   */
  @property({ type: String })
  myProperty: string = 'an application scaffolds with love';
  
  @property({ type: Object })
  _graph:  SlimGraph;
  

  static get
    observers() {
      return [
        '_graphUpdated(_graph)',
      ]
  };

  private _graphUpdated(slimGraph: SlimGraph) {
    const tracker = getTracker(this.$.loader);
    const hierarchyTracker = getSubtaskTracker(
      tracker, 100, 'Namespace hierarchy');

    const hierarchyOptions:hierarchy.HierarchyParams = <hierarchy.HierarchyParams>{};

    hierarchy.build(slimGraph, hierarchyOptions, hierarchyTracker).then(
      (graphHierarchy) => {
        // We have parsed and built the graph object from a pbtxt file. Render the graph.
        this.$.graph.set('basicGraph', slimGraph);
        this.$.graph.set('graphHierarchy', graphHierarchy);
      });
  }
}

