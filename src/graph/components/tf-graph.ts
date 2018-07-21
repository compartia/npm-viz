import * as d3 from 'd3';
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './tf-graph.html'
import './tf-graph-scene'
import '../../components/package-info'
import '../../components/settings'

import * as render from '../tf_graph_common/render';
import * as graph from '../tf_graph_common/graph';
import * as layout from '../tf_graph_common/layout';
import * as util from '../tf_graph_common/util';
import * as scene from '../tf_graph_common/scene';
import * as hierarchy from '../tf_graph_common/hierarchy';
import { joinAndAggregateStats, Hierarchy } from "../tf_graph_common/hierarchy";
import * as _ from 'lodash';
import { EdgeData } from '../tf_graph_common/annotation';



@customElement('tf-graph')
export class TfGraphElement extends Polymer.Element {

  @property({
    type: Object,
    observer: '_graphChanged', notify: true
  })
  graphHierarchy: Hierarchy;

  @property({ type: Object })
  basicGraph: graph.SlimGraph;

  @property({ type: Object, notify: true, readOnly: true })
  renderHierarchy: render.RenderGraphInfo;

  @property({ type: String, notify: true })
  packageLockUrl:string = 'http://localhost:5000/package-lock/is-primitive/2.0.0';

  @property({ type: Object })
  stats: Object;

  @property({ type: Object })
  devicesForStats: Object;

  @property({ type: Object })
  hierarchyParams: hierarchy.HierarchyParams;

  @property({ type: Object, notify: true })
  progress: any;

  @property({ type: String })
  title: string;

  @property({
    type: String,
    notify: true,
  })

  @property({ type: String })
  selectedNode: string;

  // An EdgeData object if an edge is selected. Otherwise, null.
  @property({ type: Object, notify: true, })
  selectedEdge: any;



  // The <g> element of the last selected edge. Used to mark the edge as selected.
  @property({ type: Object })
  _lastSelectedEdgeGroup: d3.Selection<any, any, any, any>;

  @property({ type: String, notify: true })
  highlightedNode: string;

  /** What to color the nodes by (compute time, memory, device etc.) */
  @property({ type: String })
  colorBy: string

  @property({ type: Object, notify: true, readOnly: true })
  colorByParams: any;


  // An array of ContextMenuItem objects. Items that appear in the context
  // menu for a node.
  @property({ type: Array })
  nodeContextMenuItems: Array<any>;

  @property({ type: Number })
  _renderDepth = 1;



  @property({ type: Boolean })
  _allowGraphSelect = true;

  // A mapping between node name to the tf.graph.scene.HealthPill to render.
  @property({ type: Object })
  nodeNamesToHealthPills: Object;

  // The step of health pills to show throughout the graph.
  @property({ type: Number })
  healthPillStepIndex: number;

  /**
   * A function with signature EdgeThicknessFunction that computes the
   * thickness of a given edge.
   *
   * We initialize with the empty string value so that the observer that
   * builds the graph hierarchy is called even if this is not defined.
   */
  @property({ type: Object })
  edgeWidthFunction: render.EdgeThicknessFunction = (edgeData, edgeClass) => 1;

  /**
   * An optional function that takes a node selected event (whose `detail`
   * property is the selected node ... which could be null if a node is
   * deselected). Called whenever a node is selected or deselected.
   *
   * We initialize with the empty string value so that the observer that
   * builds the graph hierarchy is called even if this is not defined.
   * @type {Function}
   */
  @property({ type: Object })
  handleNodeSelected: any = (s:string)=> '';
  /**
   * An optional function that computes the label for an edge. Should
   * implement the EdgeLabelFunction signature.
   *
   * We initialize with the empty string value so that the observer that
   * builds the graph hierarchy is called even if this is not defined.
   * @type {Function}
   */
  @property({ type: Object })
  edgeLabelFunction:any = null;

  /**
   * An optional callback that implements the
   * tf.graph.edge.EdgeSelectionCallback signature. If provided, edges are
   * selectable, and this callback is run when an edge is selected.
   *
   * We initialize with the empty string value so that the observer that
   * builds the graph hierarchy is called even if this is not defined.
   * @type {Function}
   */
  @property({ type: Object })
  handleEdgeSelected:any = null;



  static get observers(){
    return [
      '_statsChanged(stats, devicesForStats)',
      // We must re-render the graph hierarchy if any handlers are defined.
      // Otherwise, the graph hierarchy might be created before the handlers are
      // set on the hierarchy, and the handlers will not be taken into
      // consideration by graph rendering logic. That would unfortunately for
      // instance result in the edge width function sometimes failing to take
      // effect on some page loads.
      '_buildNewRenderHierarchy(graphHierarchy, edgeWidthFunction, handleNodeSelected, edgeLabelFunction, handleEdgeSelected)',
      '_selectedNodeChanged(selectedNode)',
      '_selectedEdgeChanged(selectedEdge)',
    ];
  }
   

  /**
   * Pans to a node. Assumes that the node exists.
   * @param nodeName {string} The name of the node to pan to.
   */
  public panToNode(nodeName):void {
    this.$.scene.panToNode(nodeName);
  };

  private _buildNewRenderHierarchy(graphHierarchy:Hierarchy) {
    if(graphHierarchy){
      this._buildRenderHierarchy(graphHierarchy);
    }    
  };

  private _statsChanged(stats, devicesForStats) {
    if (this.graphHierarchy) {
      if (stats && devicesForStats) {
        joinAndAggregateStats(this.graphHierarchy, stats);
      }
      // Recompute the rendering information.
      this._buildRenderHierarchy(this.graphHierarchy);
    }
  };

  private _buildRenderHierarchy(graphHierarchy:Hierarchy) {
    util.time('new tf.graph.render.Hierarchy',  () => {
      if (graphHierarchy.root.type !==  graph.NodeType.META) {
        // root must be metanode but sometimes Polymer's dom-if has not
        // remove tf-graph element yet in <tf-node-info>
        // and thus mistakenly pass non-metanode to this module.
        return;
      }
      var renderGraph = new render.RenderGraphInfo(
          graphHierarchy, !!this.stats /** displayingStats */);
      renderGraph.edgeLabelFunction = this.edgeLabelFunction;
      renderGraph.edgeWidthFunction = this.edgeWidthFunction;

      // Producing the 'color by' parameters to be consumed
      // by the tf-graph-controls panel. It contains information about the
      // min and max values and their respective colors, as well as list
      // of devices with their respective colors.
      function getColorParamsFromScale(scale) {
        return {
          minValue: scale.domain()[0],
          maxValue: scale.domain()[1],
          startColor: scale.range()[0],
          endColor: scale.range()[1]
        };
      }

      (this as any)._setColorByParams({
        compute_time: getColorParamsFromScale(renderGraph.computeTimeScale),
        cardinality: getColorParamsFromScale(renderGraph.cardinalityScale),
        device: _.map(renderGraph.deviceColorMap.domain(),
            function(deviceName) {
          return {
            device: deviceName,
            color: renderGraph.deviceColorMap(deviceName)
          };
        }),
        xla_cluster: _.map(renderGraph.xlaClusterColorMap.domain(),
            function(xlaClusterName) {
          return {
            xla_cluster: xlaClusterName,
            color: renderGraph.xlaClusterColorMap(xlaClusterName)
          };
        }),
      });
      (this as any)._setRenderHierarchy(renderGraph);

      setTimeout(() => {
        this.dispatchEvent(new Event("rendered"));
      }, 50);

      // this.async(function() {
      //   this.fire("rendered");
      // });
    });
  };

  private _getVisible(name:string):string {
    if (!name) {
      return name;
    }
    return this.renderHierarchy.getNearestVisibleAncestor(name);
  }

  static listeners= {
    'graph-select': '_graphSelected',
    'disable-click': '_disableClick',
    'enable-click': '_enableClick',
    // Nodes
    'node-toggle-expand': '_nodeToggleExpand',
    'node-select': '_nodeSelected',
    'node-highlight': '_nodeHighlighted',
    'node-unhighlight': '_nodeUnhighlighted',
    'node-toggle-extract': '_nodeToggleExtract',
    'node-toggle-seriesgroup': '_nodeToggleSeriesGroup',
    // Edges
    'edge-select': '_edgeSelected',

    // Annotations

    /* Note: currently highlighting/selecting annotation node has the same
      * behavior as highlighting/selecting actual node so we point to the same
      * set of event listeners.  However, we might redesign this to be a bit
      * different.
      */
    'annotation-select': '_nodeSelected',
    'annotation-highlight': '_nodeHighlighted',
    'annotation-unhighlight': '_nodeUnhighlighted',

    // 'load-graph': '_onLoadGraphEvent',
    
  }

  private _graphChanged():void {
    // When a new graph is loaded, fire this event so that there is no
    // info-card being displayed for the previously-loaded graph.
    // this.fire('graph-select');
    this.dispatchEvent(new Event('graph-select'));
  }

  private _graphSelected(event) {
    // Graph selection is not allowed during an active zoom event, as the
    // click seen during a zoom/pan is part of the zooming and does not
    // indicate a user desire to click on a specific section of the graph.
    if (this._allowGraphSelect) {
      this.set('selectedNode', null);
      this.set('selectedEdge', null);
    }
    // Reset this variable as a bug in d3 zoom behavior can cause zoomend
    // callback not to be called if a right-click happens during a zoom event.
    this._allowGraphSelect = true;
  };

  private _disableClick(event) {
    this._allowGraphSelect = false;
  }

  private _enableClick(event) {
    this._allowGraphSelect = true;
  }
  // Called when the selected node changes, ie there is a new selected node or
  // the current one is unselected.
  private _selectedNodeChanged(selectedNode:string) {
    if (this.handleNodeSelected) {
      // A higher-level component provided a callback. Run it.
      this.handleNodeSelected(selectedNode);
    }
  }
  // Called when the selected edge changes, ie there is a new selected edge or
  // the current one is unselected.
  private _selectedEdgeChanged(selectedEdge) {
    throw("unimplemented");
    this._deselectPreviousEdge(d3.select(this.$.scene.$.svg));

    // Visually mark this new edge as selected.
    if (selectedEdge) {
      this._lastSelectedEdgeGroup.classed(
          scene.Class.Edge.SELECTED, true);

      // Update the color of the marker too if the edge has one.
      this._updateMarkerOfSelectedEdge(selectedEdge);
    }

    if (this.handleEdgeSelected) {
      // A higher-level component provided a callback. Run it.
      this.handleEdgeSelected(selectedEdge);
    }
  }
  // Called only when a new (non-null) node is selected.
  private _nodeSelected(event) {
    if (this._allowGraphSelect) {
      this.set('selectedNode', event.detail.name);
    }
    // Reset this variable as a bug in d3 zoom behavior can cause zoomend
    // callback not to be called if a right-click happens during a zoom event.
    this._allowGraphSelect = true;
  };

  private _edgeSelected(event) {
    if (this._allowGraphSelect) {
      this.set('_lastSelectedEdgeGroup', event.detail.edgeGroup);
      this.set('selectedEdge', event.detail.edgeData);
    }
    // Reset this variable as a bug in d3 zoom behavior can cause zoomend
    // callback not to be called if a right-click happens during a zoom event.
    this._allowGraphSelect = true;
  };

  private _nodeHighlighted(event) {
    this.set('highlightedNode', event.detail.name);
  };
  
  private _nodeUnhighlighted(event) {
    this.set('highlightedNode', null);
  }

  private _nodeToggleExpand(event) {
    // Immediately select the node that is about to be expanded.
    this._nodeSelected(event);

    // Compute the sub-hierarchy scene.
    var nodeName = event.detail.name;
    var renderNode = this.renderHierarchy.getRenderNodeByName(nodeName);
    // Op nodes are not expandable.
    if (renderNode.node.type === graph.NodeType.OP) {
      return;
    }
    this.renderHierarchy.buildSubhierarchy(nodeName);
    renderNode.expanded = !renderNode.expanded;

    // Expand the node with some delay so that the user can immediately see
    // the visual effect of selecting that node, before the expansion is
    // done.

    setTimeout(() => this.$.scene.setNodeExpanded(renderNode), 75);

  };


  private _nodeToggleExtract (event) {
    // Toggle the include setting of the specified node appropriately.
    var nodeName = event.detail.name;
    var renderNode = this.renderHierarchy.getRenderNodeByName(nodeName);
    if (renderNode.node.include == graph.InclusionType.INCLUDE) {
      renderNode.node.include = graph.InclusionType.EXCLUDE;
    } else if (renderNode.node.include == graph.InclusionType.EXCLUDE) {
      renderNode.node.include = graph.InclusionType.INCLUDE;
    } else {
      renderNode.node.include =
       this.renderHierarchy.isNodeAuxiliary(renderNode)
          ? graph.InclusionType.INCLUDE : graph.InclusionType.EXCLUDE;
    }

    // Rebuild the render hierarchy.
    this._buildRenderHierarchy(this.graphHierarchy);
  }

  private _nodeToggleSeriesGroup(event) {
    // Toggle the group setting of the specified node appropriately.
    var nodeName = event.detail.name;
    graph.toggleNodeSeriesGroup(this.hierarchyParams.seriesMap, nodeName);

    // Rebuild the render hierarchy with the updated series grouping map.
    this.set('progress', {
      value: 0,
      msg: '',
      name: 'tf-graph'
    });
    var tracker = util.getTracker(this);
    var hierarchyTracker = util.getSubtaskTracker(tracker, 100,
          'Namespace hierarchy');
    hierarchy.build(this.basicGraph, this.hierarchyParams, hierarchyTracker)
    .then(function(graphHierarchy) {
      this.set('graphHierarchy', graphHierarchy);
      this._buildRenderHierarchy(this.graphHierarchy);
    }.bind(this));
  }

  private _deselectPreviousEdge(_svg) {
    const selectedSelector = '.' +  scene.Class.Edge.SELECTED;
    // Visually mark the previously selected edge (if any) as deselected.
    _svg.select(selectedSelector)
        .classed( scene.Class.Edge.SELECTED, false)
        .each((d:EdgeData , i) => {
          // Reset its marker.
          if (d.label) {
            const paths = d3.select(this).selectAll('path.edgeline');
            if (d.label.startMarkerId) {
              paths.style('marker-start', `url(#${d.label.startMarkerId})`);
            }
            if (d.label.endMarkerId) {
              paths.style('marker-end', `url(#${d.label.endMarkerId})`);
            }
          }
        });
  };

  private _updateMarkerOfSelectedEdge(selectedEdge) {
    if (selectedEdge.label) {
      // The marker will vary based on the direction of the edge.
      const markerId = selectedEdge.label.startMarkerId || selectedEdge.label.endMarkerId;
      if (markerId) {
        // Find the corresponding marker for a selected edge.
        const selectedMarkerId = markerId.replace('dataflow-', 'selected-');
        let selectedMarker:any = this.shadowRoot.querySelector('#' + selectedMarkerId);

        if (!selectedMarker) {
          // The marker for a selected edge of this size does not exist yet. Create it.
          const originalMarker = this.shadowRoot.querySelector('tf-graph-scene').querySelector('#' + markerId);
          selectedMarker = originalMarker.cloneNode(true);
          selectedMarker.setAttribute('id', selectedMarkerId);
          selectedMarker.classList.add('selected-arrowhead');
          originalMarker.parentNode.appendChild(selectedMarker);
        }

        // Make the path use this new marker while it is selected.
        const markerAttribute = selectedEdge.label.startMarkerId ? 'marker-start' : 'marker-end';
        this._lastSelectedEdgeGroup.selectAll('path.edgeline').style(
            markerAttribute, `url(#${selectedMarkerId})`);
      }
    }
  }
  public not(x) {
    return !x;
  }

  private _onLoadGraphEvent({detail}){
    // console.error(event.detail);
    this.packageLockUrl = `http://localhost:5000/package-lock/${detail.name}/${detail.version}`;
  }

  public ready() {
    super.ready();
 
    // (<HTMLElement>this.$.infoPanel).on
    _.toPairs(TfGraphElement.listeners).forEach(pair => {
      let listener = (e) => {
        //console.error(e);
        this[pair[1]](e);
      }
       
      this.$.scene.addEventListener(pair[0], listener);

    });
  }
}

