import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './app.html'

import './components/load-package'
import './graph/components/tf-graph'
import './graph/components/tf-graph-loader'
import './3d/graph3d-scene'

import { SlimGraph } from "./graph/tf_graph_common/graph";
import { getTracker, getSubtaskTracker } from "./graph/tf_graph_common/util";

import * as hierarchy from './graph/tf_graph_common/hierarchy';
/**
 * MyApp main class.
 */
@customElement('npm-deps-graph')
export class NpmDepsGraph extends Polymer.Element {

  @property({ type: String })
  _packageLockContents: string;

  @property({ type: String })
  _packageLockUrl: string;

  @property({ type: Object, notify: true })
  progress: any;

  @property({ type: Object })
  _graph: SlimGraph;

  @property({ type: Object, observer: 'packageInfoChanged' })
  packageInfo: any;

  @property({ type: Number, observer: 'selectedTabChanged' })
  selectedTab: number = 0;

  @property({ type: String, notify: true })
  _colorBy: any;

  static get
    observers() {
    return [
      '_graphUpdated(_graph)',
    ]
  };

  public packageInfoChanged(e) {
    if (this.packageInfo) {
      this._packageLockContents = JSON.stringify(this.packageInfo, null, ' ');
    }
  }

  public selectedTabChanged(e) {
    if (this.selectedTab == 3) {
      this.$.scene3d.active = true;
      this.$.scene3d.step();
    } else {
      this.$.scene3d.active = false;
    }
  }

  private _isNotComplete(progress): boolean {
    return progress.value < 100;
  }

  private _graphUpdated(slimGraph: SlimGraph) {
    const tracker = getTracker(this.$.loader);
    const hierarchyTracker = getSubtaskTracker(
      tracker, 100, 'Namespace hierarchy');

    const hierarchyOptions: hierarchy.HierarchyParams = <hierarchy.HierarchyParams>{};

    hierarchy.build(slimGraph, hierarchyOptions, hierarchyTracker).then(
      (graphHierarchy) => {
        // We have parsed and built the graph object from a pbtxt file. Render the graph.
        this.$.graph.set('basicGraph', slimGraph);
        this.$.graph.set('graphHierarchy', graphHierarchy);
      });
  }

  private _onLoadGraphEvent({ detail }) {
    this._packageLockUrl = detail.url;
  }
}

