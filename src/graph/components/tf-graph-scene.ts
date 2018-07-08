import * as d3 from 'd3';
import * as _ from 'lodash';
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './tf-graph-scene.html';
import * as graph from '../tf_graph_common/graph';
import * as layout from '../tf_graph_common/layout';
import { Minimap } from "../tf_graph_common/minimap";
import * as node from '../tf_graph_common/node';
import { RenderGraphInfo, RenderNodeInfo } from "../tf_graph_common/render";
import * as scene from '../tf_graph_common/scene';
import * as util from '../tf_graph_common/util';
import './tf-graph-minimap'


@customElement('graph-scene')
export class GraphScene extends Polymer.Element {


    // An optional callback that implements the tf.graph.edge.EdgeSelectionCallback signature. If
    // provided, edges are selectable, and this callback is run when an edge is selected.
    @property({ type: Object })
    handleEdgeSelected: any;

    /**
     * Keeps track of the starting coordinates of a graph zoom/pan.
     *
     * @private {{x: number, y: number}?}
     */
    @property({ type: Object })
    _zoomStartCoords: any = null;
    /**
     * Keeps track of the current coordinates of a graph zoom/pan
     *
     * @private {{x: number, y: number}?}
     */
    @property({ type: Object })
    _zoomTransform: any = null;

    /** Maximum distance of a zoom event for it to be interpreted as a click */
    @property({ type: Number })
    _maxZoomDistanceForClick = 20;

    /**
     * Max font size for metanode label strings.
     */
    @property({ type: Number })
    maxMetanodeLabelLengthFontSize = 9;



    /**
     * Min font size for metanode label strings.
     */
    @property({ type: Number })
    minMetanodeLabelLengthFontSize: number = 6;

    /**
     * Metanode label strings longer than this are given smaller fonts.
     */
    @property({ type: Number })
    maxMetanodeLabelLengthLargeFont: number = 11;

    /**
     * Metanode label strings longer than this are truncated with ellipses.
     */
    @property({ type: Number })
    maxMetanodeLabelLength: number = 18;


    /** Whether the scene has fit the current render hierarchy (to the viewport) at least once. */
    @property({ type: Boolean })
    _hasRenderHierarchyBeenFitOnce: boolean;

    /**
   * A minimap object to notify for zoom events.
   * This property is a tf.scene.Minimap object.
   */
    @property({ type: Object })
    minimap: Minimap;

    /*
     * Dictionary for easily stylizing annotation nodes when state changes.
     * _annotationGroupIndex[nodeName][hostNodeName] =
     *   d3_selection of the annotationGroup
     */
    @property({ type: Object })
    _annotationGroupIndex: any = {};
    /*
     * Dictionary for easily stylizing edges when state changes.
     * _edgeGroupIndex[edgeName] = d3_selection of the edgeGroup
     */
    @property({ type: Object })
    _edgeGroupIndex: any = {};


    @property({
        type: String,
        observer: '_highlightedNodeChanged'
    })
    highlightedNode: string;

    @property({
        type: String,
        observer: '_selectedNodeChanged'
    })
    selectedNode: string;


    /** Keeps track of if the graph has been zoomed/panned since loading */
    @property({
        type: Boolean,
        observer: '_onZoomChanged'
    })
    _zoomed: boolean = false;

    /** This property is a d3_zoom object. */
    @property({ type: Object })
    _zoom: d3.ZoomBehavior<any, any>;
    /**
     * A property call myProperty
     * @type {string}
     */
    @property({ type: String })
    renderHierarchy: RenderGraphInfo;

    @property({ type: String })
    name: string;

    @property({ type: String })
    colorBy: string;

    /** Whether this scene element is currently attached to a parent element. */
    @property({ type: Boolean })
    _isAttached: boolean;

    @property({ type: Object })
    progress: any;

    // An array of ContextMenuItem objects. Items that appear in the context
    // menu for a node.
    @property({ type: Array })
    nodeContextMenuItems: Array<any>;

    // A mapping between node name to the tf.graph.scene.HealthPill to render.
    @property({ type: Object })
    nodeNamesToHealthPills: { [key: string]: scene.HealthPill[] };

    // The step of health pills to show throughout the graph.
    @property({ type: Object })
    healthPillStepIndex: number;

    /*
     * Dictionary for easily stylizing nodes when state changes.
     * _nodeGroupIndex[nodeName] = d3_selection of the nodeGroup
     */
    @property({ type: Object })
    _nodeGroupIndex: any = {};

    /**
     * Scale mapping from template name to a number between 0 and N-1
     * where N is the number of different template names. Used by
     * tf.graph.scene.node when computing node color by structure.
     * This property is a d3.scale.ordinal object.
     */
    @property({ type: Object })
    templateIndex: (string: string) => number;

    /**
     * Resets the state of the component. Called whenever the whole graph
     * (dataset) changes.
     */
    public _resetState() {
        const _svg = d3.select(this.$.svg);
        // Reset the state of the component.
        this._nodeGroupIndex = {};
        this._annotationGroupIndex = {};
        this._edgeGroupIndex = {};
        this._updateLabels(false);
        // Remove all svg elements under the 'root' svg group.
        _svg.select('#root').selectAll('*').remove();
        // And the defs.
        _svg.select('defs #linearGradients')
            .selectAll('*').remove();
    }

    private _updateHealthPills(nodeNamesToHealthPills: { [key: string]: scene.HealthPill[] }, healthPillStepIndex: number) {
        scene.addHealthPills(this.$.svg, nodeNamesToHealthPills, healthPillStepIndex);
    };

    public getNode(nodeName: string): RenderNodeInfo {
        return this.renderHierarchy.getRenderNodeByName(nodeName);
    }

    public isNodeExpanded(node): boolean {
        return node.expanded;
    };

    public setNodeExpanded(renderNode) {
        this._build(this.renderHierarchy);
        this._updateLabels(!this._zoomed);
    };

    private _updateLabels(showLabels: boolean) {
        const _root=d3.select(this.$.root);
        let mainGraphTitleElement = this.$.title;

        let titleStyle = mainGraphTitleElement.style;
        let auxTitleElement = this.$.auxTitle;
        let auxTitleStyle = auxTitleElement.style;

        let functionLibraryTitleStyle = this.$.functionLibraryTitle.style;
        let core = <SVGGraphicsElement>_root.select("." + scene.Class.Scene.GROUP + ">." +
            scene.Class.Scene.CORE).node();
        // Only show labels if the graph is fully loaded.
        if (showLabels && core && this.progress && this.progress.value === 100) {
            let aux: any =
                _root.select("." + scene.Class.Scene.GROUP + ">." +
                    scene.Class.Scene.INEXTRACT).node() ||
                _root.select("." + scene.Class.Scene.GROUP + ">." +
                    scene.Class.Scene.OUTEXTRACT).node();
            let coreX = core.getCTM().e;
            let auxX = aux ? aux.getCTM().e : null;
            titleStyle.display = 'inline';
            titleStyle.left = coreX + 'px';
            if (auxX !== null && auxX !== coreX) {
                auxTitleStyle.display = 'inline';

                // Make sure that the aux title is positioned rightwards enough so as to
                // prevent overlap with the main graph title.
                auxX = Math.max(
                    coreX + mainGraphTitleElement.getBoundingClientRect().width, auxX);

                auxTitleStyle.left = auxX + 'px';
            } else {
                auxTitleStyle.display = 'none';
            }

            let functionLibrary = <SVGGraphicsElement>d3.select(
                "." + scene.Class.Scene.GROUP + ">." +
                scene.Class.Scene.FUNCTION_LIBRARY).node();
            let functionLibraryX =
                functionLibrary ? functionLibrary.getCTM().e : null;
            if (functionLibraryX !== null && functionLibraryX !== auxX) {
                functionLibraryTitleStyle.display = 'inline';

                // Make sure that the function library title is positioned rightwards
                // enough so as to prevent overlap with other content.
                functionLibraryX = Math.max(
                    auxX + auxTitleElement.getBoundingClientRect().width,
                    functionLibraryX);

                functionLibraryTitleStyle.left = functionLibraryX + 'px';
            } else {
                functionLibraryTitleStyle.display = 'none';
            }
        } else {
            titleStyle.display = 'none';
            auxTitleStyle.display = 'none';
            functionLibraryTitleStyle.display = 'none';
        }
    }


    static get observers(){
        return [
            '_colorByChanged(colorBy)',
            '_renderHierarchyChanged(renderHierarchy)',
            // Animation and fitting must come after the observer for the hierarchy changing because we must
            // first build the render hierarchy.
            '_animateAndFit(_isAttached, renderHierarchy)',
            '_updateHealthPills(nodeNamesToHealthPills, healthPillStepIndex)',
        ];
    }

    /**
     * Pans to a node. Assumes that the node exists.
     * @param nodeName {string} The name of the node to pan to.
     */
    public panToNode(nodeName: string) {
        const zoomed = scene.panToNode(
            nodeName, this.$.svg, this.$.root, this._zoom);
        if (zoomed) {
            this._zoomed = true;
        }
    };

    /** Main method for building the scene */
    private _build(renderHierarchy: RenderGraphInfo) {

        this.templateIndex = renderHierarchy.hierarchy.getTemplateIndex();

        util.time('tf-graph-scene (layout):', () => {
            layout.layoutScene(renderHierarchy.root);
        });

        util.time('tf-graph-scene (build scene):', () => {
            scene.buildGroup(d3.select(this.$.root), renderHierarchy.root, this, null);
            scene.addGraphClickListener(this.$.svg, this);
            node.traceInputs(d3.select(this.$.svg), renderHierarchy);
        });

        // Update the minimap again when the graph is done animating.
        setTimeout(() => {
            this._updateHealthPills(this.nodeNamesToHealthPills, this.healthPillStepIndex);
            this.minimap.update();
        }, layout.PARAMS.animation.duration);
    };

    public ready() {
        console.log("ready");
        super.ready();
        console.log("super ready");

        this._zoom = d3.zoom()
            .on('end', function () {
                if (this._zoomStartCoords) {
                    // Calculate the total distance dragged during the zoom event.
                    // If it is sufficiently small, then fire an event indicating
                    // that zooming has ended. Otherwise wait to fire the zoom end
                    // event, so that a mouse click registered as part of this zooming
                    // is ignored (as this mouse click was part of a zooming, and should
                    // not be used to indicate an actual click on the graph).
                    var dragDistance = Math.sqrt(
                        Math.pow(this._zoomStartCoords.x - this._zoomTransform.x, 2) +
                        Math.pow(this._zoomStartCoords.y - this._zoomTransform.y, 2));
                    if (dragDistance < this._maxZoomDistanceForClick) {
                        this._fireEnableClick();
                    } else {
                        setTimeout(this._fireEnableClick.bind(this), 50);
                    }
                }
                this._zoomStartCoords = null;
            }.bind(this))
            .on('zoom', function () {
                // Store the coordinates of the zoom event.
                this._zoomTransform = d3.event.transform;

                // If this is the first zoom event after a zoom-end, then
                // store the coordinates as the start coordinates as well,
                // and fire an event to indicate that zooming has started.
                // This doesn't use the zoomstart event, as d3 sends this
                // event on mouse-down, even if there has been no dragging
                // done to translate the graph around.
                if (!this._zoomStartCoords) {
                    this._zoomStartCoords = this._zoomTransform;
                    this.fire('disable-click');
                }
                this._zoomed = true;
                d3.select(this.$.root).attr('transform', d3.event.transform);
                // Notify the minimap.
                this.minimap.zoom(d3.event.transform);
            }.bind(this));
        d3.select(this.$.svg).call(this._zoom)
            .on('dblclick.zoom', null);
        d3.select(window).on('resize', function () {
            // Notify the minimap that the user's window was resized.
            // The minimap will figure out the new dimensions of the main svg
            // and will use the existing translate and scale params.
            this.minimap.zoom();
        }.bind(this));
        // Initialize the minimap.
        this.minimap = this.$.minimap.init(this.$.svg, this.$.root, this._zoom,
            layout.PARAMS.minimap.size,
            layout.PARAMS.subscene.meta.labelHeight);
    };

    public attached() {
        this.set('_isAttached', true);
    };

    public detached() {
        this.set('_isAttached', false);
    }

    public fire(eventName:string, value?:any ):void{
        console.log("firing "+eventName);
        this.dispatchEvent(new CustomEvent(eventName, {bubbles: true,  detail:value}));
    }

    private _renderHierarchyChanged(renderHierarchy: RenderGraphInfo) {
        this._hasRenderHierarchyBeenFitOnce = false;
        this._resetState();
        this._build(renderHierarchy);
    };

    private _animateAndFit(isAttached, renderHierarchy: RenderGraphInfo) {
        if (this._hasRenderHierarchyBeenFitOnce || !isAttached) {
            // Do not animate and fit if the scene has already fitted this render hierarchy once. Or if
            // the graph dashboard is not attached (in which case the scene lacks DOM info for fitting).
            return;
        }

        // Fit to screen after the graph is done animating.
        setTimeout(this.fit.bind(this), layout.PARAMS.animation.duration);
    };


    /**
      * Called whenever the user changed the 'color by' option in the
      * UI controls.
      */
    private _colorByChanged() {
        if (this.renderHierarchy != null) {
            // We iterate through each svg node and update its state.
            _.each(this._nodeGroupIndex, (nodeGroup, nodeName) => {
                this._updateNodeState(nodeName);
            });
            // Notify also the minimap.
            this.minimap.update();
        }
    }

    public fit() {
        this._hasRenderHierarchyBeenFitOnce = true;
        scene.fit(this.$.svg, this.$.root, this._zoom, () => {
            this._zoomed = false;
        });
    };


    public isNodeSelected(n: string): boolean {
        return n === this.selectedNode;
    };


    public isNodeHighlighted(n: string): boolean {
        return n === this.highlightedNode;
    };


    public addAnnotationGroup(a, d, selection) {
        var an = a.node.name;
        this._annotationGroupIndex[an] = this._annotationGroupIndex[an] || {};
        this._annotationGroupIndex[an][d.node.name] = selection;
    };

    public getAnnotationGroupsIndex(a) {
        return this._annotationGroupIndex[a];
    };
    public removeAnnotationGroup(a, d) {
        delete this._annotationGroupIndex[a.node.name][d.node.name];
    };
    public addNodeGroup(n, selection) {
        this._nodeGroupIndex[n] = selection;
    };
    public getNodeGroup(n) {
        return this._nodeGroupIndex[n];
    }
    public removeNodeGroup(n) {
        delete this._nodeGroupIndex[n];
    }
    public addEdgeGroup(n, selection) {
        this._edgeGroupIndex[n] = selection;
    }
    public getEdgeGroup(e) {
        return this._edgeGroupIndex[e];
    }


    /**
     * Update node and annotation node of the given name.
     * @param  {String} n node name
     */
    private _updateNodeState(n: string) {
        const _svg = d3.select(this.$.svg);

        var _node: RenderNodeInfo = this.getNode(n);
        var nodeGroup = this.getNodeGroup(n);

        if (nodeGroup) {
            node.stylize(_svg, nodeGroup, _node, this);
        }

        if (_node.node.type === graph.NodeType.META &&
            (_node.node as graph.Metanode).associatedFunction &&
            !_node.isLibraryFunction) {
            // The node is that of a function call. Also link the node within the
            // function library. This clarifies to the user that the library function
            // is being used.
            var libraryFunctionNodeName = graph.FUNCTION_LIBRARY_NODE_PREFIX +
                (_node.node as graph.Metanode).associatedFunction;
            var functionGroup = _svg.select('.' + scene.Class.Scene.GROUP + '>.' +
                scene.Class.Scene.FUNCTION_LIBRARY + ' g[data-name="' +
                libraryFunctionNodeName + '"]');
            node.stylize(_svg, functionGroup, _node, this);
        }

        var annotationGroupIndex = this.getAnnotationGroupsIndex(n);
        _.each(annotationGroupIndex, (aGroup, hostName) => {
            node.stylize(_svg, aGroup, _node, this,
                scene.Class.Annotation.NODE);
        });


    };

    /**
     * Handles new node selection. 1) Updates the selected-state of each node,
     * 2) triggers input tracing.
     * @param selectedNode {string} The name of the newly selected node.
     * @param oldSelectedNode {string} The name of the previously selected node.
     * @private
     */
    public _selectedNodeChanged(selectedNode: string, oldSelectedNode: string) {

        const _svg = d3.select(this.$.svg);

        if (selectedNode === oldSelectedNode) {
            return;
        }

        if (oldSelectedNode) {
            this._updateNodeState(oldSelectedNode);
        }

        setTimeout(()=>
            node.traceInputs(_svg, this.renderHierarchy), 200);

        if (!selectedNode) {
            return;
        }

        // Update the minimap to reflect the highlighted (selected) node.
        this.minimap.update();
        let _node: graph.Node = this.renderHierarchy.hierarchy.node(selectedNode);
        var nodeParents = [];
        // Create list of all metanode parents of the selected node.
        while (_node.parentNode != null
            && _node.parentNode.name != graph.ROOT_NAME) {
            _node = _node.parentNode;
            nodeParents.push(_node.name);
        }
        // Ensure each parent metanode is built and expanded.
        var topParentNodeToBeExpanded;
        _.forEachRight(nodeParents, (parentName) => {
            this.renderHierarchy.buildSubhierarchy(parentName);
            var renderNode = this.renderHierarchy.getRenderNodeByName(parentName);
            if (renderNode.node.isGroupNode && !renderNode.expanded) {
                renderNode.expanded = true;
                if (!topParentNodeToBeExpanded) {
                    topParentNodeToBeExpanded = renderNode;
                }
            }
        });
        // If any expansion was needed to display this selected node, then
        // inform the scene of the top-most expansion.
        if (topParentNodeToBeExpanded) {
            this.setNodeExpanded(topParentNodeToBeExpanded);
            this._zoomed = true;
        }

        if (selectedNode) {
            this._updateNodeState(selectedNode);
        }

        // Give time for any expanding to finish before panning to a node.
        // Otherwise, the pan will be computed from incorrect measurements.
        setTimeout(() => {
            this.panToNode(selectedNode);
        }, layout.PARAMS.animation.duration);
    };

    private _highlightedNodeChanged(highlightedNode: string, oldHighlightedNode: string) {
        if (highlightedNode === oldHighlightedNode) {
            return;
        }

        if (highlightedNode) {
            this._updateNodeState(highlightedNode);
        }
        if (oldHighlightedNode) {
            this._updateNodeState(oldHighlightedNode);
        }
    };

    private _onZoomChanged() {
        this._updateLabels(!this._zoomed);
    };

    private _fireEnableClick() {        
        this.fire('enable-click');
    };

}
